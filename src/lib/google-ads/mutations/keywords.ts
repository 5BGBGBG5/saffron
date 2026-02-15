/**
 * Google Ads — Keyword mutations (add, remove, negatives).
 */

import { mutateGoogleAds, resourceName, getCustomerId } from '../client';

/** Add keywords to an ad group. */
export async function addKeywords(
  adGroupId: string,
  keywords: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
    cpcBidMicros?: string;
  }>,
  customerId?: string
) {
  const cid = (customerId || getCustomerId()).replace(/-/g, '');

  const operations = keywords.map(kw => ({
    create: {
      adGroup: `customers/${cid}/adGroups/${adGroupId}`,
      status: 'ENABLED',
      keyword: {
        text: kw.text,
        matchType: kw.matchType,
      },
      ...(kw.cpcBidMicros && { cpcBidMicros: kw.cpcBidMicros }),
    },
  }));

  return mutateGoogleAds('adGroupCriteria', operations, customerId);
}

/** Pause a keyword (set status to PAUSED). */
export async function pauseKeyword(
  adGroupId: string,
  criterionId: string,
  customerId?: string
) {
  return mutateGoogleAds(
    'adGroupCriteria',
    [{
      update: {
        resourceName: resourceName(customerId, 'adGroupCriteria', `${adGroupId}~${criterionId}`),
        status: 'PAUSED',
      },
      updateMask: 'status',
    }],
    customerId
  );
}

/** Remove a keyword entirely. */
export async function removeKeyword(
  adGroupId: string,
  criterionId: string,
  customerId?: string
) {
  const cid = (customerId || getCustomerId()).replace(/-/g, '');

  return mutateGoogleAds(
    'adGroupCriteria',
    [{ remove: `customers/${cid}/adGroupCriteria/${adGroupId}~${criterionId}` }],
    customerId
  );
}

/** Add negative keywords at the campaign level. */
export async function addNegativeKeywords(
  campaignId: string,
  keywords: Array<{
    text: string;
    matchType: 'EXACT' | 'PHRASE' | 'BROAD';
  }>,
  customerId?: string
) {
  const cid = (customerId || getCustomerId()).replace(/-/g, '');

  const operations = keywords.map(kw => ({
    create: {
      campaign: `customers/${cid}/campaigns/${campaignId}`,
      negative: true,
      keyword: {
        text: kw.text,
        matchType: kw.matchType,
      },
    },
  }));

  return mutateGoogleAds('campaignCriteria', operations, customerId);
}

/** Remove a negative keyword from a campaign. */
export async function removeNegativeKeyword(
  campaignId: string,
  criterionId: string,
  customerId?: string
) {
  const cid = (customerId || getCustomerId()).replace(/-/g, '');

  return mutateGoogleAds(
    'campaignCriteria',
    [{ remove: `customers/${cid}/campaignCriteria/${campaignId}~${criterionId}` }],
    customerId
  );
}
