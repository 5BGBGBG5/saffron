/**
 * Google Ads — Campaign performance queries.
 */

import { queryGoogleAds, microsToDollars } from '../client';

export interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  status: string;
  channelType: string;
  biddingStrategy: string;
  dailyBudgetMicros: string | null;
  budgetId: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  cost: number;
  costMicros: string;
  conversions: number;
  conversionRate: number;
  costPerConversion: number;
}

/**
 * Get campaign-level performance for a date range.
 * Default: LAST_7_DAYS for the low-volume use case.
 */
export async function getCampaignPerformance(
  dateRange = 'LAST_7_DAYS',
  customerId?: string
): Promise<CampaignPerformance[]> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign.bidding_strategy_type,
      campaign_budget.id,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion
    FROM campaign
    WHERE segments.date DURING ${dateRange}
      AND campaign.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await queryGoogleAds(query, customerId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    status: row.campaign.status,
    channelType: row.campaign.advertisingChannelType,
    biddingStrategy: row.campaign.biddingStrategyType,
    budgetId: row.campaignBudget?.id || null,
    dailyBudgetMicros: row.campaignBudget?.amountMicros || null,
    impressions: parseInt(row.metrics.impressions || '0', 10),
    clicks: parseInt(row.metrics.clicks || '0', 10),
    ctr: parseFloat(row.metrics.ctr || '0'),
    avgCpc: microsToDollars(row.metrics.averageCpc),
    cost: microsToDollars(row.metrics.costMicros),
    costMicros: row.metrics.costMicros || '0',
    conversions: parseFloat(row.metrics.conversions || '0'),
    conversionRate: parseFloat(row.metrics.conversionsFromInteractionsRate || '0'),
    costPerConversion: microsToDollars(row.metrics.costPerConversion),
  }));
}

/**
 * Get daily performance for a specific campaign (for trend analysis).
 */
export async function getCampaignDailyTrend(
  campaignId: string,
  dateRange = 'LAST_30_DAYS',
  customerId?: string
) {
  const query = `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE campaign.id = ${campaignId}
      AND segments.date DURING ${dateRange}
    ORDER BY segments.date ASC
  `;

  const rows = await queryGoogleAds(query, customerId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    date: row.segments.date,
    impressions: parseInt(row.metrics.impressions || '0', 10),
    clicks: parseInt(row.metrics.clicks || '0', 10),
    ctr: parseFloat(row.metrics.ctr || '0'),
    avgCpc: microsToDollars(row.metrics.averageCpc),
    cost: microsToDollars(row.metrics.costMicros),
    conversions: parseFloat(row.metrics.conversions || '0'),
    costPerConversion: microsToDollars(row.metrics.costPerConversion),
  }));
}

/**
 * Get today's spend across all active campaigns (for budget pacing).
 */
export async function getTodaySpend(customerId?: string): Promise<{
  totalCostMicros: string;
  totalClicks: number;
  totalImpressions: number;
  totalConversions: number;
}> {
  const query = `
    SELECT
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions
    FROM campaign
    WHERE segments.date DURING TODAY
      AND campaign.status = 'ENABLED'
  `;

  const rows = await queryGoogleAds(query, customerId);

  let totalCostMicros = BigInt(0);
  let totalClicks = 0;
  let totalImpressions = 0;
  let totalConversions = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of rows as any[]) {
    totalCostMicros += BigInt(row.metrics.costMicros || '0');
    totalClicks += parseInt(row.metrics.clicks || '0', 10);
    totalImpressions += parseInt(row.metrics.impressions || '0', 10);
    totalConversions += parseFloat(row.metrics.conversions || '0');
  }

  return {
    totalCostMicros: totalCostMicros.toString(),
    totalClicks,
    totalImpressions,
    totalConversions,
  };
}
