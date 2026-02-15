/**
 * Google Ads — Keyword performance queries.
 */

import { queryGoogleAds, microsToDollars } from '../client';

export interface KeywordPerformance {
  criterionId: string;
  keywordText: string;
  matchType: string;
  status: string;
  cpcBidMicros: string | null;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
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
 * Get keyword-level performance across all campaigns.
 */
export async function getKeywordPerformance(
  dateRange = 'LAST_7_DAYS',
  customerId?: string
): Promise<KeywordPerformance[]> {
  const query = `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group_criterion.status,
      ad_group_criterion.cpc_bid_micros,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_from_interactions_rate,
      metrics.cost_per_conversion
    FROM keyword_view
    WHERE segments.date DURING ${dateRange}
      AND ad_group_criterion.status != 'REMOVED'
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await queryGoogleAds(query, customerId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    criterionId: row.adGroupCriterion.criterionId,
    keywordText: row.adGroupCriterion.keyword.text,
    matchType: row.adGroupCriterion.keyword.matchType,
    status: row.adGroupCriterion.status,
    cpcBidMicros: row.adGroupCriterion.cpcBidMicros || null,
    adGroupId: row.adGroup.id,
    adGroupName: row.adGroup.name,
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
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
 * Get 7-day average CPC per keyword (for spike detection).
 */
export async function getKeyword7DayAvgCpc(customerId?: string) {
  const query = `
    SELECT
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group.id,
      campaign.id,
      metrics.average_cpc,
      metrics.clicks,
      metrics.cost_micros
    FROM keyword_view
    WHERE segments.date DURING LAST_7_DAYS
      AND ad_group_criterion.status = 'ENABLED'
      AND metrics.clicks > 0
  `;

  const rows = await queryGoogleAds(query, customerId);

  // Group by keyword and compute average CPC
  const kwMap = new Map<string, { totalCostMicros: bigint; totalClicks: number; text: string; adGroupId: string; campaignId: string }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of rows as any[]) {
    const id = row.adGroupCriterion.criterionId;
    const existing = kwMap.get(id);
    if (existing) {
      existing.totalCostMicros += BigInt(row.metrics.costMicros || '0');
      existing.totalClicks += parseInt(row.metrics.clicks || '0', 10);
    } else {
      kwMap.set(id, {
        totalCostMicros: BigInt(row.metrics.costMicros || '0'),
        totalClicks: parseInt(row.metrics.clicks || '0', 10),
        text: row.adGroupCriterion.keyword.text,
        adGroupId: row.adGroup.id,
        campaignId: row.campaign.id,
      });
    }
  }

  return Array.from(kwMap.entries()).map(([criterionId, data]) => ({
    criterionId,
    keywordText: data.text,
    adGroupId: data.adGroupId,
    campaignId: data.campaignId,
    totalClicks: data.totalClicks,
    avgCpc7Day: data.totalClicks > 0
      ? Number(data.totalCostMicros) / data.totalClicks / 1_000_000
      : 0,
  }));
}
