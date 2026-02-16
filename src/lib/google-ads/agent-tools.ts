/**
 * Saffron Agent Tools — Tool definitions and execution handlers for the
 * recommendation agent loop.
 *
 * 5 tools:
 *   1. check_signal_bus       — Cross-agent intelligence from SALT Crew
 *   2. get_historical_performance — Campaign/keyword trends + past adjustment outcomes
 *   3. check_reallocation_impact  — Budget decrease impact analysis
 *   4. evaluate_recommendation    — Self-check against guardrails
 *   5. submit_recommendations / skip_recommendations — Terminal actions
 */

import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../supabase';
import { getCampaignHistorical, getKeywordHistorical } from './queries/historical';
import { getBudgetUtilization } from './queries/budget-analysis';
import { microsToDollars } from './client';
import { INDUSTRY_TERMS } from '../ads-agent/rehabilitation';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentToolCall {
  tool_name: string;
  input: Record<string, unknown>;
  output: unknown;
  duration_ms: number;
}

export interface ToolContext {
  guardrails: Array<Record<string, unknown>>;
  layer1Campaigns: Array<Record<string, unknown>>;
  layer1Ads: Array<Record<string, unknown>>;
  accountId: string;
}

// ─── Tool Definitions (Anthropic SDK format) ────────────────────────────────

export const AGENT_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'check_signal_bus',
    description:
      'Query the SALT Crew shared signal bus for recent signals from other agents (especially Cayenne/Reddit) related to a keyword or topic. Use this when considering changes to a keyword or campaign to check if another agent sees organic interest or related activity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description: 'Keyword or topic to search signals for (e.g. "meat erp", "dairy processing")',
        },
        lookback_days: {
          type: 'number',
          description: 'How many days back to search (default 7, max 30)',
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'get_historical_performance',
    description:
      'Pull historical performance for a specific campaign or keyword over 30/60/90 days. Returns daily metrics, trend direction, and what happened after previous Saffron adjustments. Use this to check for seasonality, detect if a CPA spike is temporary, or see if a past adjustment helped or hurt.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: {
          type: 'string',
          description: 'Google Ads campaign ID to pull history for',
        },
        keyword_text: {
          type: 'string',
          description: 'Keyword text to pull history for (use instead of campaign_id for keyword-level analysis)',
        },
        days: {
          type: 'number',
          description: 'How many days of history (default 30, max 90)',
        },
      },
      required: [],
    },
  },
  {
    name: 'check_reallocation_impact',
    description:
      'Before recommending a budget decrease on a campaign, check what campaigns would absorb the freed budget and whether they can handle it effectively. Prevents the brand-starvation anti-pattern. Returns target campaigns with their efficiency metrics, brand/non-brand safety check, and cumulative loss tracking.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_campaign_id: {
          type: 'string',
          description: 'The campaign ID you want to decrease budget on',
        },
        decrease_amount_micros: {
          type: 'string',
          description: 'Optional: the specific amount in micros you plan to decrease',
        },
      },
      required: ['source_campaign_id'],
    },
  },
  {
    name: 'evaluate_recommendation',
    description:
      'Self-check a draft recommendation against Saffron guardrails BEFORE submitting. If the recommendation violates guardrails, revise it and re-evaluate. Use this to catch issues like budget floor violations, bid cap breaches, or protected keyword/campaign conflicts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_type: {
          type: 'string',
          description: 'The action type (e.g. adjust_budget, adjust_bid, pause_keyword)',
        },
        action_detail: {
          type: 'object' as const,
          description: 'The full action_detail object for this recommendation',
        },
        reason: {
          type: 'string',
          description: 'The reason/rationale for this recommendation',
        },
      },
      required: ['action_type', 'action_detail', 'reason'],
    },
  },
  {
    name: 'submit_recommendations',
    description:
      'TERMINAL. Submit your final recommendations to the decision queue. Include all proposals and a summary of what you investigated. The agent loop ends after this call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        proposals: {
          type: 'array',
          description: 'Array of recommendations to submit',
          items: {
            type: 'object' as const,
            properties: {
              action_type: { type: 'string' },
              action_summary: { type: 'string', description: 'One-line summary for human reviewer' },
              action_detail: { type: 'object' as const, description: 'Fields needed to execute the action' },
              reason: {
                type: 'string',
                description:
                  '3-5 sentences: (1) metrics that triggered this, (2) comparison context, (3) guardrail context, (4) what you investigated and found, (5) expected outcome',
              },
              risk_level: { type: 'string', description: 'low, medium, or high' },
              priority: { type: 'number', description: '1-10' },
              data_snapshot: { type: 'object' as const, description: 'Key data points supporting this' },
            },
            required: ['action_type', 'action_summary', 'action_detail', 'reason', 'risk_level', 'priority'],
          },
        },
        narrative: {
          type: 'string',
          description: '2-4 sentence summary of what you observed and recommend, in first person as Saffron',
        },
        investigation_summary: {
          type: 'string',
          description: 'Summary of what tools you used, what you found, and how it informed your recommendations',
        },
      },
      required: ['proposals', 'narrative', 'investigation_summary'],
    },
  },
  {
    name: 'skip_recommendations',
    description:
      'TERMINAL. Explicitly decide not to make any recommendations this run, with a reason. Use when everything looks healthy or data is insufficient. The agent loop ends after this call.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Why no recommendations are warranted',
        },
        investigation_summary: {
          type: 'string',
          description: 'Summary of what you investigated before deciding to skip',
        },
      },
      required: ['reason', 'investigation_summary'],
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────────────

export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  context: ToolContext
): Promise<{ result: unknown; call: AgentToolCall }> {
  const startTime = Date.now();
  let result: unknown;

  switch (toolName) {
    // ── 1. check_signal_bus ──────────────────────────────────────────────
    case 'check_signal_bus': {
      const topic = input.topic as string;
      const lookbackDays = Math.min((input.lookback_days as number) || 7, 30);
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

      try {
        // Use Supabase text search via casting payload to text, not JSON.stringify scan
        const { data } = await supabase
          .from('shared_agent_signals')
          .select('source_agent, event_type, payload, created_at')
          .gte('created_at', since)
          .ilike('payload::text', `%${topic}%`)
          .order('created_at', { ascending: false })
          .limit(10);

        result = { signals: data || [], count: (data || []).length };
      } catch {
        // Signal bus may not exist — fail gracefully
        result = { signals: [], count: 0, note: 'Signal bus unavailable' };
      }
      break;
    }

    // ── 2. get_historical_performance ────────────────────────────────────
    case 'get_historical_performance': {
      const campaignId = input.campaign_id as string | undefined;
      const keywordText = input.keyword_text as string | undefined;
      const days = Math.min((input.days as number) || 30, 90);

      if (!campaignId && !keywordText) {
        result = { error: 'Provide either campaign_id or keyword_text' };
        break;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let daily: any[] = [];
        let entityLabel = '';

        if (campaignId) {
          const allDaily = await getCampaignHistorical(days);
          daily = allDaily.filter((d) => d.campaignId === campaignId);
          entityLabel = `campaign ${campaignId}`;
        } else if (keywordText) {
          const allDaily = await getKeywordHistorical(days);
          daily = allDaily.filter(
            (d) => d.keywordText.toLowerCase() === keywordText!.toLowerCase()
          );
          entityLabel = `keyword "${keywordText}"`;
        }

        // Compute trend: compare recent half vs older half
        const mid = Math.floor(daily.length / 2);
        const olderHalf = daily.slice(0, mid);
        const recentHalf = daily.slice(mid);

        const avgMetric = (arr: Array<Record<string, unknown>>, key: string) => {
          const vals = arr.map((d) => Number(d[key] || 0)).filter((v) => v > 0);
          return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
        };

        const recentCpa = avgMetric(recentHalf, 'costPerConversion');
        const olderCpa = avgMetric(olderHalf, 'costPerConversion');
        const cpaPctChange = olderCpa > 0 ? ((recentCpa - olderCpa) / olderCpa) * 100 : 0;

        const recentCtr = avgMetric(recentHalf, 'ctr');
        const olderCtr = avgMetric(olderHalf, 'ctr');

        const direction =
          cpaPctChange < -10 ? 'improving' : cpaPctChange > 10 ? 'declining' : 'stable';

        // Pull past adjustments from change log
        const adjustmentFilter = campaignId
          ? `action_detail.ilike.%${campaignId}%`
          : `action_detail.ilike.%${keywordText}%`;

        const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data: pastAdjustments } = await supabase
          .from('ads_agent_change_log')
          .select('action_type, action_detail, reason, outcome, created_at')
          .or(adjustmentFilter)
          .gte('created_at', threeMonthsAgo)
          .in('outcome', ['executed', 'auto_executed'])
          .order('created_at', { ascending: false })
          .limit(10);

        // For each past adjustment, pull the 7-day aftermath metrics
        const adjustmentsWithAftermath = [];
        for (const adj of (pastAdjustments || []).slice(0, 5)) {
          const adjDate = new Date(adj.created_at);
          const afterStart = adjDate.toISOString().split('T')[0];
          const afterEnd = new Date(adjDate.getTime() + 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];
          const beforeStart = new Date(adjDate.getTime() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split('T')[0];

          // Find metrics from the daily data that fall in the before/after windows
          const beforeMetrics = daily.filter(
            (d) => (d.date as string) >= beforeStart && (d.date as string) < afterStart
          );
          const afterMetrics = daily.filter(
            (d) => (d.date as string) >= afterStart && (d.date as string) <= afterEnd
          );

          const beforeCpa = avgMetric(beforeMetrics, 'costPerConversion');
          const afterCpa = avgMetric(afterMetrics, 'costPerConversion');
          const cpaChange = beforeCpa > 0 ? ((afterCpa - beforeCpa) / beforeCpa) * 100 : null;

          adjustmentsWithAftermath.push({
            date: adj.created_at,
            action_type: adj.action_type,
            action_detail: adj.action_detail,
            reason: adj.reason,
            aftermath: afterMetrics.length > 0
              ? {
                  cpa_before: Math.round(beforeCpa * 100) / 100,
                  cpa_after: Math.round(afterCpa * 100) / 100,
                  cpa_change_pct: cpaChange !== null ? Math.round(cpaChange * 10) / 10 : null,
                  days_of_data: afterMetrics.length,
                }
              : { note: 'Insufficient post-adjustment data' },
          });
        }

        // Slim daily data for context (last 14 days only to keep response manageable)
        const recentDaily = daily.slice(-14).map((d) => ({
          date: d.date,
          impressions: d.impressions,
          clicks: d.clicks,
          cost: typeof d.cost === 'number' ? d.cost : microsToDollars(d.cost as string | number),
          conversions: d.conversions,
          cpa: typeof d.costPerConversion === 'number'
            ? d.costPerConversion
            : microsToDollars(d.costPerConversion as string | number),
        }));

        result = {
          entity: entityLabel,
          days_of_data: daily.length,
          recent_daily: recentDaily,
          trend: {
            direction,
            recent_cpa: Math.round(recentCpa * 100) / 100,
            historical_cpa: Math.round(olderCpa * 100) / 100,
            cpa_pct_change: Math.round(cpaPctChange * 10) / 10,
            recent_ctr: Math.round(recentCtr * 10000) / 10000,
            historical_ctr: Math.round(olderCtr * 10000) / 10000,
          },
          previous_adjustments: adjustmentsWithAftermath,
        };
      } catch (err) {
        result = { error: `Failed to fetch historical data: ${err instanceof Error ? err.message : String(err)}` };
      }
      break;
    }

    // ── 3. check_reallocation_impact ─────────────────────────────────────
    case 'check_reallocation_impact': {
      const sourceCampaignId = input.source_campaign_id as string;
      const decreaseAmountMicros = input.decrease_amount_micros as string | undefined;

      try {
        const utilization = await getBudgetUtilization();
        const source = utilization.all.find((c) => c.campaignId === sourceCampaignId);

        if (!source) {
          result = { error: `Campaign ${sourceCampaignId} not found in budget utilization data` };
          break;
        }

        // Find potential target campaigns (same brand/non-brand category)
        const sameCategory = source.isBrand
          ? utilization.brandCampaigns
          : utilization.nonBrandCampaigns;

        const potentialTargets = sameCategory
          .filter(
            (c) =>
              c.campaignId !== sourceCampaignId &&
              c.utilizationRate < 0.95 && // Not already maxed out
              c.status === 'ENABLED'
          )
          .map((c) => ({
            campaignId: c.campaignId,
            campaignName: c.campaignName,
            dailyBudget: c.dailyBudget,
            utilizationRate: Math.round(c.utilizationRate * 100) / 100,
            cpa: Math.round(c.cpa * 100) / 100,
            ctr: Math.round(c.ctr * 10000) / 10000,
            ctrTrend: Math.round(c.ctrTrend * 100) / 100,
            impressionShare: Math.round(c.searchImpressionShare * 100) / 100,
            conversions: c.conversions,
            isBrand: c.isBrand,
            headroom: Math.round((1 - c.utilizationRate) * c.dailyBudget * 100) / 100,
          }))
          .sort((a, b) => a.cpa - b.cpa); // Best CPA first

        // Check creative protection (new ads in last 14 days)
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const { data: recentCreatives } = await supabase
          .from('ads_agent_change_log')
          .select('action_type, action_detail, created_at')
          .eq('action_type', 'create_ad')
          .gte('created_at', twoWeeksAgo)
          .in('outcome', ['executed', 'auto_executed']);

        const sourceHasNewCreatives = (recentCreatives || []).some(
          (c) => JSON.stringify(c.action_detail).includes(sourceCampaignId)
        );

        // Check cumulative loss (budget decreases in last 60 days)
        const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
        const { data: pastReallocations } = await supabase
          .from('ads_agent_change_log')
          .select('action_detail, data_used, created_at')
          .or(`action_type.eq.reallocate_budget,action_type.eq.adjust_budget`)
          .gte('created_at', sixtyDaysAgo)
          .in('outcome', ['executed', 'auto_executed']);

        // Sum budget decreases for source campaign
        let cumulativeLoss = 0;
        for (const r of pastReallocations || []) {
          const detail = typeof r.data_used === 'string' ? JSON.parse(r.data_used) : r.data_used;
          if (detail?.from_campaign_id === sourceCampaignId && detail?.amount_micros) {
            cumulativeLoss += Number(detail.amount_micros);
          }
        }
        const cumulativeLossDollars = microsToDollars(cumulativeLoss);
        const cumulativeLossPct =
          source.dailyBudget > 0 ? (cumulativeLossDollars / (source.dailyBudget * 60)) * 100 : 0;

        result = {
          source: {
            campaignId: source.campaignId,
            campaignName: source.campaignName,
            dailyBudget: source.dailyBudget,
            cpa: Math.round(source.cpa * 100) / 100,
            utilizationRate: Math.round(source.utilizationRate * 100) / 100,
            isBrand: source.isBrand,
            hasNewCreatives: sourceHasNewCreatives,
            decreaseAmount: decreaseAmountMicros
              ? microsToDollars(decreaseAmountMicros)
              : undefined,
          },
          potential_targets: potentialTargets.slice(0, 5),
          brand_non_brand_safe: potentialTargets.length > 0,
          cumulative_loss: {
            total_dollars: Math.round(cumulativeLossDollars * 100) / 100,
            pct_of_60day_budget: Math.round(cumulativeLossPct * 10) / 10,
            exceeds_40pct_threshold: cumulativeLossPct > 40,
          },
          warnings: [
            ...(sourceHasNewCreatives
              ? ['Source campaign has new creatives deployed in last 14 days (creative protection window)']
              : []),
            ...(cumulativeLossPct > 40
              ? [`Cumulative budget loss exceeds 40% threshold (${Math.round(cumulativeLossPct)}%)`]
              : []),
            ...(source.dailyBudget <= 25
              ? ['Source campaign is at or below $25/day floor']
              : []),
            ...(potentialTargets.length === 0
              ? ['No viable target campaigns found in same brand/non-brand category']
              : []),
          ],
        };
      } catch (err) {
        result = {
          error: `Failed to check reallocation impact: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      break;
    }

    // ── 4. evaluate_recommendation ───────────────────────────────────────
    case 'evaluate_recommendation': {
      const actionType = input.action_type as string;
      const actionDetail = input.action_detail as Record<string, unknown>;
      const violations: string[] = [];
      const warnings: string[] = [];

      // Budget floor check ($25/day)
      if (actionType === 'adjust_budget' && actionDetail.new_amount_micros) {
        const newBudgetDollars = microsToDollars(actionDetail.new_amount_micros as string);
        if (newBudgetDollars < 25) {
          violations.push(`Budget floor violation: $${newBudgetDollars.toFixed(2)}/day is below $25 minimum`);
        }
      }

      // Bid cap check (20% max)
      if (actionType === 'adjust_bid' && actionDetail.new_bid_micros) {
        // Find current bid from layer1 data
        const criterionId = actionDetail.criterion_id as string;
        const currentKw = context.layer1Campaigns
          ? undefined // keywords aren't in campaigns, check layer1 data passed through
          : undefined;
        if (currentKw) {
          // Would check bid delta here if keyword data available
        }
        // Can't fully validate without current bid — add warning
        warnings.push('Bid cap (20% max change) cannot be fully validated without current bid data');
      }

      // Keyword rehabilitation check
      if (
        (actionType === 'pause_keyword' || actionType === 'add_negative_keyword') &&
        actionDetail.keyword_text
      ) {
        const kwText = (actionDetail.keyword_text as string).toLowerCase();
        const isStrategic = INDUSTRY_TERMS.some((term) => kwText.includes(term));
        if (isStrategic) {
          violations.push(
            `Keyword rehabilitation violation: "${actionDetail.keyword_text}" is a strategic industry keyword. Use replace_ad, adjust_bid, or creative improvements instead.`
          );
        }
      }

      // Protected campaign check
      if (actionType === 'pause_campaign') {
        const campaignId = actionDetail.campaign_id as string;
        const campaign = context.layer1Campaigns.find(
          (c) => String(c.campaignId) === String(campaignId)
        );
        if (campaign && Number(campaign.conversions || 0) > 0) {
          violations.push(
            `Cannot pause campaign with conversions (${campaign.conversions} in last 7 days)`
          );
        }
      }

      // Last active ad check
      if (actionType === 'pause_ad') {
        const adGroupId = actionDetail.ad_group_id as string;
        const activeAdsInGroup = context.layer1Ads.filter(
          (a) => String(a.adGroupId) === String(adGroupId) && a.status === 'ENABLED'
        );
        if (activeAdsInGroup.length <= 1) {
          violations.push(
            `Cannot pause last active ad in ad group ${adGroupId} (only ${activeAdsInGroup.length} active)`
          );
        }
      }

      // ID validation
      const idFields = ['campaign_id', 'ad_group_id', 'ad_id', 'criterion_id', 'budget_id'];
      for (const field of idFields) {
        const val = actionDetail[field] as string | undefined;
        if (val && !/^\d+$/.test(String(val))) {
          violations.push(`Invalid ID: ${field} = "${val}" (must be numeric)`);
        }
      }

      result = {
        passes: violations.length === 0,
        violations,
        warnings,
      };
      break;
    }

    // ── 5. Terminal tools ────────────────────────────────────────────────
    case 'submit_recommendations':
    case 'skip_recommendations': {
      result = { acknowledged: true, action: toolName };
      break;
    }

    default:
      result = { error: `Unknown tool: ${toolName}` };
  }

  return {
    result,
    call: {
      tool_name: toolName,
      input,
      output: result,
      duration_ms: Date.now() - startTime,
    },
  };
}
