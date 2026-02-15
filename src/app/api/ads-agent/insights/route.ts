/**
 * Saffron Historical Insights — /api/ads-agent/insights
 *
 * GET  → returns stored insights from Supabase
 * POST → triggers 365-day historical analysis with Claude Sonnet 4.5
 *
 * Pulls campaign + keyword data in 30-day chunks, computes deterministic
 * stats (day-of-week, monthly trends, wasted spend), then sends to Claude
 * for pattern interpretation and recommendations.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  getCampaignHistorical,
  getKeywordHistorical,
  getSearchTermReport,
  computeDayOfWeekPerformance,
  computeMonthlyTrends,
} from '@/lib/google-ads/queries/historical';
import { emitSignal } from '@/lib/signals';

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // Allow max for chunked API calls

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Robust JSON parser (handles markdown code blocks from Claude) ──────────

function parseClaudeJson(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try { return JSON.parse(jsonMatch[1].trim()); } catch { /* fall through */ }
    }
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
    }
    console.error('Failed to parse Claude response:', text.substring(0, 500));
    return { insights: [], narrative: 'Failed to parse AI response.' };
  }
}

// ─── Deterministic analysis helpers ─────────────────────────────────────────

interface AnalysisSummary {
  totalDays: number;
  totalSpend: number;
  totalClicks: number;
  totalImpressions: number;
  totalConversions: number;
  avgCpc: number;
  avgCpa: number;
  ctr: number;
  spendTrendDirection: 'increasing' | 'decreasing' | 'stable';
  conversionTrendDirection: 'increasing' | 'decreasing' | 'stable';
  bestDay: string;
  worstDay: string;
  topWastedKeywords: { keyword: string; cost: number; conversions: number }[];
  topConvertingKeywords: { keyword: string; cost: number; conversions: number; cpa: number }[];
  monthlyTrends: ReturnType<typeof computeMonthlyTrends>;
  dayOfWeekPerformance: ReturnType<typeof computeDayOfWeekPerformance>;
  searchTermHighlights: { wasted: { term: string; cost: number }[]; converting: { term: string; conversions: number; cost: number }[] };
}

function computeAnalysisSummary(
  campaignDaily: Awaited<ReturnType<typeof getCampaignHistorical>>,
  keywordDaily: Awaited<ReturnType<typeof getKeywordHistorical>>,
  searchTerms: Awaited<ReturnType<typeof getSearchTermReport>>
): AnalysisSummary {
  // Aggregate totals from campaign daily data
  const uniqueDates = new Set(campaignDaily.map(r => r.date));
  const totalSpend = campaignDaily.reduce((s, r) => s + r.cost, 0);
  const totalClicks = campaignDaily.reduce((s, r) => s + r.clicks, 0);
  const totalImpressions = campaignDaily.reduce((s, r) => s + r.impressions, 0);
  const totalConversions = campaignDaily.reduce((s, r) => s + r.conversions, 0);

  // Trend direction — compare first half vs second half
  const sorted = [...campaignDaily].sort((a, b) => a.date.localeCompare(b.date));
  const mid = Math.floor(sorted.length / 2);
  const firstHalfSpend = sorted.slice(0, mid).reduce((s, r) => s + r.cost, 0);
  const secondHalfSpend = sorted.slice(mid).reduce((s, r) => s + r.cost, 0);
  const firstHalfConv = sorted.slice(0, mid).reduce((s, r) => s + r.conversions, 0);
  const secondHalfConv = sorted.slice(mid).reduce((s, r) => s + r.conversions, 0);

  const spendChange = firstHalfSpend > 0 ? (secondHalfSpend - firstHalfSpend) / firstHalfSpend : 0;
  const convChange = firstHalfConv > 0 ? (secondHalfConv - firstHalfConv) / firstHalfConv : 0;

  // Day of week
  const dowPerf = computeDayOfWeekPerformance(campaignDaily);
  const dowSorted = [...dowPerf].sort((a, b) => {
    // Sort by conversion rate, then by cost efficiency
    if (a.conversions !== b.conversions) return b.conversions - a.conversions;
    return a.cost - b.cost;
  });

  // Monthly trends
  const monthlyTrends = computeMonthlyTrends(campaignDaily);

  // Keyword analysis — aggregate across all days
  const kwAgg = new Map<string, { keyword: string; cost: number; conversions: number; clicks: number }>();
  for (const kw of keywordDaily) {
    const existing = kwAgg.get(kw.criterionId);
    if (existing) {
      existing.cost += kw.cost;
      existing.conversions += kw.conversions;
      existing.clicks += kw.clicks;
    } else {
      kwAgg.set(kw.criterionId, {
        keyword: kw.keywordText,
        cost: kw.cost,
        conversions: kw.conversions,
        clicks: kw.clicks,
      });
    }
  }

  const allKeywords = Array.from(kwAgg.values());
  const topWasted = allKeywords
    .filter(k => k.conversions === 0 && k.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10)
    .map(k => ({ keyword: k.keyword, cost: parseFloat(k.cost.toFixed(2)), conversions: 0 }));

  const topConverting = allKeywords
    .filter(k => k.conversions > 0)
    .sort((a, b) => {
      const cpaA = a.cost / a.conversions;
      const cpaB = b.cost / b.conversions;
      return cpaA - cpaB; // lowest CPA first
    })
    .slice(0, 10)
    .map(k => ({
      keyword: k.keyword,
      cost: parseFloat(k.cost.toFixed(2)),
      conversions: parseFloat(k.conversions.toFixed(2)),
      cpa: parseFloat((k.cost / k.conversions).toFixed(2)),
    }));

  // Search term highlights
  const wastedTerms = searchTerms
    .filter(t => t.conversions === 0 && t.cost > 5)
    .slice(0, 10)
    .map(t => ({ term: t.searchTerm, cost: t.cost }));

  const convertingTerms = searchTerms
    .filter(t => t.conversions > 0)
    .sort((a, b) => b.conversions - a.conversions)
    .slice(0, 10)
    .map(t => ({ term: t.searchTerm, conversions: t.conversions, cost: t.cost }));

  // Emit signals for high-volume converting search terms
  for (const term of convertingTerms.slice(0, 3)) {
    emitSignal('trending_search_term', { term: term.term, conversions: term.conversions, cost: term.cost });
  }

  return {
    totalDays: uniqueDates.size,
    totalSpend: parseFloat(totalSpend.toFixed(2)),
    totalClicks,
    totalImpressions,
    totalConversions: parseFloat(totalConversions.toFixed(2)),
    avgCpc: totalClicks > 0 ? parseFloat((totalSpend / totalClicks).toFixed(2)) : 0,
    avgCpa: totalConversions > 0 ? parseFloat((totalSpend / totalConversions).toFixed(2)) : 0,
    ctr: totalImpressions > 0 ? parseFloat((totalClicks / totalImpressions).toFixed(4)) : 0,
    spendTrendDirection: spendChange > 0.1 ? 'increasing' : spendChange < -0.1 ? 'decreasing' : 'stable',
    conversionTrendDirection: convChange > 0.1 ? 'increasing' : convChange < -0.1 ? 'decreasing' : 'stable',
    bestDay: dowSorted[0]?.dayOfWeek || 'N/A',
    worstDay: dowSorted[dowSorted.length - 1]?.dayOfWeek || 'N/A',
    topWastedKeywords: topWasted,
    topConvertingKeywords: topConverting,
    monthlyTrends,
    dayOfWeekPerformance: dowPerf,
    searchTermHighlights: { wasted: wastedTerms, converting: convertingTerms },
  };
}

// ─── Claude AI Analysis ─────────────────────────────────────────────────────

async function generateInsightsWithClaude(
  summary: AnalysisSummary,
  account: Record<string, unknown>
): Promise<{ insights: Array<Record<string, unknown>>; narrative: string }> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return { insights: [], narrative: 'Skipped: no ANTHROPIC_API_KEY set.' };
  }

  const systemPrompt = `You are Saffron, an AI PPC agent analyzing 365 days of Google Ads historical data for Inecta.

Your job is to find PATTERNS and ACTIONABLE INSIGHTS — not just report numbers.

Look for:
1. SEASONAL PATTERNS — Are there months/seasons with significantly better or worse performance?
2. DAY-OF-WEEK PATTERNS — Should bid adjustments be made by day of week?
3. SPEND EFFICIENCY TRENDS — Is CPA improving or worsening over time? Where is money being wasted?
4. KEYWORD INSIGHTS — Which keywords are proven winners vs money pits over the full year?
5. SEARCH TERM OPPORTUNITIES — Any search terms that convert but aren't targeted keywords?
6. BUDGET OPTIMIZATION — Is the budget being allocated effectively across campaigns?

Be specific with numbers and dates. Provide actionable recommendations.

Respond with VALID JSON only — no markdown, no code fences. Format:
{
  "insights": [
    {
      "insight_type": "trend|anomaly_pattern|optimization|seasonal",
      "title": "Short descriptive title",
      "description": "2-4 sentence detailed description with specific numbers",
      "confidence": 0.0-1.0,
      "impact_estimate": "high|medium|low",
      "recommended_action": "What should be done about this"
    }
  ],
  "narrative": "A 3-5 sentence executive summary of the historical analysis, written as Saffron in first person. Highlight the most important findings."
}`;

  const userPrompt = `Analyze this ${summary.totalDays}-day historical performance data for "${account.account_name}".

SUMMARY METRICS:
- Total Spend: $${summary.totalSpend.toLocaleString()}
- Total Clicks: ${summary.totalClicks.toLocaleString()}
- Total Impressions: ${summary.totalImpressions.toLocaleString()}
- Total Conversions: ${summary.totalConversions}
- Avg CPC: $${summary.avgCpc}
- Avg CPA: $${summary.avgCpa}
- CTR: ${(summary.ctr * 100).toFixed(2)}%
- Spend Trend: ${summary.spendTrendDirection}
- Conversion Trend: ${summary.conversionTrendDirection}

MONTHLY TRENDS:
${JSON.stringify(summary.monthlyTrends, null, 2)}

DAY-OF-WEEK PERFORMANCE (daily averages):
${JSON.stringify(summary.dayOfWeekPerformance, null, 2)}

TOP WASTED KEYWORDS (spend with zero conversions):
${JSON.stringify(summary.topWastedKeywords, null, 2)}

TOP CONVERTING KEYWORDS (by CPA):
${JSON.stringify(summary.topConvertingKeywords, null, 2)}

SEARCH TERM HIGHLIGHTS:
Wasted (spend, no conversions): ${JSON.stringify(summary.searchTermHighlights.wasted, null, 2)}
Converting: ${JSON.stringify(summary.searchTermHighlights.converting, null, 2)}

ACCOUNT CONTEXT:
Monthly budget: ${account.monthly_budget}
ICP: ${account.icp_definition || 'Not specified'}
Goals: ${account.goals || 'Not specified'}`;

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
    const errBody = await response.text().catch(() => 'unknown');
    console.error(`Anthropic API error [${response.status}]:`, errBody);
    return { insights: [], narrative: `AI analysis failed (${response.status}). Check Anthropic API credits.` };
  }

  const result = await response.json();
  const text = result.content?.[0]?.text || '{}';
  const parsed = parseClaudeJson(text);

  return {
    insights: (parsed.insights as Array<Record<string, unknown>>) || [],
    narrative: (parsed.narrative as string) || '',
  };
}

// ─── GET handler — Return stored insights ────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get('account_id');

    let query = supabase
      .from('ads_agent_historical_insights')
      .select('*')
      .order('created_at', { ascending: false });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query.limit(50);

    if (error) throw error;

    return NextResponse.json({ success: true, insights: data || [] });
  } catch (error) {
    console.error('Error fetching insights:', error);
    return NextResponse.json({ error: 'Failed to fetch insights' }, { status: 500 });
  }
}

// ─── POST handler — Generate new insights ────────────────────────────────────

export async function POST(request: NextRequest) {
  // Verify cron secret for security (skip for manual triggers without auth header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all active accounts
    const { data: accounts, error: acctError } = await supabase
      .from('ads_agent_accounts')
      .select('*')
      .eq('is_active', true);

    if (acctError || !accounts || accounts.length === 0) {
      return NextResponse.json({ message: 'No active accounts found', accounts: 0 });
    }

    const allResults = [];

    for (const account of accounts) {
      console.log(`🌶️ Saffron Insights: Analyzing 365-day history for "${account.account_name}"`);

      try {
        // Pull historical data (chunked) — each query is resilient to failures
        console.log('Pulling campaign historical data...');
        const campaignDaily = await getCampaignHistorical(365);
        console.log(`Got ${campaignDaily.length} campaign daily records`);

        console.log('Pulling keyword historical data...');
        let keywordDaily: Awaited<ReturnType<typeof getKeywordHistorical>> = [];
        try {
          keywordDaily = await getKeywordHistorical(365);
          console.log(`Got ${keywordDaily.length} keyword daily records`);
        } catch (kwErr) {
          console.error('Keyword historical pull failed, continuing without:', kwErr instanceof Error ? kwErr.message : kwErr);
        }

        console.log('Pulling search term report...');
        let searchTerms: Awaited<ReturnType<typeof getSearchTermReport>> = [];
        try {
          searchTerms = await getSearchTermReport(90);
          console.log(`Got ${searchTerms.length} search terms`);
        } catch (stErr) {
          console.error('Search term pull failed, continuing without:', stErr instanceof Error ? stErr.message : stErr);
        }

        // Compute deterministic analysis
        const summary = computeAnalysisSummary(campaignDaily, keywordDaily, searchTerms);
        console.log(`Analysis: ${summary.totalDays} days, $${summary.totalSpend} spend, ${summary.totalConversions} conversions`);

        // AI analysis
        console.log('Sending to Claude for pattern analysis...');
        const { insights, narrative } = await generateInsightsWithClaude(summary, account);
        console.log(`Claude generated ${insights.length} insights`);

        // Store insights in Supabase
        const now = new Date().toISOString();
        for (const insight of insights) {
          await supabase.from('ads_agent_historical_insights').insert({
            account_id: account.id,
            insight_type: insight.insight_type || 'optimization',
            title: insight.title || 'Untitled insight',
            description: insight.description || '',
            data: {
              recommended_action: insight.recommended_action,
              summary_metrics: {
                totalDays: summary.totalDays,
                totalSpend: summary.totalSpend,
                totalConversions: summary.totalConversions,
                avgCpa: summary.avgCpa,
              },
            },
            confidence: insight.confidence || 0.5,
            impact_estimate: insight.impact_estimate || 'medium',
            status: 'active',
            created_at: now,
            updated_at: now,
          });
        }

        // Create notification
        if (insights.length > 0) {
          await supabase.from('ads_agent_notifications').insert({
            account_id: account.id,
            notification_type: 'insight_generated',
            severity: 'info',
            title: `Saffron found ${insights.length} historical insight${insights.length === 1 ? '' : 's'}`,
            message: narrative,
            is_read: false,
            is_dismissed: false,
            created_at: now,
          });
        }

        allResults.push({
          account: account.account_name,
          daysAnalyzed: summary.totalDays,
          totalSpend: summary.totalSpend,
          totalConversions: summary.totalConversions,
          insightsGenerated: insights.length,
          narrative,
          chartData: {
            monthlyTrends: summary.monthlyTrends,
            dayOfWeekPerformance: summary.dayOfWeekPerformance,
            topWastedKeywords: summary.topWastedKeywords.slice(0, 5),
            topConvertingKeywords: summary.topConvertingKeywords.slice(0, 5),
          },
          summary: {
            totalDays: summary.totalDays,
            totalSpend: summary.totalSpend,
            totalClicks: summary.totalClicks,
            totalImpressions: summary.totalImpressions,
            totalConversions: summary.totalConversions,
            avgCpc: summary.avgCpc,
            avgCpa: summary.avgCpa,
            ctr: summary.ctr,
            spendTrendDirection: summary.spendTrendDirection,
            conversionTrendDirection: summary.conversionTrendDirection,
            bestDay: summary.bestDay,
            worstDay: summary.worstDay,
          },
        });
      } catch (err) {
        console.error(`Error analyzing account ${account.account_name}:`, err);
        allResults.push({
          account: account.account_name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results: allResults,
    });
  } catch (error) {
    console.error('Saffron insights error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
