/**
 * Saffron Recommendation Agent Loop — Tool-use loop for investigating
 * before committing to PPC recommendations.
 *
 * Replaces the single-pass Layer 2 Claude call with an iterative loop
 * where Claude can check cross-agent signals, historical performance,
 * reallocation impact, and self-evaluate against guardrails before
 * submitting final recommendations.
 *
 * Pattern mirrors Cayenne's agent-loop.ts.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AGENT_TOOLS, executeToolCall, AgentToolCall, ToolContext } from './agent-tools';
import { microsToDollars } from './client';

// ─── Budget constraints ─────────────────────────────────────────────────────

const MAX_TOOL_CALLS = 5;
const MAX_DURATION_MS = 30_000; // 30 seconds

// ─── Types ──────────────────────────────────────────────────────────────────

interface Proposal {
  action_type: string;
  action_summary: string;
  action_detail: Record<string, unknown>;
  reason: string;
  risk_level: string;
  priority: number;
  data_snapshot?: Record<string, unknown>;
}

export interface AgentLoopResult {
  action: 'submit' | 'skip';
  proposals: Proposal[];
  narrative: string;
  investigation_summary: string;
  skip_reason?: string;
  iterations: number;
  tools_used: string[];
  tool_calls: AgentToolCall[];
}

// Re-export AgentToolCall for use in run/route.ts
export type { AgentToolCall };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Layer1Result {
  campaigns: any[];
  keywords: any[];
  ads: any[];
  todaySpend: { totalCostMicros: string | number; totalClicks: number; totalImpressions: number; totalConversions: number };
  anomalies: string[];
  guardrailViolations: string[];
  allowedActions: string[];
  guardrails: Array<Record<string, unknown>>;
  account: Record<string, unknown>;
}

// ─── System prompt ──────────────────────────────────────────────────────────

function buildSystemPrompt(layer1: Layer1Result): string {
  return `You are Saffron, an AI PPC agent managing Google Ads campaigns for Inecta. You are part of the SALT Crew.

## Your Role
You analyze Google Ads performance data and propose optimizations. Unlike a simple rule engine, you INVESTIGATE before recommending. Use your tools to check cross-agent signals, historical patterns, and downstream impact before committing to a recommendation.

## Investigation Process
1. Review the performance data provided. Identify areas of concern (high CPA, low CTR, spend anomalies).
2. For budget changes: ALWAYS use check_reallocation_impact before proposing. This prevents the brand-starvation anti-pattern.
3. For keywords with unusual CPA: use get_historical_performance to check if this is seasonal or a real trend.
4. For any keyword or topic you're considering changing: use check_signal_bus to check if Cayenne (Reddit agent) or other SALT agents see organic interest.
5. Before submitting: use evaluate_recommendation to self-check each proposal against guardrails.
6. Call submit_recommendations with your final proposals, or skip_recommendations if nothing is warranted.

## Budget
You have ${MAX_TOOL_CALLS} tool calls. Use them wisely — not every recommendation needs all tools. You MUST call submit_recommendations or skip_recommendations before your budget runs out.

## Critical Constraints
- LOW-VOLUME account (~100 clicks/week). Be conservative. Don't thrash on thin data.
- You CANNOT override guardrails. If a guardrail blocks an action, do not propose it.
- Allowed actions: ${layer1.allowedActions.join(', ')}
- NEVER propose pausing a campaign that has conversions.
- Max bid change: 20% per adjustment.

## Keyword Rehabilitation Rule
NEVER propose pause_keyword or add_negative_keyword for strategic food & beverage industry keywords:
meat, beef, pork, poultry, chicken, seafood, fish, dairy, bakery, brewery, beverage, food processing,
food manufacturing, food safety, HACCP, USDA, and related ERP/software terms.
Instead propose creative improvements (new ad copy, bid adjustments, match type changes).

## Ad Management Rules
- PREFER replace_ad over separate pause_ad + create_ad when swapping underperforming ads.
- replace_ad: when ad is >30% worse CTR/CPA vs siblings with 50+ impressions.
- create_ad: when ad group has only 1 active ad or CTR below 3%.
- pause_ad: when >100 impressions, zero conversions, and ad group has 3+ active ads.
- NEVER pause the last active ad in an ad group.
- For replace_ad: action_detail needs ad_group_id, old_ad_id, headlines (3+), descriptions (2+), final_urls.

## Action Detail ID Rules
ALL IDs (campaign_id, ad_group_id, ad_id, criterion_id, budget_id) MUST be real numeric Google Ads IDs from the data provided. NEVER use placeholders.
If proposing add_negative_keyword for multiple campaigns, create SEPARATE proposals per campaign.

## Account Config
${JSON.stringify({ name: layer1.account.account_name, budget: layer1.account.monthly_budget, mode: layer1.account.agent_mode, icp: layer1.account.icp_definition, goals: layer1.account.goals }, null, 2)}

## Guardrails in Effect
${layer1.guardrails.map((g: Record<string, unknown>) => `- ${g.rule_name}: ${g.threshold_value} (${g.violation_action})`).join('\n')}

## Guardrail Violations This Run
${layer1.guardrailViolations.length > 0 ? layer1.guardrailViolations.join('\n') : 'None'}

## Anomalies Detected
${layer1.anomalies.length > 0 ? layer1.anomalies.join('\n') : 'None'}`;
}

// ─── Initial user message ───────────────────────────────────────────────────

function buildInitialMessage(layer1: Layer1Result, recentDecisions: unknown[]): string {
  const slimAds = layer1.ads.slice(0, 30).map((ad) => ({
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
    finalUrls: ad.finalUrls,
  }));

  return `Here is the current Google Ads performance data. Analyze it, investigate using your tools, and propose optimizations.

CAMPAIGN PERFORMANCE (last 7 days):
${JSON.stringify(layer1.campaigns, null, 2)}

KEYWORD PERFORMANCE (last 7 days):
${JSON.stringify(layer1.keywords.slice(0, 50), null, 2)}

AD PERFORMANCE (last 7 days, top 30 by spend):
${JSON.stringify(slimAds, null, 2)}

TODAY'S SPEND:
${JSON.stringify({ spend: microsToDollars(layer1.todaySpend.totalCostMicros), clicks: layer1.todaySpend.totalClicks, impressions: layer1.todaySpend.totalImpressions, conversions: layer1.todaySpend.totalConversions })}

RECENT DECISION HISTORY (learn from what was approved vs rejected):
${JSON.stringify(recentDecisions, null, 2)}`;
}

// ─── Result builders ────────────────────────────────────────────────────────

function buildSubmitResult(
  input: Record<string, unknown>,
  toolCalls: AgentToolCall[],
  iterations: number
): AgentLoopResult {
  return {
    action: 'submit',
    proposals: (input.proposals as Proposal[]) || [],
    narrative: (input.narrative as string) || '',
    investigation_summary: (input.investigation_summary as string) || '',
    iterations,
    tools_used: [...new Set(toolCalls.map((c) => c.tool_name))],
    tool_calls: toolCalls,
  };
}

function buildSkipResult(
  input: Record<string, unknown>,
  toolCalls: AgentToolCall[],
  iterations: number
): AgentLoopResult {
  return {
    action: 'skip',
    proposals: [],
    narrative: '',
    skip_reason: (input.reason as string) || 'Skipped',
    investigation_summary: (input.investigation_summary as string) || '',
    iterations,
    tools_used: [...new Set(toolCalls.map((c) => c.tool_name))],
    tool_calls: toolCalls,
  };
}

function forceTermination(
  toolCalls: AgentToolCall[],
  iterations: number,
  reason: string
): AgentLoopResult {
  return {
    action: 'skip',
    proposals: [],
    narrative: '',
    skip_reason: `Forced termination: ${reason}`,
    investigation_summary: `Agent was forced to terminate after ${iterations} iterations and ${toolCalls.length} tool calls. Reason: ${reason}`,
    iterations,
    tools_used: [...new Set(toolCalls.map((c) => c.tool_name))],
    tool_calls: toolCalls,
  };
}

// ─── Main loop ──────────────────────────────────────────────────────────────

export async function runRecommendationLoop(
  layer1: Layer1Result,
  accountId: string,
  recentDecisions: unknown[] = []
): Promise<AgentLoopResult> {
  const anthropic = new Anthropic();
  const startTime = Date.now();
  const toolCalls: AgentToolCall[] = [];
  let iterations = 0;

  const toolContext: ToolContext = {
    guardrails: layer1.guardrails,
    layer1Campaigns: layer1.campaigns,
    layer1Ads: layer1.ads,
    accountId,
  };

  const systemPrompt = buildSystemPrompt(layer1);
  const initialMessage = buildInitialMessage(layer1, recentDecisions);

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: 'user', content: initialMessage },
  ];

  // ── Iterative tool-use loop ─────────────────────────────────────────

  while (true) {
    iterations++;

    // Budget check: time
    const elapsed = Date.now() - startTime;
    if (elapsed > MAX_DURATION_MS) {
      return forceTermination(toolCalls, iterations, 'Time budget exceeded');
    }

    // Budget check: tool calls
    if (toolCalls.length >= MAX_TOOL_CALLS) {
      return forceTermination(toolCalls, iterations, 'Tool call budget exceeded');
    }

    // Call Claude with tools
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: systemPrompt,
      tools: AGENT_TOOLS,
      messages,
    });

    // Extract tool_use blocks
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use'
    );

    // If no tool calls, force termination
    if (toolUseBlocks.length === 0) {
      // Check if Claude ended with text (stop_reason === 'end_turn')
      if (response.stop_reason === 'end_turn') {
        return forceTermination(
          toolCalls,
          iterations,
          'Agent ended without calling a terminal tool'
        );
      }
      return forceTermination(toolCalls, iterations, 'No tool calls in response');
    }

    // Process each tool call
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    let terminalResult: AgentLoopResult | null = null;

    for (const toolBlock of toolUseBlocks) {
      const input = toolBlock.input as Record<string, unknown>;

      // Handle terminal tools
      if (toolBlock.name === 'submit_recommendations') {
        terminalResult = buildSubmitResult(input, toolCalls, iterations);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({ acknowledged: true }),
        });
        continue;
      }

      if (toolBlock.name === 'skip_recommendations') {
        terminalResult = buildSkipResult(input, toolCalls, iterations);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({ acknowledged: true }),
        });
        continue;
      }

      // Budget check before executing non-terminal tool
      if (toolCalls.length >= MAX_TOOL_CALLS) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({
            error: 'Tool call budget exceeded. You must call submit_recommendations or skip_recommendations now.',
          }),
        });
        continue;
      }

      const timeRemaining = MAX_DURATION_MS - (Date.now() - startTime);
      if (timeRemaining < 3000) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: JSON.stringify({
            error: 'Time budget nearly exceeded. You must call submit_recommendations or skip_recommendations now.',
          }),
        });
        continue;
      }

      // Execute non-terminal tool
      const { result, call } = await executeToolCall(toolBlock.name, input, toolContext);
      toolCalls.push(call);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: JSON.stringify(result),
      });
    }

    // If a terminal tool was called, return the result
    if (terminalResult) {
      return terminalResult;
    }

    // Otherwise, append assistant response + tool results and continue
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
  }
}
