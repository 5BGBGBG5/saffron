/**
 * Google Ads — Budget analysis queries.
 *
 * Pulls campaign budget data with performance metrics for reallocation analysis.
 */

import { queryGoogleAds, microsToDollars } from '../client';

// ─── Brand classification ───────────────────────────────────────────────────

const BRAND_KEYWORDS = ['brand', 'branded', 'inecta'];

function isBrandCampaign(name: string): boolean {
  const lower = name.toLowerCase();
  return BRAND_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CampaignBudgetPerformance {
  campaignId: string;
  campaignName: string;
  status: string;
  budgetId: string;
  dailyBudgetMicros: string;
  dailyBudget: number;
  totalSpend: number;
  totalSpendMicros: string;
  clicks: number;
  impressions: number;
  conversions: number;
  cpa: number;
  ctr: number;
  avgCpc: number;
  /** How much of the budget is actually being used (0-1+) */
  utilizationRate: number;
  /** Whether this is a brand campaign (contains 'brand', 'branded', or 'inecta') */
  isBrand: boolean;
  /** Search impression share (0-1) — fraction of eligible impressions received */
  searchImpressionShare: number;
  /** CTR trend: (7d CTR - 30d CTR) / 30d CTR. Positive = improving. Computed by getBudgetUtilization(). */
  ctrTrend: number;
}

/**
 * Get campaign budget performance for reallocation analysis.
 * Pulls last 30 days by default to get a stable picture.
 */
export async function getCampaignBudgetPerformance(
  dateRange = 'LAST_30_DAYS',
  customerId?: string
): Promise<CampaignBudgetPerformance[]> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign_budget.id,
      campaign_budget.amount_micros,
      metrics.cost_micros,
      metrics.clicks,
      metrics.impressions,
      metrics.conversions,
      metrics.cost_per_conversion,
      metrics.ctr,
      metrics.average_cpc,
      metrics.search_impression_share
    FROM campaign
    WHERE segments.date DURING ${dateRange}
      AND campaign.status = 'ENABLED'
      AND campaign_budget.amount_micros > 0
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await queryGoogleAds(query, customerId);

  // Determine days in range for utilization calculation
  const daysMap: Record<string, number> = {
    'LAST_7_DAYS': 7,
    'LAST_14_DAYS': 14,
    'LAST_30_DAYS': 30,
    'LAST_90_DAYS': 90,
    'THIS_MONTH': new Date().getDate(),
    'LAST_MONTH': new Date(new Date().getFullYear(), new Date().getMonth(), 0).getDate(),
  };
  const days = daysMap[dateRange] || 30;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => {
    const dailyBudgetMicros = row.campaignBudget?.amountMicros || '0';
    const costMicros = row.metrics.costMicros || '0';
    const dailyBudget = microsToDollars(dailyBudgetMicros);
    const totalSpend = microsToDollars(costMicros);
    const totalBudgetAvailable = dailyBudget * days;
    const utilizationRate = totalBudgetAvailable > 0 ? totalSpend / totalBudgetAvailable : 0;

    return {
      campaignId: row.campaign.id,
      campaignName: row.campaign.name,
      status: row.campaign.status,
      budgetId: row.campaignBudget?.id || '',
      dailyBudgetMicros,
      dailyBudget,
      totalSpend,
      totalSpendMicros: costMicros,
      clicks: parseInt(row.metrics.clicks || '0', 10),
      impressions: parseInt(row.metrics.impressions || '0', 10),
      conversions: parseFloat(row.metrics.conversions || '0'),
      cpa: microsToDollars(row.metrics.costPerConversion),
      ctr: parseFloat(row.metrics.ctr || '0'),
      avgCpc: microsToDollars(row.metrics.averageCpc),
      utilizationRate,
      isBrand: isBrandCampaign(row.campaign.name),
      searchImpressionShare: parseFloat(row.metrics.searchImpressionShare || '0'),
      ctrTrend: 0, // Computed by getBudgetUtilization() from 7d vs 30d comparison
    };
  });
}

/**
 * Analyze budget utilization — find campaigns that are under/over-spending
 * relative to their daily budget allocation. Enriches with CTR trend (7d vs 30d).
 */
export async function getBudgetUtilization(customerId?: string) {
  const campaigns = await getCampaignBudgetPerformance('LAST_30_DAYS', customerId);
  const recent = await getCampaignBudgetPerformance('LAST_7_DAYS', customerId);

  // Build 7-day CTR lookup and merge trend into 30-day data
  const recentCtr = new Map(recent.map(c => [c.campaignId, c.ctr]));
  for (const c of campaigns) {
    const ctr7d = recentCtr.get(c.campaignId) ?? c.ctr;
    c.ctrTrend = c.ctr > 0 ? (ctr7d - c.ctr) / c.ctr : 0;
  }

  const underUtilized = campaigns.filter(c => c.utilizationRate < 0.7 && c.totalSpend > 0);
  const overUtilized = campaigns.filter(c => c.utilizationRate > 0.95);
  const efficient = campaigns
    .filter(c => c.conversions > 0)
    .sort((a, b) => a.cpa - b.cpa);
  const inefficient = campaigns
    .filter(c => c.conversions > 0)
    .sort((a, b) => b.cpa - a.cpa);

  return {
    all: campaigns,
    underUtilized,
    overUtilized,
    mostEfficient: efficient.slice(0, 5),
    leastEfficient: inefficient.slice(0, 5),
    brandCampaigns: campaigns.filter(c => c.isBrand),
    nonBrandCampaigns: campaigns.filter(c => !c.isBrand),
    totalMonthlySpend: campaigns.reduce((sum, c) => sum + c.totalSpend, 0),
    totalMonthlyBudget: campaigns.reduce((sum, c) => sum + c.dailyBudget * 30, 0),
    avgCpa: campaigns.reduce((sum, c) => sum + c.cpa, 0) / (campaigns.filter(c => c.cpa > 0).length || 1),
  };
}
