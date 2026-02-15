/**
 * Google Ads API client — barrel export.
 *
 * Zero npm dependencies. Pure REST/JSON over native fetch().
 *
 * Usage:
 *   import { getCampaignPerformance, pauseCampaign } from '@/lib/google-ads';
 *
 * Required env vars:
 *   GOOGLE_ADS_CLIENT_ID
 *   GOOGLE_ADS_CLIENT_SECRET
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_MANAGER_CUSTOMER_ID   (no dashes: 2426007068)
 *   GOOGLE_ADS_CUSTOMER_ID           (no dashes: the client account)
 */

// Core
export { getAccessToken } from './auth';
export {
  googleAdsRequest,
  queryGoogleAds,
  mutateGoogleAds,
  groupedMutate,
  microsToDollars,
  dollarsToMicros,
  resourceName,
  getCustomerId,
  getManagerCustomerId,
} from './client';

// Queries
export { getCampaignPerformance, getCampaignDailyTrend, getTodaySpend } from './queries/campaigns';
export { getKeywordPerformance, getKeyword7DayAvgCpc } from './queries/keywords';
export { getAdPerformance } from './queries/ads';
export { getAuctionInsights } from './queries/auction-insights';
export { getAdLandingPages, getKeywordToUrlMapping } from './queries/landing-pages';
export { getCampaignBudgetPerformance, getBudgetUtilization } from './queries/budget-analysis';

// Mutations
export { pauseCampaign, enableCampaign, createSearchCampaign } from './mutations/campaigns';
export { addKeywords, pauseKeyword, removeKeyword, addNegativeKeywords, removeNegativeKeyword } from './mutations/keywords';
export { adjustKeywordBid, adjustAdGroupBid } from './mutations/bids';
export { adjustCampaignBudget } from './mutations/budgets';
export { createResponsiveSearchAd, pauseAd, enableAd } from './mutations/ads';
