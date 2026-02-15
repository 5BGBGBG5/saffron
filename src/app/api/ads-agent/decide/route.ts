import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  pauseCampaign,
  enableCampaign,
  addKeywords,
  addNegativeKeywords,
  pauseKeyword,
  adjustKeywordBid,
  adjustAdGroupBid,
  adjustCampaignBudget,
  createResponsiveSearchAd,
  pauseAd,
  enableAd,
} from '@/lib/google-ads';
import { emitSignal } from '@/lib/signals';

export const dynamic = 'force-dynamic';

// AiEO project — Saffron's tables
const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Google Ads execution dispatcher ─────────────────────────────────────────

// Helper: Claude generates camelCase keys but our code expects snake_case — resolve either
function get(detail: Record<string, unknown>, snakeKey: string, camelKey: string): unknown {
  return detail[snakeKey] ?? detail[camelKey];
}

async function executeGoogleAdsAction(
  actionType: string,
  actionDetail: Record<string, unknown>
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
    if (!customerId) {
      return { success: false, error: 'GOOGLE_ADS_CUSTOMER_ID not configured' };
    }

    switch (actionType) {
      case 'pause_campaign': {
        const campId = get(actionDetail, 'campaign_id', 'campaignId');
        if (!campId) return { success: false, error: `Missing campaign_id: ${JSON.stringify(actionDetail)}` };
        const result = await pauseCampaign(String(campId), customerId);
        return { success: true, result };
      }

      case 'enable_campaign': {
        const campId = get(actionDetail, 'campaign_id', 'campaignId');
        if (!campId) return { success: false, error: `Missing campaign_id: ${JSON.stringify(actionDetail)}` };
        const result = await enableCampaign(String(campId), customerId);
        return { success: true, result };
      }

      case 'add_keyword': {
        const agId = get(actionDetail, 'ad_group_id', 'adGroupId');
        const kwText = get(actionDetail, 'keyword_text', 'keywordText');
        const kwMatch = get(actionDetail, 'match_type', 'matchType');
        const cpcBid = get(actionDetail, 'cpc_bid_micros', 'cpcBidMicros');
        if (!agId || !kwText) return { success: false, error: `Missing ad_group_id or keyword_text: ${JSON.stringify(actionDetail)}` };
        const result = await addKeywords(
          String(agId),
          [{
            text: String(kwText),
            matchType: (kwMatch as 'EXACT' | 'PHRASE' | 'BROAD') || 'PHRASE',
            ...(cpcBid ? { cpcBidMicros: String(cpcBid) } : {}),
          }],
          customerId
        );
        return { success: true, result };
      }

      case 'add_negative_keyword': {
        const negCampaignId = get(actionDetail, 'campaign_id', 'campaignId');
        const negText = get(actionDetail, 'keyword_text', 'keywordText');
        const negMatch = get(actionDetail, 'match_type', 'matchType');
        if (!negCampaignId || !negText) {
          return { success: false, error: `Missing campaign_id or keyword_text: ${JSON.stringify(actionDetail)}` };
        }
        const result = await addNegativeKeywords(
          String(negCampaignId),
          [{
            text: String(negText),
            matchType: (negMatch as 'EXACT' | 'PHRASE' | 'BROAD') || 'PHRASE',
          }],
          customerId
        );
        return { success: true, result };
      }

      case 'pause_keyword': {
        const agId = get(actionDetail, 'ad_group_id', 'adGroupId');
        const critId = get(actionDetail, 'criterion_id', 'criterionId');
        if (!agId || !critId) return { success: false, error: `Missing ad_group_id or criterion_id: ${JSON.stringify(actionDetail)}` };
        const result = await pauseKeyword(
          String(agId),
          String(critId),
          customerId
        );
        return { success: true, result };
      }

      case 'adjust_bid': {
        const critId = get(actionDetail, 'criterion_id', 'criterionId');
        const agId = get(actionDetail, 'ad_group_id', 'adGroupId');
        const newBid = get(actionDetail, 'new_bid_micros', 'newBidMicros');
        if (critId) {
          const result = await adjustKeywordBid(
            String(agId),
            String(critId),
            String(newBid),
            customerId
          );
          return { success: true, result };
        } else {
          const result = await adjustAdGroupBid(
            String(agId),
            String(newBid),
            customerId
          );
          return { success: true, result };
        }
      }

      case 'adjust_budget': {
        const budgetId = get(actionDetail, 'budget_id', 'budgetId');
        const newAmount = get(actionDetail, 'new_amount_micros', 'newAmountMicros');
        if (!budgetId || !newAmount) return { success: false, error: `Missing budget_id or new_amount_micros: ${JSON.stringify(actionDetail)}` };
        const result = await adjustCampaignBudget(
          String(budgetId),
          String(newAmount),
          customerId
        );
        return { success: true, result };
      }

      case 'create_ad': {
        const agId = get(actionDetail, 'ad_group_id', 'adGroupId');
        const headlines = (actionDetail.headlines as Array<{ text: string }>);
        const descriptions = (actionDetail.descriptions as Array<{ text: string }>);
        const finalUrls = (get(actionDetail, 'final_urls', 'finalUrls') as string[]);
        const path1 = (actionDetail.path1 as string | undefined);
        const path2 = (actionDetail.path2 as string | undefined);
        if (!agId) return { success: false, error: `Missing ad_group_id: ${JSON.stringify(actionDetail)}` };
        const result = await createResponsiveSearchAd(
          String(agId),
          { headlines, descriptions, finalUrls, path1, path2 },
          customerId
        );
        return { success: true, result };
      }

      case 'pause_ad': {
        const agId = get(actionDetail, 'ad_group_id', 'adGroupId');
        const adId = get(actionDetail, 'ad_id', 'adId');
        if (!agId || !adId) return { success: false, error: `Missing ad_group_id or ad_id: ${JSON.stringify(actionDetail)}` };
        const result = await pauseAd(String(agId), String(adId), customerId);
        return { success: true, result };
      }

      case 'enable_ad': {
        const agId = get(actionDetail, 'ad_group_id', 'adGroupId');
        const adId = get(actionDetail, 'ad_id', 'adId');
        if (!agId || !adId) return { success: false, error: `Missing ad_group_id or ad_id: ${JSON.stringify(actionDetail)}` };
        const result = await enableAd(String(agId), String(adId), customerId);
        return { success: true, result };
      }

      case 'reallocate_budget': {
        // Budget reallocation: decrease source campaign budget, increase target
        const fromBudgetId = get(actionDetail, 'from_budget_id', 'fromBudgetId');
        const toBudgetId = get(actionDetail, 'to_budget_id', 'toBudgetId');
        const amountMicros = get(actionDetail, 'amount_micros', 'amountMicros');
        if (!fromBudgetId || !toBudgetId || !amountMicros) {
          return { success: false, error: `Missing from_budget_id, to_budget_id, or amount_micros: ${JSON.stringify(actionDetail)}` };
        }
        // We need current budgets to calculate new amounts — for now, adjust by the delta
        // The weekly route stores the full reallocation plan in action_detail
        const results = [];
        // Note: adjustCampaignBudget sets absolute amount, so the weekly route
        // should pre-compute the new absolute amounts
        const fromNewAmount = get(actionDetail, 'from_new_amount_micros', 'fromNewAmountMicros');
        const toNewAmount = get(actionDetail, 'to_new_amount_micros', 'toNewAmountMicros');
        if (fromNewAmount) {
          results.push(await adjustCampaignBudget(String(fromBudgetId), String(fromNewAmount), customerId));
        }
        if (toNewAmount) {
          results.push(await adjustCampaignBudget(String(toBudgetId), String(toNewAmount), customerId));
        }
        return { success: true, result: results };
      }

      default:
        return { success: false, error: `Unknown action type: ${actionType}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Google Ads execution failed for ${actionType}:`, message);
    return { success: false, error: message };
  }
}

// ─── POST handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { decision_id, decision, notes } = body;

    if (!decision_id || !decision) {
      return NextResponse.json(
        { error: 'Missing required fields: decision_id, decision' },
        { status: 400 }
      );
    }

    if (!['approved', 'rejected'].includes(decision)) {
      return NextResponse.json(
        { error: 'Decision must be "approved" or "rejected"' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // 1. Fetch the decision queue item
    const { data: queueItem, error: fetchError } = await supabase
      .from('ads_agent_decision_queue')
      .select('*')
      .eq('id', decision_id)
      .single();

    if (fetchError || !queueItem) {
      return NextResponse.json(
        { error: 'Decision queue item not found' },
        { status: 404 }
      );
    }

    if (queueItem.status !== 'pending') {
      return NextResponse.json(
        { error: `Decision already ${queueItem.status}` },
        { status: 409 }
      );
    }

    // 2. If approved, execute the action via Google Ads API
    let executionResult: { success: boolean; result?: unknown; error?: string } | null = null;
    let finalOutcome = decision; // 'approved' or 'rejected'

    if (decision === 'approved') {
      executionResult = await executeGoogleAdsAction(
        queueItem.action_type,
        queueItem.action_detail as Record<string, unknown>
      );

      if (executionResult.success) {
        finalOutcome = 'executed';
      } else {
        // Approval given but execution failed — mark as approved (can retry)
        console.error('Approved but execution failed:', executionResult.error);
      }
    }

    // 3. Update the decision queue item
    const { error: updateQueueError } = await supabase
      .from('ads_agent_decision_queue')
      .update({
        status: finalOutcome === 'executed' ? 'approved' : decision,
        reviewed_by: 'human',
        reviewed_at: now,
        review_notes: notes || null,
      })
      .eq('id', decision_id);

    if (updateQueueError) {
      console.error('Failed to update decision queue:', updateQueueError);
      return NextResponse.json(
        { error: 'Failed to update decision queue' },
        { status: 500 }
      );
    }

    // 4. Update the linked change log entry
    if (queueItem.change_log_id) {
      const { error: updateLogError } = await supabase
        .from('ads_agent_change_log')
        .update({
          outcome: finalOutcome,
          executed_by: 'human',
          executed_at: finalOutcome === 'executed' ? now : null,
        })
        .eq('id', queueItem.change_log_id);

      if (updateLogError) {
        console.error('Failed to update change log:', updateLogError);
      }
    }

    // 5. Create a notification about the decision
    let notifTitle: string;
    let notifMessage: string;
    let notifSeverity: string;

    if (finalOutcome === 'executed') {
      emitSignal('proposal_executed', { decisionId: decision_id, actionType: queueItem.action_type, actionSummary: queueItem.action_summary, accountId: queueItem.account_id });
      notifTitle = `Executed: ${queueItem.action_summary}`;
      notifMessage = notes
        ? `Approved and executed via Google Ads API. Note: "${notes}"`
        : 'Approved and executed via Google Ads API.';
      notifSeverity = 'success';
    } else if (decision === 'approved' && executionResult && !executionResult.success) {
      notifTitle = `Approved but failed: ${queueItem.action_summary}`;
      notifMessage = `Execution error: ${executionResult.error}`;
      notifSeverity = 'warning';
    } else {
      notifTitle = `Rejected: ${queueItem.action_summary}`;
      notifMessage = notes
        ? `Rejected with note: "${notes}"`
        : 'Rejected by human reviewer.';
      notifSeverity = 'info';
    }

    await supabase.from('ads_agent_notifications').insert({
      account_id: queueItem.account_id,
      notification_type: 'agent_action',
      severity: notifSeverity,
      title: notifTitle,
      message: notifMessage,
      related_entity_type: 'decision',
      related_entity_id: decision_id,
      is_read: false,
      is_dismissed: false,
    });

    return NextResponse.json({
      success: true,
      decision_id,
      decision,
      outcome: finalOutcome,
      execution: executionResult,
      message: finalOutcome === 'executed'
        ? 'Approved and executed via Google Ads API.'
        : `Decision ${decision} successfully.`,
    });
  } catch (error) {
    console.error('Decision API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
