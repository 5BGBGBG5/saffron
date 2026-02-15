/**
 * Google Ads — Campaign mutations (create, pause, enable).
 */

import { mutateGoogleAds, groupedMutate, resourceName, dollarsToMicros } from '../client';

/** Pause a campaign. */
export async function pauseCampaign(campaignId: string, customerId?: string) {
  return mutateGoogleAds(
    'campaigns',
    [{
      update: {
        resourceName: resourceName(customerId, 'campaigns', campaignId),
        status: 'PAUSED',
      },
      updateMask: 'status',
    }],
    customerId
  );
}

/** Enable a campaign. */
export async function enableCampaign(campaignId: string, customerId?: string) {
  return mutateGoogleAds(
    'campaigns',
    [{
      update: {
        resourceName: resourceName(customerId, 'campaigns', campaignId),
        status: 'ENABLED',
      },
      updateMask: 'status',
    }],
    customerId
  );
}

/** Create a new search campaign with budget (atomic grouped mutate). */
export async function createSearchCampaign(
  opts: {
    name: string;
    dailyBudgetDollars: number;
    biddingStrategy?: 'MANUAL_CPC' | 'MAXIMIZE_CONVERSIONS' | 'TARGET_CPA';
    targetCpaDollars?: number;
  },
  customerId?: string
) {
  const cid = (customerId || process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');

  const campaignOp: Record<string, unknown> = {
    name: opts.name,
    status: 'PAUSED', // Always create paused — safety first
    advertisingChannelType: 'SEARCH',
    campaignBudget: `customers/${cid}/campaignBudgets/-1`, // temp ref to budget
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
    },
  };

  // Bidding strategy
  if (opts.biddingStrategy === 'MAXIMIZE_CONVERSIONS') {
    campaignOp.maximizeConversions = {};
  } else if (opts.biddingStrategy === 'TARGET_CPA' && opts.targetCpaDollars) {
    campaignOp.maximizeConversions = {
      targetCpaMicros: dollarsToMicros(opts.targetCpaDollars),
    };
  } else {
    campaignOp.manualCpc = { enhancedCpcEnabled: false };
  }

  return groupedMutate(
    [
      {
        campaignBudgetOperation: {
          create: {
            name: `Budget for ${opts.name}`,
            amountMicros: dollarsToMicros(opts.dailyBudgetDollars),
            deliveryMethod: 'STANDARD',
          },
        },
      },
      {
        campaignOperation: {
          create: campaignOp,
        },
      },
    ],
    customerId
  );
}
