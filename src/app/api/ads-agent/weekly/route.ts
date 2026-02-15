/**
 * Saffron Agent Weekly — /api/ads-agent/weekly
 *
 * Orchestrates all weekly analysis tasks on Sundays:
 * 1. Historical insights (existing — also triggers /api/ads-agent/insights)
 * 2. Auction insights / competitor tracking (F3)
 * 3. Budget reallocation analysis (F1)
 * 4. Landing page mapping + mismatch analysis (F4)
 * 5. RSA generation for underperforming ad groups (F2)
 * 6. Keyword rehabilitation proposals (F2)
 * 7. HubSpot sync + conversion quality scoring (F5)
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

  // Ask Claude to analyze and propose reallocations
  const analysis = await askClaude(
    `You are Saffron, an AI PPC agent. Analyze budget allocation across campaigns and propose reallocations.
Rules:
- Maximum 25% of any campaign's budget can be moved in one reallocation
- Only propose moving budget FROM high-CPA campaigns TO low-CPA campaigns
- Both campaigns must have at least 10 clicks in the period
- Respond with valid JSON only. Format:
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
      "reason": "2-3 sentence explanation"
    }
  ],
  "narrative": "Summary of budget analysis"
}
If no reallocation is warranted, return empty proposals with narrative explaining why.`,
    `CAMPAIGN BUDGET PERFORMANCE (last 30 days):
${JSON.stringify(utilization.all.map(c => ({
  id: c.campaignId,
  name: c.campaignName,
  budgetId: c.budgetId,
  dailyBudget: c.dailyBudget,
  totalSpend: c.totalSpend,
  conversions: c.conversions,
  cpa: c.cpa,
  utilizationRate: c.utilizationRate,
  clicks: c.clicks,
})), null, 2)}

ACCOUNT AVERAGE CPA: $${utilization.avgCpa.toFixed(2)}
TOTAL MONTHLY SPEND: $${utilization.totalMonthlySpend.toFixed(2)}
TOTAL MONTHLY BUDGET: $${utilization.totalMonthlyBudget.toFixed(2)}`
  );

  const proposals = (analysis.proposals as Array<Record<string, unknown>>) || [];
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  for (const proposal of proposals) {
    // Write to change log
    const { data: logEntry } = await supabase
      .from('ads_agent_change_log')
      .insert({
        account_id: accountId,
        action_type: 'reallocate_budget',
        action_detail: `Reallocate budget from "${proposal.from_campaign_name}" to "${proposal.to_campaign_name}"`,
        data_used: { utilization: utilization.all.map(c => ({ id: c.campaignId, cpa: c.cpa, spend: c.totalSpend })) },
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

  if (proposals.length > 0) {
    await supabase.from('ads_agent_notifications').insert({
      account_id: accountId,
      notification_type: 'budget_reallocation',
      severity: 'info',
      title: `Saffron proposes ${proposals.length} budget reallocation${proposals.length === 1 ? '' : 's'}`,
      message: (analysis.narrative as string) || 'Budget reallocation analysis complete.',
      is_read: false,
      is_dismissed: false,
      created_at: now,
    });
  }

  console.log(`  Generated ${proposals.length} reallocation proposals`);
  return { proposals: proposals.length };
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

// ─── Section 4: RSA Generation (F2) ────────────────────────────────────────

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
  const adGroupPerf = new Map<string, { totalClicks: number; totalImpressions: number; ctr: number; adGroupName: string; campaignName: string; adGroupId: string }>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const ad of ads as any[]) {
    const agId = ad.adGroupId;
    const existing = adGroupPerf.get(agId) || { totalClicks: 0, totalImpressions: 0, ctr: 0, adGroupName: ad.adGroupName, campaignName: ad.campaignName, adGroupId: agId };
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
      "reason": "Why this ad copy should improve CTR"
    }
  ]
}`,
    `UNDERPERFORMING AD GROUPS (low CTR):
${JSON.stringify(underperforming, null, 2)}`
  );

  const rsaProposals = (analysis.ads as Array<Record<string, unknown>>) || [];
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  for (const rsa of rsaProposals) {
    const { data: logEntry } = await supabase
      .from('ads_agent_change_log')
      .insert({
        account_id: accountId,
        action_type: 'create_ad',
        action_detail: `New RSA for ad group "${rsa.ad_group_name}"`,
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
        reason: `Keyword rehabilitation (${candidate.industryCategory}): ${nextTactic.description}. Current CPA: $${candidate.currentCpa.toFixed(2)}, Account avg: $${avgCpa.toFixed(2)}`,
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
      reason: `Keyword rehabilitation for "${candidate.keywordText}" (${candidate.industryCategory}). Tactic: ${nextTactic.description}`,
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

      // 5. RSA Generation (F2)
      try {
        accountResult.rsaGeneration = await runRsaGeneration(account.id);
      } catch (err) {
        console.error('  RSA generation error:', err);
        accountResult.rsaGeneration = { error: err instanceof Error ? err.message : String(err) };
      }

      // 6. Keyword Rehabilitation (F2)
      try {
        accountResult.rehabilitation = await runKeywordRehabilitation(account.id);
      } catch (err) {
        console.error('  Keyword rehabilitation error:', err);
        accountResult.rehabilitation = { error: err instanceof Error ? err.message : String(err) };
      }

      // 7. HubSpot Sync (F5)
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
