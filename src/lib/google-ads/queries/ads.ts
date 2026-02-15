/**
 * Google Ads — Ad creative performance queries.
 */

import { queryGoogleAds, microsToDollars } from '../client';

export interface AdPerformance {
  adId: string;
  adType: string;
  headlines: string[];
  descriptions: string[];
  finalUrls: string[];
  status: string;
  approvalStatus: string;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
}

/**
 * Get responsive search ad performance.
 */
export async function getAdPerformance(
  dateRange = 'LAST_7_DAYS',
  customerId?: string
): Promise<AdPerformance[]> {
  const query = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.type,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.final_urls,
      ad_group_ad.status,
      ad_group_ad.policy_summary.approval_status,
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
      metrics.cost_per_conversion
    FROM ad_group_ad
    WHERE segments.date DURING ${dateRange}
      AND ad_group_ad.status != 'REMOVED'
      AND ad_group_ad.ad.type = 'RESPONSIVE_SEARCH_AD'
    ORDER BY metrics.cost_micros DESC
  `;

  const rows = await queryGoogleAds(query, customerId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => {
    const rsa = row.adGroupAd.ad.responsiveSearchAd || {};
    return {
      adId: row.adGroupAd.ad.id,
      adType: row.adGroupAd.ad.type,
      headlines: (rsa.headlines || []).map((h: { text: string }) => h.text),
      descriptions: (rsa.descriptions || []).map((d: { text: string }) => d.text),
      finalUrls: row.adGroupAd.ad.finalUrls || [],
      status: row.adGroupAd.status,
      approvalStatus: row.adGroupAd.policySummary?.approvalStatus || 'UNKNOWN',
      adGroupId: row.adGroup.id,
      adGroupName: row.adGroup.name,
      campaignId: row.campaign.id,
      campaignName: row.campaign.name,
      impressions: parseInt(row.metrics.impressions || '0', 10),
      clicks: parseInt(row.metrics.clicks || '0', 10),
      ctr: parseFloat(row.metrics.ctr || '0'),
      avgCpc: microsToDollars(row.metrics.averageCpc),
      cost: microsToDollars(row.metrics.costMicros),
      conversions: parseFloat(row.metrics.conversions || '0'),
      costPerConversion: microsToDollars(row.metrics.costPerConversion),
    };
  });
}
