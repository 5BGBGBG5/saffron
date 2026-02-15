/**
 * Saffron Daily Digest — /api/ads-agent/digest
 *
 * Triggered by Vercel cron 1x daily (end of day).
 * Compiles daily summary from Google Ads data + change log.
 * Writes to ads_agent_daily_digest + ads_agent_notifications.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getCampaignPerformance,
  getKeywordPerformance,
  getTodaySpend,
  microsToDollars,
} from '@/lib/google-ads';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

async function generateDigestNarrative(
  account: Record<string, unknown>,
  metrics: Record<string, unknown>,
  changesSummary: Record<string, number>,
  anomalies: string[],
  topKeyword: Record<string, unknown> | null,
  worstKeyword: Record<string, unknown> | null
): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return 'Daily digest compiled. No AI narrative available (API key not configured).';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 500,
      system: `You are Saffron, a PPC agent. Write a brief, conversational daily digest summary (3-5 sentences). Reference yourself as "I" (Saffron). Be specific with numbers. If things are going well, say so. If there are concerns, flag them directly.`,
      messages: [{
        role: 'user',
        content: `Write today's digest for "${account.account_name}".

Metrics: ${JSON.stringify(metrics)}
Changes today: ${JSON.stringify(changesSummary)}
Anomalies: ${anomalies.length > 0 ? anomalies.join('; ') : 'None'}
Top keyword: ${topKeyword ? JSON.stringify(topKeyword) : 'N/A'}
Worst keyword: ${worstKeyword ? JSON.stringify(worstKeyword) : 'N/A'}
Monthly budget: $${account.monthly_budget}`,
      }],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => 'unknown');
    console.error(`Anthropic API error [${response.status}]:`, errBody);
    return `Digest narrative generation failed (${response.status}). Check Anthropic API credits/billing.`;
  }
  const result = await response.json();
  return result.content?.[0]?.text || 'No narrative generated.';
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const { data: accounts } = await supabase
      .from('ads_agent_accounts')
      .select('*')
      .eq('is_active', true);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ message: 'No active accounts' });
    }

    const results = [];

    for (const account of accounts) {
      try {
        // 1. Pull today's Google Ads data
        const [campaigns, keywords, todaySpend] = await Promise.all([
          getCampaignPerformance('TODAY'),
          getKeywordPerformance('TODAY'),
          getTodaySpend(),
        ]);

        const totalSpend = microsToDollars(todaySpend.totalCostMicros);
        const monthlyBudget = Number(account.monthly_budget) || 0;
        const budgetPacingPct = monthlyBudget > 0
          ? Math.min((totalSpend / monthlyBudget) * 100, 999.99)
          : 0;

        // Weighted avg CPC / CTR across campaigns
        const totalCost = campaigns.reduce((s, c) => s + c.cost, 0);
        const totalClicks = campaigns.reduce((s, c) => s + c.clicks, 0);
        const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
        const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
        const avgCpc = totalClicks > 0 ? totalCost / totalClicks : 0;
        const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
        const costPerConversion = totalConversions > 0 ? totalCost / totalConversions : 0;

        // 2. Count today's changes from change log
        const { data: todayChanges } = await supabase
          .from('ads_agent_change_log')
          .select('outcome')
          .eq('account_id', account.id)
          .gte('created_at', `${today}T00:00:00Z`);

        const changesMade = (todayChanges || []).filter(c => c.outcome === 'executed' || c.outcome === 'auto_executed').length;
        const changesPending = (todayChanges || []).filter(c => c.outcome === 'pending').length;
        const changesRejected = (todayChanges || []).filter(c => c.outcome === 'rejected').length;

        // 3. Count guardrail violations from today's notifications
        const { count: guardrailsTriggered } = await supabase
          .from('ads_agent_notifications')
          .select('id', { count: 'exact' })
          .eq('account_id', account.id)
          .eq('notification_type', 'guardrail_triggered')
          .gte('created_at', `${today}T00:00:00Z`);

        // 4. Top/worst performing keywords
        const sortedKw = [...keywords].sort((a, b) => b.conversions - a.conversions || a.cost - b.cost);
        const topKw = sortedKw[0] || null;
        const worstKw = [...keywords].filter(k => k.clicks > 0 && k.conversions === 0).sort((a, b) => b.cost - a.cost)[0] || null;

        // 5. Anomaly detection (simple CPC check)
        const anomalies: string[] = [];
        // (Layer 1 already caught these during /run — just note for narrative)

        // 6. Generate AI narrative
        const narrative = await generateDigestNarrative(
          account,
          { totalSpend, totalClicks, totalImpressions, totalConversions, avgCpc, avgCtr, costPerConversion, budgetPacingPct },
          { changesMade, changesPending, changesRejected },
          anomalies,
          topKw ? { keyword: topKw.keywordText, clicks: topKw.clicks, conversions: topKw.conversions, cost: topKw.cost } : null,
          worstKw ? { keyword: worstKw.keywordText, clicks: worstKw.clicks, cost: worstKw.cost } : null
        );

        // 7. Upsert daily digest (one per account per day)
        const { error: digestError } = await supabase
          .from('ads_agent_daily_digest')
          .upsert(
            {
              account_id: account.id,
              digest_date: today,
              total_spend: totalSpend,
              budget_pacing_pct: budgetPacingPct,
              total_clicks: totalClicks,
              total_impressions: totalImpressions,
              total_conversions: totalConversions,
              avg_cpc: avgCpc,
              avg_ctr: avgCtr,
              cost_per_conversion: costPerConversion,
              changes_made: changesMade,
              changes_pending: changesPending,
              changes_rejected: changesRejected,
              guardrails_triggered: guardrailsTriggered || 0,
              anomalies_detected: anomalies,
              top_performing: topKw
                ? { keyword: topKw.keywordText, clicks: topKw.clicks, conversions: topKw.conversions }
                : null,
              worst_performing: worstKw
                ? { keyword: worstKw.keywordText, clicks: worstKw.clicks, cost: worstKw.cost }
                : null,
              agent_notes: narrative,
              created_at: new Date().toISOString(),
            },
            { onConflict: 'account_id,digest_date' }
          );

        if (digestError) {
          console.error('Failed to upsert digest:', digestError);
        }

        // 8. Create digest notification
        await supabase.from('ads_agent_notifications').insert({
          account_id: account.id,
          notification_type: 'daily_digest',
          severity: 'info',
          title: `Daily digest for ${today}`,
          message: `Spend: $${totalSpend.toFixed(2)} | Clicks: ${totalClicks} | Conversions: ${totalConversions}`,
          is_read: false,
          is_dismissed: false,
        });

        results.push({
          account: account.account_name,
          digest_date: today,
          totalSpend,
          totalClicks,
          totalConversions,
        });
      } catch (err) {
        console.error(`Digest error for ${account.account_name}:`, err);
        results.push({
          account: account.account_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('Digest API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
