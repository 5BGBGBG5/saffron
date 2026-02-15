/**
 * Google Ads — Budget mutations.
 */

import { mutateGoogleAds, resourceName } from '../client';

/** Adjust a campaign budget. */
export async function adjustCampaignBudget(
  budgetId: string,
  newAmountMicros: string,
  customerId?: string
) {
  return mutateGoogleAds(
    'campaignBudgets',
    [{
      update: {
        resourceName: resourceName(customerId, 'campaignBudgets', budgetId),
        amountMicros: newAmountMicros,
      },
      updateMask: 'amount_micros',
    }],
    customerId
  );
}
