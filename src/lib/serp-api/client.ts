/**
 * SerpAPI client — Google Search results with paid ads.
 *
 * Uses the Google Search endpoint to capture sponsored results.
 * Docs: https://serpapi.com/search-api
 */

import type { SerpAdResult, SerpSearchResult } from './types';

const SERP_API_BASE = 'https://serpapi.com/search.json';

function getApiKey(): string {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) throw new Error('Missing SERPAPI_API_KEY env var');
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDomain(ad: any): string {
  try {
    return new URL(ad.link || '').hostname.replace('www.', '');
  } catch {
    return (ad.displayed_link || '').split('/')[0].replace('www.', '');
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseAd(ad: any, position: number): SerpAdResult {
  return {
    position,
    title: ad.title || '',
    snippet: ad.snippet || ad.description || '',
    displayed_link: ad.displayed_link || '',
    link: ad.link || '',
    domain: extractDomain(ad),
    sitelinks: (ad.sitelinks || []).map((sl: { title?: string; link?: string }) => ({
      title: sl.title || '',
      link: sl.link || '',
    })),
  };
}

/**
 * Search Google and return paid ad results.
 *
 * Parameters tuned for B2B ERP ad research:
 * - US location (Inecta's primary market)
 * - Desktop device (B2B buyers research on desktop)
 * - English language
 */
export async function searchGoogleAds(keyword: string): Promise<SerpSearchResult> {
  const params = new URLSearchParams({
    api_key: getApiKey(),
    engine: 'google',
    q: keyword,
    location: 'United States',
    hl: 'en',
    gl: 'us',
    device: 'desktop',
  });

  const response = await fetch(`${SERP_API_BASE}?${params.toString()}`);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`SerpAPI error (${response.status}): ${error}`);
  }

  const data = await response.json();

  // Extract top ads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adsTop: SerpAdResult[] = (data.ads || []).map((ad: any, i: number) => parseAd(ad, i + 1));

  // Some SerpAPI responses split top vs bottom ads
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adsBottom: SerpAdResult[] = (data.ads_bottom || []).map((ad: any, i: number) =>
    parseAd(ad, adsTop.length + i + 1)
  );

  return {
    query: keyword,
    ads_top: adsTop,
    ads_bottom: adsBottom,
    total_ads: adsTop.length + adsBottom.length,
    search_metadata: {
      id: data.search_metadata?.id || '',
      status: data.search_metadata?.status || '',
      created_at: data.search_metadata?.created_at || '',
    },
  };
}

/**
 * Batch search multiple keywords with rate limiting.
 * SerpAPI allows 5 concurrent requests on most plans.
 * We go sequential to be safe and stay well within limits.
 */
export async function batchSearchGoogleAds(
  keywords: string[],
  delayMs = 1500
): Promise<Map<string, SerpSearchResult>> {
  const results = new Map<string, SerpSearchResult>();

  for (const keyword of keywords) {
    try {
      const result = await searchGoogleAds(keyword);
      results.set(keyword, result);
      console.log(`  SerpAPI: "${keyword}" → ${result.total_ads} ads found`);

      // Rate limit delay (skip after last keyword)
      if (keyword !== keywords[keywords.length - 1]) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (err) {
      console.error(`  SerpAPI error for "${keyword}":`, err instanceof Error ? err.message : err);
      // Continue with remaining keywords
    }
  }

  return results;
}
