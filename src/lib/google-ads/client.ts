/**
 * Google Ads API — Core REST client.
 *
 * Uses native fetch() — zero npm dependencies.
 * All calls go through the REST/JSON interface (not gRPC).
 * Uses searchStream for reads (single response, no pagination needed).
 */

import { getAccessToken } from './auth';

const API_VERSION = 'v20';
const BASE_URL = `https://googleads.googleapis.com/${API_VERSION}`;

export function getManagerCustomerId(): string {
  const id = process.env.GOOGLE_ADS_MANAGER_CUSTOMER_ID;
  if (!id) throw new Error('Missing GOOGLE_ADS_MANAGER_CUSTOMER_ID env var');
  return id.replace(/-/g, '');
}

export function getCustomerId(): string {
  const id = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!id) throw new Error('Missing GOOGLE_ADS_CUSTOMER_ID env var');
  return id.replace(/-/g, '');
}

function getDeveloperToken(): string {
  const token = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!token) throw new Error('Missing GOOGLE_ADS_DEVELOPER_TOKEN env var');
  return token;
}

// ─── Core request ────────────────────────────────────────────────────────────

interface RequestOptions {
  customerId?: string;
  endpoint: string;
  body?: Record<string, unknown>;
  method?: 'POST' | 'GET';
}

export async function googleAdsRequest({ customerId, endpoint, body, method = 'POST' }: RequestOptions) {
  const accessToken = await getAccessToken();
  const cid = (customerId || getCustomerId()).replace(/-/g, '');
  const url = `${BASE_URL}/customers/${cid}/${endpoint}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'developer-token': getDeveloperToken(),
      'login-customer-id': getManagerCustomerId(),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Google Ads API error [${response.status}] ${url}:`, errorBody);
    throw new Error(`Google Ads API error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

// ─── GAQL Query (searchStream — returns all results, no pagination) ──────────

export async function queryGoogleAds(query: string, customerId?: string) {
  const results = await googleAdsRequest({
    customerId,
    endpoint: 'googleAds:searchStream',
    body: { query },
  });

  // searchStream returns an array of batches, each with a "results" array
  if (Array.isArray(results)) {
    return results.flatMap((batch: Record<string, unknown>) =>
      (batch.results as Record<string, unknown>[]) || []
    );
  }
  return (results.results as Record<string, unknown>[]) || [];
}

// ─── Mutate (resource-specific) ──────────────────────────────────────────────

export async function mutateGoogleAds(
  resource: string,
  operations: Record<string, unknown>[],
  customerId?: string,
  partialFailure = false
) {
  return googleAdsRequest({
    customerId,
    endpoint: `${resource}:mutate`,
    body: {
      operations,
      ...(partialFailure && { partialFailure: true }),
    },
  });
}

// ─── Grouped mutate (multiple resource types in one atomic call) ─────────────

export async function groupedMutate(
  mutateOperations: Record<string, unknown>[],
  customerId?: string
) {
  return googleAdsRequest({
    customerId,
    endpoint: 'googleAds:mutate',
    body: { mutateOperations },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Convert micros to dollars: 1_000_000 micros = $1.00 */
export function microsToDollars(micros: string | number | null): number {
  if (micros === null || micros === undefined) return 0;
  return Number(micros) / 1_000_000;
}

/** Convert dollars to micros */
export function dollarsToMicros(dollars: number): string {
  return String(Math.round(dollars * 1_000_000));
}

/** Build a resource name */
export function resourceName(customerId: string | undefined, resource: string, id: string): string {
  const cid = (customerId || getCustomerId()).replace(/-/g, '');
  return `customers/${cid}/${resource}/${id}`;
}
