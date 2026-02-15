/**
 * Google Ads — Auction Insights queries.
 *
 * Pulls competitive data showing which advertisers compete in the same auctions.
 */

import { queryGoogleAds } from '../client';

export interface AuctionInsight {
  campaignId: string;
  campaignName: string;
  competitorDomain: string;
  impressionShare: number;
  overlapRate: number;
  outrankingShare: number;
  positionAboveRate: number;
  topOfPageRate: number;
  absTopOfPageRate: number;
}

/**
 * Get auction insight data showing competitor performance by campaign.
 *
 * Note: The auction_insight resource requires campaign.status = ENABLED.
 * The API returns one row per (campaign, competitor) pair.
 */
export async function getAuctionInsights(
  dateRange = 'LAST_30_DAYS',
  customerId?: string
): Promise<AuctionInsight[]> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.auction_insight_domain,
      metrics.auction_insight_search_impression_share,
      metrics.auction_insight_search_overlap_rate,
      metrics.auction_insight_search_outranking_share,
      metrics.auction_insight_search_position_above_rate,
      metrics.auction_insight_search_top_impression_percentage,
      metrics.auction_insight_search_absolute_top_impression_percentage
    FROM auction_insight
    WHERE campaign.status = 'ENABLED'
      AND segments.date DURING ${dateRange}
  `;

  const rows = await queryGoogleAds(query, customerId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((row: any) => ({
    campaignId: row.campaign.id,
    campaignName: row.campaign.name,
    competitorDomain: row.segments?.auctionInsightDomain || 'unknown',
    impressionShare: parseFloat(row.metrics.auctionInsightSearchImpressionShare || '0'),
    overlapRate: parseFloat(row.metrics.auctionInsightSearchOverlapRate || '0'),
    outrankingShare: parseFloat(row.metrics.auctionInsightSearchOutrankingShare || '0'),
    positionAboveRate: parseFloat(row.metrics.auctionInsightSearchPositionAboveRate || '0'),
    topOfPageRate: parseFloat(row.metrics.auctionInsightSearchTopImpressionPercentage || '0'),
    absTopOfPageRate: parseFloat(row.metrics.auctionInsightSearchAbsoluteTopImpressionPercentage || '0'),
  }));
}
