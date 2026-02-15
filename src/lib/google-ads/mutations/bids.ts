/**
 * Google Ads — Bid mutations.
 */

import { mutateGoogleAds, resourceName } from '../client';

/** Adjust a keyword-level CPC bid. */
export async function adjustKeywordBid(
  adGroupId: string,
  criterionId: string,
  newCpcBidMicros: string,
  customerId?: string
) {
  return mutateGoogleAds(
    'adGroupCriteria',
    [{
      update: {
        resourceName: resourceName(customerId, 'adGroupCriteria', `${adGroupId}~${criterionId}`),
        cpcBidMicros: newCpcBidMicros,
      },
      updateMask: 'cpc_bid_micros',
    }],
    customerId
  );
}

/** Adjust an ad group default CPC bid. */
export async function adjustAdGroupBid(
  adGroupId: string,
  newCpcBidMicros: string,
  customerId?: string
) {
  return mutateGoogleAds(
    'adGroups',
    [{
      update: {
        resourceName: resourceName(customerId, 'adGroups', adGroupId),
        cpcBidMicros: newCpcBidMicros,
      },
      updateMask: 'cpc_bid_micros',
    }],
    customerId
  );
}
