/**
 * Saffron Agent Run — /api/ads-agent/run
 *
 * Triggered by Vercel cron 2x daily.
 *
 * Layer 1 (deterministic): Pull Google Ads data, check guardrails, flag anomalies.
 * Layer 2 (Claude Opus):   Analyze data, propose optimizations, write narratives.
 *
 * Outputs go to ads_agent_decision_queue, ads_agent_notifications, and ads_agent_change_log.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getCampaignPerformance,
  getKeywordPerformance,
  getKeyword7DayAvgCpc,
  getTodaySpend,
  getAdPerformance,
  microsToDollars,
} from '@/lib/google-ads';
import { emitSignal } from '@/lib/signals';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow up to 2 min for Opus reasoning

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Layer 1: Deterministic Guardrails & Data Pull ──────────────────────────

interface Layer1Result {
  campaigns: Awaited<ReturnType<typeof getCampaignPerformance>>;
  keywords: Awaited<ReturnType<typeof getKeywordPerformance>>;
  ads: Awaited<ReturnType<typeof getAdPerformance>>;
  todaySpend: Awaited<ReturnType<typeof getTodaySpend>>;
  anomalies: string[];
  guardrailViolations: string[];
  allowedActions: string[];
  guardrails: Record<string, unknown>[];
  account: Record<string, unknown>;
}

async function runLayer1(accountId: string): Promise<Layer1Result> {
  // 1. Fetch account config + guardrails
  const [accountRes, guardrailsRes] = await Promise.all([
    supabase.from('ads_agent_accounts').select('*').eq('id', accountId).single(),
    supabase.from('ads_agent_guardrails').select('*').eq('account_id', accountId).eq('is_active', true),
  ]);

  const account = accountRes.data;
  const guardrails = guardrailsRes.data || [];

  if (!account) throw new Error('Account not found');

  // 2. Pull fresh data from Google Ads
  const [campaigns, keywords, keyword7DayAvg, todaySpend, ads] = await Promise.all([
    getCampaignPerformance('LAST_7_DAYS'),
    getKeywordPerformance('LAST_7_DAYS'),
    getKeyword7DayAvgCpc(),
    getTodaySpend(),
    getAdPerformance('LAST_7_DAYS'),
  ]);

  // 3. Guardrail checks
  const anomalies: string[] = [];
  const guardrailViolations: string[] = [];
  const allowedActions = [
    'add_negative_keyword', 'add_keyword', 'adjust_bid',
    'adjust_budget', 'pause_keyword', 'pause_campaign',
    'enable_campaign', 'create_ad', 'pause_ad', 'enable_ad',
  ];

  // Build guardrail lookup
  const gMap = new Map(guardrails.map((g: Record<string, unknown>) => [g.rule_type as string, g]));

  // Check: budget pacing
  const maxDailySpendPct = gMap.get('max_daily_spend_pct');
  if (maxDailySpendPct && account.daily_budget_cap) {
    const todaySpendDollars = microsToDollars(todaySpend.totalCostMicros);
    const dailyCap = Number(account.daily_budget_cap);
    const pctUsed = dailyCap > 0 ? (todaySpendDollars / dailyCap) * 100 : 0;
    const threshold = Number((maxDailySpendPct as Record<string, unknown>).threshold_value);
    if (pctUsed > threshold) {
      guardrailViolations.push(
        `Budget pacing alert: ${pctUsed.toFixed(1)}% of daily cap spent (limit: ${threshold}%)`
      );
      emitSignal('budget_pace_warning', { accountId, pctUsed, dailyCap, threshold });
    }
  }

  // Check: CPC spikes per keyword
  const cpcSpikeRule = gMap.get('cpc_spike_alert_pct');
  if (cpcSpikeRule) {
    const spikeThreshold = Number((cpcSpikeRule as Record<string, unknown>).threshold_value);
    for (const kw of keywords) {
      const avg7Day = keyword7DayAvg.find(k => k.criterionId === kw.criterionId);
      if (avg7Day && avg7Day.avgCpc7Day > 0 && kw.avgCpc > 0) {
        const pctChange = ((kw.avgCpc - avg7Day.avgCpc7Day) / avg7Day.avgCpc7Day) * 100;
        if (pctChange > spikeThreshold) {
          anomalies.push(
            `CPC spike on "${kw.keywordText}": $${kw.avgCpc.toFixed(2)} vs 7-day avg $${avg7Day.avgCpc7Day.toFixed(2)} (+${pctChange.toFixed(0)}%)`
          );
          emitSignal('high_cpc_alert', { accountId, keyword: kw.keywordText, currentCpc: kw.avgCpc, avgCpc7Day: avg7Day.avgCpc7Day, pctChange });
        }
      }
    }
  }

  // Check: minimum data points before optimization
  const minDataRule = gMap.get('min_data_points');
  if (minDataRule) {
    const minClicks = Number((minDataRule as Record<string, unknown>).threshold_value);
    const totalClicks = keywords.reduce((sum, kw) => sum + kw.clicks, 0);
    if (totalClicks < minClicks) {
      guardrailViolations.push(
        `Insufficient data: ${totalClicks} total clicks (need ${minClicks}). Saffron will not propose bid/keyword changes.`
      );
      // Remove optimization actions from allowed list
      const blocked = ['adjust_bid', 'pause_keyword', 'adjust_budget'];
      for (const b of blocked) {
        const idx = allowedActions.indexOf(b);
        if (idx > -1) allowedActions.splice(idx, 1);
      }
    }
  }

  // Check: never pause converting campaigns
  const neverPauseRule = gMap.get('never_pause_converting');
  if (neverPauseRule) {
    const lookbackDays = Number((neverPauseRule as Record<string, unknown>).threshold_value);
    const convertingCampaignIds = campaigns
      .filter(c => c.conversions > 0)
      .map(c => c.campaignId);
    // Pass this context to Layer 2 so Opus knows not to propose pausing these
    if (convertingCampaignIds.length > 0) {
      anomalies.push(
        `Campaigns with conversions in last ${lookbackDays} days (protected from pause): ${convertingCampaignIds.join(', ')}`
      );
    }
  }

  return {
    campaigns,
    keywords,
    ads,
    todaySpend,
    anomalies,
    guardrailViolations,
    allowedActions,
    guardrails,
    account,
  };
}

// ─── Layer 2: Claude Opus AI Agent ──────────────────────────────────────────

async function runLayer2(accountId: string, layer1: Layer1Result) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.warn('ANTHROPIC_API_KEY not set — skipping Layer 2');
    return { proposals: [], narrative: 'Layer 2 skipped: no API key.' };
  }

  // Fetch recent decision history (what got approved/rejected)
  const { data: recentDecisions } = await supabase
    .from('ads_agent_decision_queue')
    .select('action_type, action_summary, status, review_notes')
    .eq('account_id', accountId)
    .in('status', ['approved', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(20);

  const systemPrompt = `You are Saffron, an AI PPC agent managing Google Ads campaigns for Inecta. You are part of the SALT Crew.

CRITICAL CONSTRAINTS:
- This is a LOW-VOLUME account (~100 clicks/week). Be conservative. Don't thrash on thin data.
- You CANNOT override guardrails. If a guardrail blocks an action, do not propose it.
- Allowed actions for this run: ${layer1.allowedActions.join(', ')}
- NEVER propose pausing a campaign that has conversions (protected by guardrail).
- Max bid change is 20% per adjustment.

KEYWORD REHABILITATION RULE:
NEVER propose pause_keyword or add_negative_keyword for keywords in these strategic food & beverage industries:
meat, beef, pork, poultry, chicken, seafood, fish, dairy, bakery, brewery, beverage, food processing,
food manufacturing, food safety, HACCP, USDA, and related ERP/software terms combined with these industries.
These are naturally expensive B2B keywords. Instead of eliminating them, propose creative improvements
(new ad copy, bid adjustments, match type changes). The weekly rehabilitation system handles these separately.

AD MANAGEMENT RULES:
- You have pause_ad and enable_ad actions available.
- Propose pause_ad when an ad has SIGNIFICANTLY worse CTR or CPA vs other ads in the SAME ad group (at least 30% worse with 50+ impressions minimum).
- Propose pause_ad when an ad has zero conversions after 100+ impressions.
- Propose create_ad when an ad group has CTR below 3% or only 1 active ad (ad groups should have 2-3 active RSAs for rotation).
- NEVER pause the last active ad in an ad group — always ensure at least 1 ENABLED ad remains.
- For pause_ad, action_detail must include: { "ad_group_id": "...", "ad_id": "..." }
- For enable_ad, action_detail must include: { "ad_group_id": "...", "ad_id": "..." }
- For create_ad, action_detail must include: { "ad_group_id": "...", "headlines": [{"text": "..."}], "descriptions": [{"text": "..."}], "final_urls": ["..."] }

ACTION DETAIL ID RULES:
- ALL IDs in action_detail (campaign_id, ad_group_id, ad_id, criterion_id, budget_id) MUST be real numeric Google Ads IDs from the data provided above. NEVER use placeholder values like "all_active", "all", or descriptive strings.
- For add_negative_keyword, action_detail must include: { "campaign_id": "<numeric campaign ID>", "keyword_text": "...", "match_type": "EXACT|PHRASE|BROAD" }
- If you want to add a negative keyword to multiple campaigns, create a SEPARATE proposal for each campaign with its specific numeric campaign_id.
- For adjust_bid, action_detail must include: { "ad_group_id": "...", "criterion_id": "...", "new_bid_micros": "..." }
- For adjust_budget, action_detail must include: { "budget_id": "...", "new_amount_micros": "..." }

ACCOUNT CONFIG:
${JSON.stringify({ name: layer1.account.account_name, budget: layer1.account.monthly_budget, mode: layer1.account.agent_mode, icp: layer1.account.icp_definition, goals: layer1.account.goals }, null, 2)}

GUARDRAILS IN EFFECT:
${layer1.guardrails.map((g: Record<string, unknown>) => `- ${g.rule_name}: ${g.threshold_value} (${g.violation_action})`).join('\n')}

GUARDRAIL VIOLATIONS THIS RUN:
${layer1.guardrailViolations.length > 0 ? layer1.guardrailViolations.join('\n') : 'None'}

ANOMALIES DETECTED:
${layer1.anomalies.length > 0 ? layer1.anomalies.join('\n') : 'None'}

RECENT DECISION HISTORY (learn from what was approved vs rejected):
${JSON.stringify(recentDecisions || [], null, 2)}

Respond with VALID JSON only — no markdown, no code fences. Format:
{
  "proposals": [
    {
      "action_type": "add_negative_keyword|adjust_bid|pause_keyword|...",
      "action_summary": "One-line summary for human reviewer",
      "action_detail": { ... fields needed to execute the action ... },
      "reason": "A detailed explanation structured as: (1) the specific metrics that triggered this — include actual numbers like CPA, spend, clicks, CTR, conversion count; (2) how this compares to other campaigns or the account average; (3) any guardrail context, e.g. 'Campaign retains $25/day minimum floor' or 'Protected — new creatives deployed 3 days ago'; (4) what outcome you expect if this change is approved. Write 3-5 sentences in plain English.",
      "risk_level": "low|medium|high",
      "priority": 1-10,
      "data_snapshot": { ... key data points that support this recommendation ... }
    }
  ],
  "narrative": "A 2-4 sentence summary of what you observed and what you're recommending, written in first person as Saffron."
}

If there's nothing actionable (insufficient data, everything looks healthy), return an empty proposals array with a narrative explaining why.`;

  // Slim ad data — top 30 by spend, only fields needed for decisions
  const slimAds = layer1.ads.slice(0, 30).map(ad => ({
    adId: ad.adId,
    adGroupId: ad.adGroupId,
    adGroupName: ad.adGroupName,
    campaignName: ad.campaignName,
    headlines: ad.headlines,
    status: ad.status,
    impressions: ad.impressions,
    clicks: ad.clicks,
    ctr: ad.ctr,
    conversions: ad.conversions,
    costPerConversion: ad.costPerConversion,
  }));

  const userPrompt = `Here is the current Google Ads performance data. Analyze it and propose optimizations.

CAMPAIGN PERFORMANCE (last 7 days):
${JSON.stringify(layer1.campaigns, null, 2)}

KEYWORD PERFORMANCE (last 7 days):
${JSON.stringify(layer1.keywords.slice(0, 50), null, 2)}

AD PERFORMANCE (last 7 days, top 30 by spend):
${JSON.stringify(slimAds, null, 2)}

TODAY'S SPEND:
${JSON.stringify({ spend: microsToDollars(layer1.todaySpend.totalCostMicros), clicks: layer1.todaySpend.totalClicks, impressions: layer1.todaySpend.totalImpressions, conversions: layer1.todaySpend.totalConversions })}`;

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
    const err = await response.text();
    console.error('Anthropic API error:', err);
    return { proposals: [], narrative: `Layer 2 error: ${response.status}` };
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '{}';

  // Try direct parse first, then extract JSON from markdown code blocks
  try {
    return JSON.parse(text);
  } catch {
    // Claude often wraps JSON in ```json ... ``` blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch {
        // fall through
      }
    }
    // Try to find a JSON object in the text
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch {
        // fall through
      }
    }
    console.error('Failed to parse Layer 2 response:', text.substring(0, 500));
    return { proposals: [], narrative: 'Layer 2 produced unparseable output.' };
  }
}

// ─── Write proposals to Supabase ────────────────────────────────────────────

async function writeProposals(
  accountId: string,
  proposals: Array<Record<string, unknown>>,
  narrative: string,
  layer1: Layer1Result
) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72 hours

  for (const proposal of proposals) {
    // 1. Write to change log first
    const { data: logEntry } = await supabase
      .from('ads_agent_change_log')
      .insert({
        account_id: accountId,
        action_type: proposal.action_type,
        action_detail: proposal.action_summary,
        data_used: proposal.data_snapshot,
        reason: proposal.reason,
        outcome: 'pending',
        executed_by: 'agent',
        created_at: now,
      })
      .select('id')
      .single();

    // 2. Write to decision queue
    await supabase.from('ads_agent_decision_queue').insert({
      account_id: accountId,
      change_log_id: logEntry?.id || null,
      action_type: proposal.action_type,
      action_summary: proposal.action_summary,
      action_detail: proposal.action_detail,
      reason: proposal.reason,
      data_snapshot: proposal.data_snapshot,
      risk_level: proposal.risk_level || 'medium',
      priority: proposal.priority || 5,
      status: 'pending',
      expires_at: expiresAt,
      created_at: now,
    });
  }

  // 3. Create notifications
  if (proposals.length > 0) {
    await supabase.from('ads_agent_notifications').insert({
      account_id: accountId,
      notification_type: 'decision_pending',
      severity: 'info',
      title: `Saffron has ${proposals.length} new recommendation${proposals.length === 1 ? '' : 's'}`,
      message: narrative,
      is_read: false,
      is_dismissed: false,
      created_at: now,
    });
  }

  // 4. Anomaly/guardrail violation notifications
  for (const violation of layer1.guardrailViolations) {
    await supabase.from('ads_agent_notifications').insert({
      account_id: accountId,
      notification_type: 'guardrail_triggered',
      severity: 'warning',
      title: 'Guardrail triggered',
      message: violation,
      is_read: false,
      is_dismissed: false,
      created_at: now,
    });
  }

  for (const anomaly of layer1.anomalies) {
    if (anomaly.includes('spike')) {
      await supabase.from('ads_agent_notifications').insert({
        account_id: accountId,
        notification_type: 'anomaly_detected',
        severity: 'warning',
        title: 'Anomaly detected',
        message: anomaly,
        is_read: false,
        is_dismissed: false,
        created_at: now,
      });
    }
  }
}

// ─── POST handler (cron) ────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all active accounts
    const { data: accounts, error: acctError } = await supabase
      .from('ads_agent_accounts')
      .select('id, account_name, agent_mode')
      .eq('is_active', true);

    if (acctError || !accounts || accounts.length === 0) {
      return NextResponse.json({ message: 'No active accounts found', accounts: 0 });
    }

    const results = [];

    for (const account of accounts) {
      console.log(`🌶️ Saffron: Running for account "${account.account_name}"`);

      try {
        // Layer 1: Deterministic
        const layer1 = await runLayer1(account.id);
        console.log(`Layer 1 complete: ${layer1.campaigns.length} campaigns, ${layer1.keywords.length} keywords, ${layer1.ads.length} ads, ${layer1.anomalies.length} anomalies`);

        // Layer 2: Claude Opus
        const layer2 = await runLayer2(account.id, layer1);
        console.log(`Layer 2 complete: ${layer2.proposals?.length || 0} proposals`);

        // Write to Supabase
        await writeProposals(
          account.id,
          layer2.proposals || [],
          layer2.narrative || '',
          layer1
        );

        // Auto-execute low-risk actions if in semi_auto or autonomous mode
        if (account.agent_mode === 'semi_auto' || account.agent_mode === 'autonomous') {
          const autoExecuteRiskLevel = account.agent_mode === 'autonomous' ? ['low', 'medium'] : ['low'];
          const autoProposals = (layer2.proposals || []).filter(
            (p: Record<string, unknown>) => autoExecuteRiskLevel.includes(p.risk_level as string)
          );
          // Auto-execute logic would go here — for now just mark them
          if (autoProposals.length > 0) {
            console.log(`Auto-execute eligible: ${autoProposals.length} proposals (mode: ${account.agent_mode})`);
          }
        }

        results.push({
          account: account.account_name,
          campaigns: layer1.campaigns.length,
          keywords: layer1.keywords.length,
          anomalies: layer1.anomalies.length,
          guardrailViolations: layer1.guardrailViolations.length,
          proposals: layer2.proposals?.length || 0,
          layer2_narrative: layer2.narrative || null,
        });
      } catch (err) {
        console.error(`Error running Saffron for account ${account.account_name}:`, err);
        results.push({
          account: account.account_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // On Sundays, trigger weekly analysis (auction insights, budget reallocation,
    // landing pages, RSA generation, keyword rehabilitation, HubSpot sync, + historical insights)
    const today = new Date();
    if (today.getUTCDay() === 0) {
      console.log('🌶️ Saffron: Sunday — triggering weekly analysis...');
      try {
        const weeklyUrl = new URL('/api/ads-agent/weekly', request.url);
        await fetch(weeklyUrl.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
          },
        });
        console.log('Weekly analysis triggered successfully');
      } catch (weeklyErr) {
        console.error('Failed to trigger weekly analysis:', weeklyErr);
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error('Saffron run error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Also support GET for manual trigger during development
export async function GET(request: NextRequest) {
  return POST(request);
}
