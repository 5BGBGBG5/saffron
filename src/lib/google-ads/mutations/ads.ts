/**
 * Google Ads — Ad creative mutations (responsive search ads).
 */

import { mutateGoogleAds, getCustomerId } from '../client';

/** Create a responsive search ad (always created as PAUSED for review). */
export async function createResponsiveSearchAd(
  adGroupId: string,
  opts: {
    headlines: Array<{ text: string; pinnedField?: 'HEADLINE_1' | 'HEADLINE_2' | 'HEADLINE_3' }>;
    descriptions: Array<{ text: string; pinnedField?: 'DESCRIPTION_1' | 'DESCRIPTION_2' }>;
    finalUrls: string[];
    path1?: string;
    path2?: string;
  },
  customerId?: string
) {
  // Google Ads minimums: 3 headlines, 2 descriptions, 1 final URL
  if (opts.headlines.length < 3) throw new Error('Minimum 3 headlines required for RSA');
  if (opts.descriptions.length < 2) throw new Error('Minimum 2 descriptions required for RSA');
  if (opts.finalUrls.length < 1) throw new Error('At least 1 final URL required');

  // Validate character limits
  for (const h of opts.headlines) {
    if (h.text.length > 30) throw new Error(`Headline too long (${h.text.length}/30): "${h.text}"`);
  }
  for (const d of opts.descriptions) {
    if (d.text.length > 90) throw new Error(`Description too long (${d.text.length}/90): "${d.text}"`);
  }

  const cid = (customerId || getCustomerId()).replace(/-/g, '');

  return mutateGoogleAds(
    'adGroupAds',
    [{
      create: {
        adGroup: `customers/${cid}/adGroups/${adGroupId}`,
        status: 'PAUSED', // Safety: create paused for human review
        ad: {
          responsiveSearchAd: {
            headlines: opts.headlines.map(h => ({
              text: h.text,
              ...(h.pinnedField && { pinnedField: h.pinnedField }),
            })),
            descriptions: opts.descriptions.map(d => ({
              text: d.text,
              ...(d.pinnedField && { pinnedField: d.pinnedField }),
            })),
            ...(opts.path1 && { path1: opts.path1 }),
            ...(opts.path2 && { path2: opts.path2 }),
          },
          finalUrls: opts.finalUrls,
        },
      },
    }],
    customerId
  );
}
