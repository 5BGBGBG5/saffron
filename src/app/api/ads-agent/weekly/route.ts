/**
 * Saffron Agent Weekly — /api/ads-agent/weekly
 *
 * Orchestrates all weekly analysis tasks on Sundays:
 * 1. Historical insights (existing — also triggers /api/ads-agent/insights)
 * 2. Auction insights / competitor tracking (F3)
 * 3. Budget reallocation analysis (F1)
 * 4. Landing page mapping + mismatch analysis (F4)
 * 5. Competitor ad scan via SerpAPI (F6)
 * 6. RSA generation for underperforming ad groups — enhanced with competitor context (F2)
 * 7. Keyword rehabilitation proposals (F2)
 * 8. HubSpot sync + conversion quality scoring (F5)
 *
 * Each section is wrapped in try/catch so one failure doesn't block others.
 * Called from the Sunday check in run/route.ts.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getAuctionInsights,
  getAdLandingPages,
  getKeywordToUrlMapping,
  getBudgetUtilization,
  getKeywordPerformance,
  getAdPerformance,
} from '@/lib/google-ads';
import {
  identifyRehabCandidates,
  upsertRehabEntry,
  getRehabHistory,
  suggestNextTactic,
} from '@/lib/ads-agent/rehabilitation';
import { syncHubSpotDeals } from '@/lib/hubspot/sync';
import { getConversionQualityBySource } from '@/lib/hubspot/sync';
import { emitSignal } from '@/lib/signals';
import { batchSearchGoogleAds } from '@/lib/serp-api/client';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseClaudeJson(text: string): Record<string, unknown> {
  try { return JSON.parse(text); } catch { /* continue */ }
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[1].trim()); } catch { /* continue */ } }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) { try { return JSON.parse(braceMatch[0]); } catch { /* continue */ } }
  return {};
}

async function askClaude(systemPrompt: string, userPrompt: string): Promise<Record<string, unknown>> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return {};

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!response.ok) {
    console.error('Claude API error:', await response.text());
    return {};
  }

  const result = await response.json();
  return parseClaudeJson(result.content?.[0]?.text || '{}');
}

// ─── Section 1: Auction Insights (F3) ───────────────────────────────────────

async function runAuctionInsights(accountId: string) {
  console.log('  📊 Pulling auction insights...');
  const insights = await getAuctionInsights('LAST_30_DAYS');

  if (!insights.length) {
    console.log('  No auction insight data available');
    return { competitors: 0 };
  }

  // Store in Supabase — delete old data first, then insert fresh
  await supabase
    .from('ads_agent_auction_insights')
    .delete()
    .eq('account_id', accountId)
    .eq('date_range', 'LAST_30_DAYS');

  const rows = insights.map(i => ({
    account_id: accountId,
    campaign_id: i.campaignId,
    campaign_name: i.campaignName,
    competitor_domain: i.competitorDomain,
    impression_share: i.impressionShare,
    overlap_rate: i.overlapRate,
    outranking_share: i.outrankingShare,
    position_above_rate: i.positionAboveRate,
    top_of_page_rate: i.topOfPageRate,
    abs_top_of_page_rate: i.absTopOfPageRate,
    date_range: 'LAST_30_DAYS',
    pulled_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from('ads_agent_auction_insights').insert(rows);
  if (error) console.error('Failed to store auction insights:', error.message);

  // Get unique competitor domains
  const competitors = [...new Set(insights.map(i => i.competitorDomain))];
  console.log(`  Found ${competitors.length} competitors across ${insights.length} campaign-competitor pairs`);

  return { competitors: competitors.length, pairs: insights.length };
}

// ─── Section 2: Budget Reallocation (F1) ────────────────────────────────────

const BUDGET_FLOOR = 25; // $25/day minimum — no campaign should be reduced below this

async function runBudgetReallocation(accountId: string) {
  console.log('  💰 Analyzing budget allocation...');
  const utilization = await getBudgetUtilization();

  if (!utilization.all.length) {
    console.log('  No budget data available');
    return { proposals: 0 };
  }

  // Only propose reallocation if we have sufficient data
  const campaignsWithConversions = utilization.all.filter(c => c.conversions > 0);
  if (campaignsWithConversions.length < 2) {
    console.log('  Need at least 2 campaigns with conversions for reallocation');
    return { proposals: 0 };
  }

  // ─── Creative protection: find campaigns with new ad copy in last 14 days ───
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const reassessDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data: recentCreatives } = await supabase
    .from('ads_agent_change_log')
    .select('data_used')
    .eq('account_id', accountId)
    .eq('action_type', 'create_ad')
    .gte('created_at', fourteenDaysAgo)
    .in('outcome', ['pending', 'executed', 'auto_executed']);

  const protectedCampaignIds = new Set(
    (recentCreatives || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => r.data_used?.campaign_id)
      .filter(Boolean)
  );

  // ─── Cumulative reallocation tracking: last 60 days ─────────────────────────
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentReallocations } = await supabase
    .from('ads_agent_change_log')
    .select('data_used, outcome')
    .eq('account_id', accountId)
    .eq('action_type', 'reallocate_budget')
    .in('outcome', ['executed', 'approved'])
    .gte('created_at', sixtyDaysAgo);

  // Sum up cumulative budget lost per campaign (as source) in micros
  const cumulativeLossMicros = new Map<string, number>();
  for (const entry of recentReallocations || []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = entry.data_used as any;
    if (!data?.from_campaign_id || !data?.amount_micros) continue;
    const prev = cumulativeLossMicros.get(data.from_campaign_id) || 0;
    cumulativeLossMicros.set(data.from_campaign_id, prev + parseInt(data.amount_micros));
  }

  // ─── Enrich campaign data with protections ──────────────────────────────────
  const enrichedCampaigns = utilization.all.map(c => {
    const isProtected = protectedCampaignIds.has(c.campaignId);
    const totalLossMicros = cumulativeLossMicros.get(c.campaignId) || 0;
    const dailyLoss = totalLossMicros / 1_000_000 / 30; // Convert micros to daily dollar equivalent
    const estimatedOriginalBudget = c.dailyBudget + dailyLoss;
    const lossPercentage = estimatedOriginalBudget > 0 ? dailyLoss / estimatedOriginalBudget : 0;

    return {
      id: c.campaignId,
      name: c.campaignName,
      budgetId: c.budgetId,
      dailyBudget: c.dailyBudget,
      totalSpend: c.totalSpend,
      conversions: c.conversions,
      cpa: c.cpa,
      utilizationRate: c.utilizationRate,
      clicks: c.clicks,
      // Brand classification
      isBrand: c.isBrand,
      // Engagement metrics
      ctr: c.ctr,
      ctrTrend: +(c.ctrTrend.toFixed(3)),
      searchImpressionShare: c.searchImpressionShare,
      // Budget floor
      eligibleAsSource: c.dailyBudget > BUDGET_FLOOR + 5,
      // Creative protection
      protected: isProtected,
      protectedReason: isProtected ? `New creatives testing — reassess after ${reassessDate}` : null,
      // Cumulative tracking
      cumulativeLoss60d: +dailyLoss.toFixed(2),
      estimatedOriginalBudget: +estimatedOriginalBudget.toFixed(2),
      lossPercentage: +lossPercentage.toFixed(3),
      flaggedForReview: lossPercentage > 0.4,
    };
  });

  // Ask Claude to analyze and propose reallocations
  const analysis = await askClaude(
    `You are Saffron, an AI PPC agent. Analyze budget allocation and propose reallocations.

RULES:
- Maximum 25% of any campaign's budget can be moved in one reallocation
- Only propose moving budget FROM high-CPA campaigns TO low-CPA campaigns
- Both campaigns must have at least 10 clicks in the period

BRAND SEPARATION:
- Campaigns marked isBrand=true are BRAND campaigns
- Budget can NEVER flow FROM non-brand TO brand
- Brand campaigns compete only against other brand campaigns
- Non-brand campaigns compete only against other non-brand campaigns

BUDGET FLOOR:
- No campaign should be reduced below $${BUDGET_FLOOR}/day
- Campaigns marked eligibleAsSource=false must NOT be sources for reallocation

CREATIVE PROTECTION:
- Campaigns marked protected=true have received new ad creatives in the last 14 days
- NEVER recommend cutting budget from protected campaigns — they need time to test
- Note the protectedReason in your narrative

CUMULATIVE LOSS:
- Campaigns with flaggedForReview=true have already lost >40% of their original budget in the last 60 days
- Do NOT recommend further cuts to these campaigns
- Instead, mention them in your narrative as needing human review

EVALUATION GUIDANCE:
- Consider CTR trend (ctrTrend > 0 = improving) — a campaign with improving CTR may deserve budget even if CPA is high
- Consider impression share (searchImpressionShare) — low impression share + good CPA = opportunity for more budget
- A declining CTR trend with high CPA is a stronger signal for budget reduction than CPA alone

Respond with valid JSON only. Format:
{
  "proposals": [
    {
      "from_campaign_id": "...",
      "from_campaign_name": "...",
      "from_budget_id": "...",
      "to_campaign_id": "...",
      "to_campaign_name": "...",
      "to_budget_id": "...",
      "amount_micros": "...",
      "reason": "A detailed explanation: state the specific metrics (CPA, spend, CTR trend, impression share) for both the source and target campaign, note any guardrail context (budget floor, creative protection, cumulative loss), and what outcome you expect from this reallocation. Write 3-5 sentences in plain English."
    }
  ],
  "flagged_campaigns": ["campaign names needing human review"],
  "narrative": "Summary of budget analysis including any protected or flagged campaigns"
}
If no reallocation is warranted, return empty proposals with narrative explaining why.`,
    `CAMPAIGN BUDGET PERFORMANCE (last 30 days):
${JSON.stringify(enrichedCampaigns, null, 2)}

ACCOUNT AVERAGE CPA: $${utilization.avgCpa.toFixed(2)}
TOTAL MONTHLY SPEND: $${utilization.totalMonthlySpend.toFixed(2)}
TOTAL MONTHLY BUDGET: $${utilization.totalMonthlyBudget.toFixed(2)}
BUDGET FLOOR: $${BUDGET_FLOOR}/day
BRAND CAMPAIGNS: ${utilization.brandCampaigns.length}
NON-BRAND CAMPAIGNS: ${utilization.nonBrandCampaigns.length}`
  );

  const proposals = (analysis.proposals as Array<Record<string, unknown>>) || [];
  const flaggedCampaigns = (analysis.flagged_campaigns as string[]) || [];
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  for (const proposal of proposals) {
    // Write to change log — include structured data for cumulative tracking
    const { data: logEntry } = await supabase
      .from('ads_agent_change_log')
      .insert({
        account_id: accountId,
        action_type: 'reallocate_budget',
        action_detail: `Reallocate budget from "${proposal.from_campaign_name}" to "${proposal.to_campaign_name}"`,
        data_used: {
          from_campaign_id: proposal.from_campaign_id,
          to_campaign_id: proposal.to_campaign_id,
          amount_micros: proposal.amount_micros,
          utilization: utilization.all.map(c => ({ id: c.campaignId, cpa: c.cpa, spend: c.totalSpend })),
        },
        reason: proposal.reason,
        outcome: 'pending',
        executed_by: 'agent',
        created_at: now,
      })
      .select('id')
      .single();

    // Write to decision queue
    await supabase.from('ads_agent_decision_queue').insert({
      account_id: accountId,
      change_log_id: logEntry?.id || null,
      action_type: 'reallocate_budget',
      action_summary: `Reallocate budget: "${proposal.from_campaign_name}" → "${proposal.to_campaign_name}"`,
      action_detail: proposal,
      reason: proposal.reason,
      data_snapshot: { avgCpa: utilization.avgCpa, totalSpend: utilization.totalMonthlySpend },
      risk_level: 'medium',
      priority: 6,
      status: 'pending',
      expires_at: expiresAt,
      created_at: now,
    });
  }

  // Notification — include flagged campaigns if any
  const narrativeParts = [(analysis.narrative as string) || 'Budget reallocation analysis complete.'];
  if (flaggedCampaigns.length > 0) {
    narrativeParts.push(`⚠️ Campaigns flagged for human review (>40% cumulative loss): ${flaggedCampaigns.join(', ')}`);
  }

  if (proposals.length > 0 || flaggedCampaigns.length > 0) {
    await supabase.from('ads_agent_notifications').insert({
      account_id: accountId,
      notification_type: 'budget_reallocation',
      severity: flaggedCampaigns.length > 0 ? 'warning' : 'info',
      title: `Saffron proposes ${proposals.length} budget reallocation${proposals.length === 1 ? '' : 's'}${flaggedCampaigns.length > 0 ? ` (${flaggedCampaigns.length} flagged)` : ''}`,
      message: narrativeParts.join('\n\n'),
      is_read: false,
      is_dismissed: false,
      created_at: now,
    });
  }

  console.log(`  Generated ${proposals.length} reallocation proposals, ${flaggedCampaigns.length} flagged for review`);
  return { proposals: proposals.length, flagged: flaggedCampaigns.length };
}

// ─── Section 3: Landing Page Mapping (F4) ───────────────────────────────────

async function runLandingPageAnalysis(accountId: string) {
  console.log('  🔗 Mapping landing pages...');

  let landingPages, keywordMapping;
  try {
    [landingPages, keywordMapping] = await Promise.all([
      getAdLandingPages('LAST_30_DAYS'),
      getKeywordToUrlMapping('LAST_30_DAYS'),
    ]);
  } catch (err) {
    console.error('  Failed to pull landing page data:', err);
    return { pages: 0, mismatches: 0 };
  }

  if (!landingPages.length) {
    console.log('  No landing page data available');
    return { pages: 0, mismatches: 0 };
  }

  // Ask Claude to identify mismatches
  const analysis = await askClaude(
    `You are Saffron, analyzing keyword-to-landing-page alignment.
Look for mismatches where the keyword intent doesn't match the landing page URL.
For example: a keyword about "meat processing ERP" pointing to a generic homepage.

Respond with valid JSON:
{
  "mismatches": [
    {
      "keyword": "...",
      "landing_url": "...",
      "campaign": "...",
      "issue": "Brief description of the mismatch",
      "suggestion": "What URL or page would be better"
    }
  ],
  "summary": "Brief analysis"
}`,
    `KEYWORD → LANDING PAGE MAPPING (top 30 by clicks):
${JSON.stringify(keywordMapping.slice(0, 30).map(m => ({
  keyword: m.keywordText,
  matchType: m.matchType,
  urls: m.finalUrls,
  campaign: m.campaignName,
  adGroup: m.adGroupName,
  clicks: m.clicks,
  conversions: m.conversions,
})), null, 2)}`
  );

  const mismatches = (analysis.mismatches as Array<Record<string, unknown>>) || [];

  // Store mismatches as insights
  if (mismatches.length > 0) {
    for (const mm of mismatches.slice(0, 5)) { // Max 5 insights
      await supabase.from('ads_agent_historical_insights').insert({
        account_id: accountId,
        insight_type: 'landing_page_mismatch',
        title: `Landing page mismatch: "${mm.keyword}"`,
        description: `${mm.issue}. Suggestion: ${mm.suggestion}`,
        data: mm,
        confidence: 0.75,
        impact_estimate: 'medium',
        status: 'active',
      });
    }
  }

  console.log(`  Mapped ${landingPages.length} ads to URLs, found ${mismatches.length} potential mismatches`);
  return { pages: landingPages.length, mismatches: mismatches.length };
}

// ─── Section 4b: Competitor Ad Intelligence (SerpAPI) ────────────────────────

async function runCompetitorAdScan(accountId: string) {
  if (!process.env.SERPAPI_API_KEY) {
    console.log('  ⏭️ Competitor ad scan skipped — no SERPAPI_API_KEY configured');
    return { keywords: 0, ads: 0, skipped: true };
  }

  console.log('  🔍 Scanning competitor ads via SerpAPI...');

  // Step 1: Pick top keywords to scan
  let keywords;
  try {
    keywords = await getKeywordPerformance('LAST_30_DAYS');
  } catch (err) {
    console.error('  Failed to pull keywords for ad scan:', err);
    return { keywords: 0, ads: 0, error: 'keyword pull failed' };
  }

  // Deduplicate by keyword text (same keyword can appear in multiple ad groups)
  const uniqueKeywords = new Map<string, (typeof keywords)[0]>();
  for (const kw of keywords) {
    if (!uniqueKeywords.has(kw.keywordText)) {
      uniqueKeywords.set(kw.keywordText, kw);
    }
  }

  // Top 10 by spend
  const bySpend = [...uniqueKeywords.values()]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Top 5 by conversions (that aren't already in bySpend)
  const spendKeywords = new Set(bySpend.map(k => k.keywordText));
  const byConversions = [...uniqueKeywords.values()]
    .filter(k => !spendKeywords.has(k.keywordText) && k.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 5);

  const keywordsToScan = [...bySpend, ...byConversions].map(k => k.keywordText);
  console.log(`  Scanning ${keywordsToScan.length} keywords...`);

  // Step 2: Run SerpAPI searches
  const serpResults = await batchSearchGoogleAds(keywordsToScan);

  // Step 3: Store competitor ads in Supabase
  let totalAdsStored = 0;
  const now = new Date().toISOString();

  for (const [keyword, result] of serpResults) {
    const allAds = [...result.ads_top, ...result.ads_bottom];

    for (const ad of allAds) {
      // Skip Inecta's own ads
      if (ad.domain.includes('inecta')) continue;

      const { error } = await supabase
        .from('ads_agent_competitor_ads')
        .insert({
          account_id: accountId,
          keyword_text: keyword,
          competitor_domain: ad.domain,
          competitor_title: ad.title,
          competitor_snippet: ad.snippet,
          competitor_displayed_link: ad.displayed_link,
          competitor_sitelinks: ad.sitelinks || [],
          position: ad.position,
          serp_query: keyword,
          captured_at: now,
        });

      if (!error) totalAdsStored++;
    }
  }

  console.log(`  Stored ${totalAdsStored} competitor ads across ${keywordsToScan.length} keywords`);

  // Step 4: Ask Claude to analyze competitor messaging patterns
  const { data: weekAds } = await supabase
    .from('ads_agent_competitor_ads')
    .select('*')
    .eq('account_id', accountId)
    .gte('captured_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .order('competitor_domain');

  let competitorsAnalyzed = 0;

  if (weekAds && weekAds.length > 0) {
    // Group by competitor domain
    const byDomain = new Map<string, typeof weekAds>();
    for (const ad of weekAds) {
      const existing = byDomain.get(ad.competitor_domain) || [];
      existing.push(ad);
      byDomain.set(ad.competitor_domain, existing);
    }

    // Analyze top 5 competitors (by number of ad appearances)
    const topCompetitors = [...byDomain.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    for (const [domain, ads] of topCompetitors) {
      const analysis = await askClaude(
        `You are Saffron, analyzing competitor Google Ads copy for Inecta (B2B food & beverage ERP).

Analyze this competitor's ad copy and identify:
1. Primary messaging themes (what pain points do they address?)
2. Specific value propositions and claims
3. Which food/beverage industries they target
4. CTA patterns (demo, free trial, pricing, contact?)
5. Unique angles — what do they say that Inecta's ads currently don't?
6. Weakness opportunities — where is their messaging weak or generic that Inecta could exploit?

Respond with valid JSON:
{
  "primary_themes": ["theme1", "theme2"],
  "value_propositions": ["claim1", "claim2"],
  "industries_targeted": ["dairy", "meat processing"],
  "cta_patterns": ["request demo", "free consultation"],
  "unique_angles": "Brief description of what they do differently",
  "weakness_opportunities": "Brief description of exploitable gaps"
}`,
        `COMPETITOR: ${domain}
ADS CAPTURED (${ads.length} ads across ${new Set(ads.map((a: { keyword_text: string }) => a.keyword_text)).size} keywords):

${ads.map((a: { keyword_text: string; position: number; competitor_title: string; competitor_snippet: string; competitor_displayed_link: string }) =>
  `Keyword: "${a.keyword_text}" | Position: ${a.position}
  Title: ${a.competitor_title}
  Description: ${a.competitor_snippet}
  URL: ${a.competitor_displayed_link}
`).join('\n')}`
      );

      // Store analysis
      const today = new Date().toISOString().split('T')[0];
      await supabase
        .from('ads_agent_competitor_intel')
        .upsert({
          account_id: accountId,
          analysis_date: today,
          competitor_domain: domain,
          primary_themes: analysis.primary_themes || [],
          value_propositions: analysis.value_propositions || [],
          industries_targeted: analysis.industries_targeted || [],
          cta_patterns: analysis.cta_patterns || [],
          unique_angles: analysis.unique_angles || null,
          weakness_opportunities: analysis.weakness_opportunities || null,
          raw_ad_count: ads.length,
        }, {
          onConflict: 'account_id,analysis_date,competitor_domain',
        });

      competitorsAnalyzed++;
    }

    // Create notification
    const competitorNames = topCompetitors.map(([d]) => d).join(', ');
    await supabase.from('ads_agent_notifications').insert({
      account_id: accountId,
      notification_type: 'competitor_intel',
      severity: 'info',
      title: `Saffron scanned ${totalAdsStored} competitor ads`,
      message: `Analyzed ads from ${topCompetitors.length} competitors (${competitorNames}) across ${keywordsToScan.length} keywords.`,
      is_read: false,
      is_dismissed: false,
      created_at: now,
    });
  }

  // Emit signal
  emitSignal('competitor_ad_scan_complete', {
    accountId,
    keywords: keywordsToScan.length,
    ads: totalAdsStored,
    competitors: competitorsAnalyzed,
  });

  return {
    keywords: keywordsToScan.length,
    ads: totalAdsStored,
    competitors: competitorsAnalyzed,
  };
}

// ─── Section 5: RSA Generation (F2) — Enhanced with Competitor Context ───────

async function runRsaGeneration(accountId: string) {
  console.log('  ✍️ Analyzing ad copy for RSA generation...');

  let ads;
  try {
    ads = await getAdPerformance('LAST_30_DAYS');
  } catch (err) {
    console.error('  Failed to pull ad performance:', err);
    return { proposals: 0 };
  }

  if (!ads?.length) {
    console.log('  No ad data available');
    return { proposals: 0 };
  }

  // Find ad groups with low CTR (potential for better ad copy)
  const adGroupPerf = new Map<string, { totalClicks: number; totalImpressions: number; ctr: number; adGroupName: string; campaignName: string; campaignId: string; adGroupId: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ad of ads as any[]) {
    const agId = ad.adGroupId;
    const existing = adGroupPerf.get(agId) || { totalClicks: 0, totalImpressions: 0, ctr: 0, adGroupName: ad.adGroupName, campaignName: ad.campaignName, campaignId: ad.campaignId, adGroupId: agId };
    existing.totalClicks += ad.clicks || 0;
    existing.totalImpressions += ad.impressions || 0;
    existing.ctr = existing.totalImpressions > 0 ? existing.totalClicks / existing.totalImpressions : 0;
    adGroupPerf.set(agId, existing);
  }

  // Filter to underperforming ad groups (CTR < 3% with at least 100 impressions)
  const underperforming = Array.from(adGroupPerf.values())
    .filter(ag => ag.ctr < 0.03 && ag.totalImpressions > 100)
    .sort((a, b) => a.ctr - b.ctr)
    .slice(0, 3); // Max 3 ad groups per week

  if (!underperforming.length) {
    console.log('  No underperforming ad groups found');
    return { proposals: 0 };
  }

  // Pull competitor intelligence for context
  const { data: competitorIntel } = await supabase
    .from('ads_agent_competitor_intel')
    .select('*')
    .eq('account_id', accountId)
    .order('analysis_date', { ascending: false })
    .limit(10);

  const { data: competitorAds } = await supabase
    .from('ads_agent_competitor_ads')
    .select('keyword_text, competitor_domain, competitor_title, competitor_snippet')
    .eq('account_id', accountId)
    .gte('captured_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .limit(30);

  const competitorContext = competitorIntel?.length
    ? `

COMPETITOR INTELLIGENCE (from recent ad scans):
${competitorIntel.map(c =>
  `${c.competitor_domain}:
  Themes: ${JSON.stringify(c.primary_themes)}
  Value props: ${JSON.stringify(c.value_propositions)}
  Industries: ${JSON.stringify(c.industries_targeted)}
  Unique angles: ${c.unique_angles}
  Their weaknesses: ${c.weakness_opportunities}
`).join('\n')}
COMPETITOR AD EXAMPLES:
${(competitorAds || []).slice(0, 15).map(a =>
  `  "${a.keyword_text}" → ${a.competitor_domain}: "${a.competitor_title}" — ${a.competitor_snippet}`
).join('\n')}

IMPORTANT: Generate ad copy that COUNTER-POSITIONS against these competitors.
- If they claim "rapid deployment", emphasize Inecta's depth of food industry expertise.
- If they're generic about "food ERP", be specific about the industry vertical (dairy, meat, seafood).
- If they don't mention compliance (HACCP, USDA, FSMA), lead with it.
- If they all use "Request a Demo" CTAs, try a different approach.`
    : '';

  // Ask Claude to generate RSA copy
  const analysis = await askClaude(
    `You are Saffron, generating responsive search ad copy for Inecta, a B2B ERP software company
focused on the food & beverage industry. Inecta offers Microsoft Dynamics 365 Business Central
solutions for food manufacturers, processors, and distributors.

Generate ad copy variations for underperforming ad groups. Each RSA needs:
- 3-5 headlines (max 30 chars each)
- 2-3 descriptions (max 90 chars each)
- Headlines should include relevant keywords, value propositions, CTAs
- Descriptions should expand on benefits, include social proof elements

Respond with valid JSON:
{
  "ads": [
    {
      "ad_group_id": "...",
      "ad_group_name": "...",
      "headlines": [{"text": "..."}],
      "descriptions": [{"text": "..."}],
      "reason": "Explain: the current CTR and impressions for this ad group, how it compares to other ad groups, what the new ad copy focuses on differently, and what CTR improvement you expect. Write 2-4 sentences."
    }
  ]
}`,
    `UNDERPERFORMING AD GROUPS (low CTR):
${JSON.stringify(underperforming, null, 2)}${competitorContext}`
  );

  const rsaProposals = (analysis.ads as Array<Record<string, unknown>>) || [];
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  // Map ad group → campaign for cross-referencing by the budget engine
  const adGroupToCampaign = new Map(
    Array.from(adGroupPerf.values()).map(ag => [ag.adGroupId, { campaignId: ag.campaignId, campaignName: ag.campaignName }])
  );

  for (const rsa of rsaProposals) {
    const campaign = adGroupToCampaign.get(rsa.ad_group_id as string);

    const { data: logEntry } = await supabase
      .from('ads_agent_change_log')
      .insert({
        account_id: accountId,
        action_type: 'create_ad',
        action_detail: `New RSA for ad group "${rsa.ad_group_name}"`,
        data_used: { campaign_id: campaign?.campaignId || null, campaign_name: campaign?.campaignName || null },
        reason: rsa.reason,
        outcome: 'pending',
        executed_by: 'agent',
        created_at: now,
      })
      .select('id')
      .single();

    await supabase.from('ads_agent_decision_queue').insert({
      account_id: accountId,
      change_log_id: logEntry?.id || null,
      action_type: 'create_ad',
      action_summary: `New RSA ad copy for "${rsa.ad_group_name}"`,
      action_detail: {
        adGroupId: rsa.ad_group_id,
        campaignId: campaign?.campaignId || null,
        headlines: rsa.headlines,
        descriptions: rsa.descriptions,
        finalUrls: ['https://www.inecta.com'],
      },
      reason: rsa.reason,
      risk_level: 'low',
      priority: 5,
      status: 'pending',
      expires_at: expiresAt,
      created_at: now,
    });
  }

  console.log(`  Generated ${rsaProposals.length} RSA proposals`);
  return { proposals: rsaProposals.length };
}

// ─── Section 5: Keyword Rehabilitation (F2) ─────────────────────────────────

async function runKeywordRehabilitation(accountId: string) {
  console.log('  🔄 Running keyword rehabilitation...');

  let keywords;
  try {
    keywords = await getKeywordPerformance('LAST_30_DAYS');
  } catch (err) {
    console.error('  Failed to pull keyword data:', err);
    return { candidates: 0, proposals: 0 };
  }

  // Calculate account average CPA
  const kwWithConversions = keywords.filter(k => k.conversions > 0);
  const avgCpa = kwWithConversions.length > 0
    ? kwWithConversions.reduce((sum, k) => sum + k.costPerConversion, 0) / kwWithConversions.length
    : 0;

  // Identify rehabilitation candidates
  const candidates = identifyRehabCandidates(
    keywords.map(k => ({
      keywordText: k.keywordText,
      criterionId: k.criterionId,
      adGroupId: k.adGroupId,
      campaignId: k.campaignId,
      campaignName: k.campaignName,
      costPerConversion: k.costPerConversion,
      cost: k.cost,
      conversions: k.conversions,
      clicks: k.clicks,
    })),
    avgCpa
  );

  if (!candidates.length) {
    console.log('  No rehabilitation candidates found');
    return { candidates: 0, proposals: 0 };
  }

  let proposals = 0;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  for (const candidate of candidates.slice(0, 5)) { // Max 5 per week
    // Check if already in rehabilitation
    const existing = await getRehabHistory(candidate.keywordText, accountId);
    await upsertRehabEntry(accountId, candidate, existing);

    // Suggest next tactic
    const nextTactic = suggestNextTactic(existing?.attempts || []);

    // Create proposal based on tactic
    let actionType = 'create_ad';
    let actionDetail: Record<string, unknown> = {};
    let summary = '';

    switch (nextTactic.tactic) {
      case 'new_ad_copy':
      case 'new_ad_angle':
        actionType = 'create_ad';
        summary = `Rehab: New ad copy for "${candidate.keywordText}" (${candidate.industryCategory})`;
        actionDetail = {
          adGroupId: candidate.adGroupId,
          rehabilitationKeyword: candidate.keywordText,
          industryCategory: candidate.industryCategory,
          tactic: nextTactic.tactic,
        };
        break;
      case 'bid_adjustment':
        actionType = 'adjust_bid';
        summary = `Rehab: Adjust bid for "${candidate.keywordText}" to improve position`;
        actionDetail = {
          adGroupId: candidate.adGroupId,
          criterionId: candidate.criterionId,
          rehabilitationKeyword: candidate.keywordText,
          tactic: nextTactic.tactic,
        };
        break;
      case 'match_type_change':
        summary = `Rehab: Review match type for "${candidate.keywordText}"`;
        actionType = 'add_keyword';
        actionDetail = {
          adGroupId: candidate.adGroupId,
          keywordText: candidate.keywordText,
          matchType: 'PHRASE', // Will be adjusted based on current match type
          rehabilitationKeyword: candidate.keywordText,
          tactic: nextTactic.tactic,
        };
        break;
      default:
        summary = `Rehab: ${nextTactic.description} for "${candidate.keywordText}"`;
        actionDetail = {
          rehabilitationKeyword: candidate.keywordText,
          tactic: nextTactic.tactic,
          note: nextTactic.description,
        };
    }

    // Write to decision queue
    const { data: logEntry } = await supabase
      .from('ads_agent_change_log')
      .insert({
        account_id: accountId,
        action_type: actionType,
        action_detail: summary,
        reason: `Keyword rehabilitation (${candidate.industryCategory}): ${nextTactic.description}. This keyword has spent $${candidate.cost.toFixed(2)} with ${candidate.conversions} conversion${candidate.conversions !== 1 ? 's' : ''} and ${candidate.clicks} clicks. Current CPA: $${candidate.currentCpa.toFixed(2)} vs account average $${avgCpa.toFixed(2)} (${avgCpa > 0 ? ((candidate.currentCpa / avgCpa) * 100 - 100).toFixed(0) : 'N/A'}% above). This is a strategic industry keyword that Saffron protects from elimination — instead, trying ${nextTactic.description.toLowerCase()} to improve performance.`,
        outcome: 'pending',
        executed_by: 'agent',
        created_at: now,
      })
      .select('id')
      .single();

    await supabase.from('ads_agent_decision_queue').insert({
      account_id: accountId,
      change_log_id: logEntry?.id || null,
      action_type: actionType,
      action_summary: summary,
      action_detail: actionDetail,
      reason: `Keyword rehabilitation for "${candidate.keywordText}" (${candidate.industryCategory}). This keyword spent $${candidate.cost.toFixed(2)} with ${candidate.conversions} conversion${candidate.conversions !== 1 ? 's' : ''} over 30 days (CPA: $${candidate.currentCpa.toFixed(2)} vs $${avgCpa.toFixed(2)} account avg). Tactic: ${nextTactic.description}. Saffron protects strategic industry keywords from elimination and instead tries optimization tactics.`,
      data_snapshot: { keyword: candidate, avgCpa, tactic: nextTactic },
      risk_level: 'low',
      priority: 7,
      status: 'pending',
      expires_at: expiresAt,
      created_at: now,
    });

    proposals++;
  }

  if (proposals > 0) {
    await supabase.from('ads_agent_notifications').insert({
      account_id: accountId,
      notification_type: 'rehabilitation',
      severity: 'info',
      title: `Saffron: ${proposals} keyword rehabilitation proposal${proposals === 1 ? '' : 's'}`,
      message: `Found ${candidates.length} industry keywords needing rehabilitation. Proposing tactics for top ${proposals}.`,
      is_read: false,
      is_dismissed: false,
    });
  }

  console.log(`  ${candidates.length} candidates, ${proposals} rehabilitation proposals`);
  return { candidates: candidates.length, proposals };
}

// ─── Section 6: HubSpot Sync (F5) ──────────────────────────────────────────

async function runHubSpotSync(accountId: string) {
  if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
    console.log('  ⏭️ HubSpot sync skipped — no token configured');
    return { synced: 0, skipped: true };
  }

  console.log('  🔄 Syncing HubSpot deals...');

  try {
    const syncResult = await syncHubSpotDeals(accountId, 30);
    console.log(`  Synced ${syncResult.synced} deals (${syncResult.errors} errors)`);

    // Get conversion quality scores
    const qualityScores = await getConversionQualityBySource(accountId);

    // Store quality insights
    if (qualityScores.length > 0) {
      const lowQuality = qualityScores.filter(s => s.quality_score === 'low');
      const highQuality = qualityScores.filter(s => s.quality_score === 'high');

      if (lowQuality.length > 0) {
        await supabase.from('ads_agent_historical_insights').insert({
          account_id: accountId,
          insight_type: 'conversion_quality',
          title: `${lowQuality.length} campaigns with low conversion quality`,
          description: `These campaigns drive clicks but few closed deals: ${lowQuality.map(q => q.utm_campaign).join(', ')}`,
          data: { lowQuality, highQuality, allScores: qualityScores },
          confidence: 0.7,
          impact_estimate: 'high',
          status: 'active',
        });
      }
    }

    return { synced: syncResult.synced, errors: syncResult.errors };
  } catch (err) {
    console.error('  HubSpot sync failed:', err);
    return { synced: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── POST handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all active accounts
    const { data: accounts } = await supabase
      .from('ads_agent_accounts')
      .select('id, account_name')
      .eq('is_active', true);

    if (!accounts?.length) {
      return NextResponse.json({ message: 'No active accounts' });
    }

    const results = [];

    for (const account of accounts) {
      console.log(`🌶️ Saffron Weekly: Running for "${account.account_name}"`);
      const accountResult: Record<string, unknown> = { account: account.account_name };

      // 1. Trigger historical insights (existing route)
      try {
        const insightsUrl = new URL('/api/ads-agent/insights', request.url);
        await fetch(insightsUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
          },
        });
        accountResult.insights = 'triggered';
      } catch (err) {
        console.error('  Historical insights trigger failed:', err);
        accountResult.insights = 'error';
      }

      // 2. Auction Insights (F3)
      try {
        accountResult.auctionInsights = await runAuctionInsights(account.id);
      } catch (err) {
        console.error('  Auction insights error:', err);
        accountResult.auctionInsights = { error: err instanceof Error ? err.message : String(err) };
      }

      // 3. Budget Reallocation (F1)
      try {
        accountResult.budgetReallocation = await runBudgetReallocation(account.id);
      } catch (err) {
        console.error('  Budget reallocation error:', err);
        accountResult.budgetReallocation = { error: err instanceof Error ? err.message : String(err) };
      }

      // 4. Landing Page Analysis (F4)
      try {
        accountResult.landingPages = await runLandingPageAnalysis(account.id);
      } catch (err) {
        console.error('  Landing page analysis error:', err);
        accountResult.landingPages = { error: err instanceof Error ? err.message : String(err) };
      }

      // 5. Competitor Ad Scan (SerpAPI)
      try {
        accountResult.competitorAds = await runCompetitorAdScan(account.id);
      } catch (err) {
        console.error('  Competitor ad scan error:', err);
        accountResult.competitorAds = { error: err instanceof Error ? err.message : String(err) };
      }

      // 6. RSA Generation (F2) — Enhanced with Competitor Context
      try {
        accountResult.rsaGeneration = await runRsaGeneration(account.id);
      } catch (err) {
        console.error('  RSA generation error:', err);
        accountResult.rsaGeneration = { error: err instanceof Error ? err.message : String(err) };
      }

      // 7. Keyword Rehabilitation (F2)
      try {
        accountResult.rehabilitation = await runKeywordRehabilitation(account.id);
      } catch (err) {
        console.error('  Keyword rehabilitation error:', err);
        accountResult.rehabilitation = { error: err instanceof Error ? err.message : String(err) };
      }

      // 8. HubSpot Sync (F5)
      try {
        accountResult.hubspot = await runHubSpotSync(account.id);
      } catch (err) {
        console.error('  HubSpot sync error:', err);
        accountResult.hubspot = { error: err instanceof Error ? err.message : String(err) };
      }

      results.push(accountResult);
    }

    emitSignal('weekly_report_complete', { accounts: results.length, timestamp: new Date().toISOString() });

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Weekly analysis error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
