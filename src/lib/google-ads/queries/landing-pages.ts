/**
 * Google Ads — Landing page / final URL queries.
 *
 * Maps ads to their final URLs along with performance metrics,
 * and joins with keyword data at the ad group level.
 */

import { queryGoogleAds, microsToDollars } from '../client';

export interface AdLandingPage {
  adId: string;
  adType: string;
  finalUrls: string[];
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  clicks: number;
  conversions: number;
  cost: number;
  costMicros: string;
}

/**
 * Get ad-level data with final URLs and performance metrics.
 */
export async function getAdLandingPages(
  dateRange = 'LAST_30_DAYS',
  customerId?: string
): Promise<AdLandingPage[]> {
  const query = `
    SELECT
      ad_group_ad.ad.id,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros
    FROM ad_group_ad
    WHERE ad_group_ad.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
      AND segments.date DURING ${dateRange}
    ORDER BY metrics.clicks DESC
  `;

  const rows = await queryGoogleAds(query, customerId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    adId: row.adGroupAd.ad.id,
    adType: row.adGroupAd.ad.type || 'UNKNOWN',
    finalUrls: row.adGroupAd.ad.finalUrls || [],
    adGroupId: row.adGroup.id,
    adGroupName: row.adGroup.name,
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    clicks: parseInt(row.metrics.clicks || '0', 10),
    conversions: parseFloat(row.metrics.conversions || '0'),
    cost: microsToDollars(row.metrics.costMicros),
    costMicros: row.metrics.costMicros || '0',
  }));
}

export interface KeywordUrlMapping {
  keywordText: string;
  matchType: string;
  adGroupId: string;
  adGroupName: string;
  campaignId: string;
  campaignName: string;
  finalUrls: string[];
  clicks: number;
  conversions: number;
  cost: number;
}

/**
 * Build a keyword → landing page mapping by joining keyword data
 * with ad URLs at the ad group level.
 *
 * Since keywords don't have URLs directly, we match via ad group:
 * keywords in the same ad group share the same ad URLs.
 */
export async function getKeywordToUrlMapping(
  dateRange = 'LAST_30_DAYS',
  customerId?: string
): Promise<KeywordUrlMapping[]> {
  // Step 1: Get keywords with performance
  const kwQuery = `
    SELECT
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      ad_group.id,
      ad_group.name,
      campaign.id,
      campaign.name,
      metrics.clicks,
      metrics.conversions,
      metrics.cost_micros
    FROM keyword_view
    WHERE segments.date DURING ${dateRange}
      AND ad_group_criterion.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
      AND metrics.impressions > 0
    ORDER BY metrics.clicks DESC
  `;

  const kwRows = await queryGoogleAds(kwQuery, customerId);

  // Step 2: Get ad group → URL mapping
  const adQuery = `
    SELECT
      ad_group.id,
      ad_group_ad.ad.final_urls
    FROM ad_group_ad
    WHERE ad_group_ad.status = 'ENABLED'
      AND campaign.status = 'ENABLED'
  `;

  const adRows = await queryGoogleAds(adQuery, customerId);

  // Build ad group → URLs lookup
  const adGroupUrls = new Map<string, string[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of adRows as any[]) {
    const agId = row.adGroup.id;
    const urls = row.adGroupAd?.ad?.finalUrls || [];
    if (urls.length > 0) {
      const existing = adGroupUrls.get(agId) || [];
      // Deduplicate URLs
      const combined = [...new Set([...existing, ...urls])];
      adGroupUrls.set(agId, combined);
    }
  }

  // Step 3: Join
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return kwRows.map((row: any) => ({
    keywordText: row.adGroupCriterion.keyword.text,
    matchType: row.adGroupCriterion.keyword.matchType,
    adGroupId: row.adGroup.id,
    adGroupName: row.adGroup.name,
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    finalUrls: adGroupUrls.get(row.adGroup.id) || [],
    clicks: parseInt(row.metrics.clicks || '0', 10),
    conversions: parseFloat(row.metrics.conversions || '0'),
    cost: microsToDollars(row.metrics.costMicros),
  }));
}
