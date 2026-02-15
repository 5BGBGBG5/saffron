/**
 * HubSpot — Direct REST API client.
 *
 * Uses native fetch() with Bearer token auth (Private App).
 * No SDK needed. Handles rate limiting (190 calls/10 seconds).
 */

const HUBSPOT_BASE_URL = 'https://api.hubapi.com';

function getToken(): string {
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
  if (!token) throw new Error('Missing HUBSPOT_PRIVATE_APP_TOKEN env var');
  return token;
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

let requestCount = 0;
let windowStart = Date.now();

async function rateLimitGuard(): Promise<void> {
  const now = Date.now();
  if (now - windowStart > 10_000) {
    // Reset window
    requestCount = 0;
    windowStart = now;
  }

  if (requestCount >= 180) {
    // Leave buffer below 190 limit
    const waitMs = 10_000 - (now - windowStart) + 100;
    if (waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    requestCount = 0;
    windowStart = Date.now();
  }

  requestCount++;
}

// ─── Core request ───────────────────────────────────────────────────────────

export async function hubspotRequest<T = unknown>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'GET',
  body?: unknown,
  retries = 2
): Promise<T> {
  await rateLimitGuard();

  const url = `${HUBSPOT_BASE_URL}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 429 && retries > 0) {
    // Rate limited — wait and retry
    const retryAfter = parseInt(response.headers.get('Retry-After') || '1', 10);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return hubspotRequest<T>(endpoint, method, body, retries - 1);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`HubSpot API error [${response.status}] ${endpoint}:`, errorBody);
    throw new Error(`HubSpot API error (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

// ─── Deal operations ────────────────────────────────────────────────────────

export interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    dealstage?: string;
    amount?: string;
    closedate?: string;
    pipeline?: string;
    hs_analytics_source?: string;
    hs_analytics_source_data_1?: string;
    hs_analytics_source_data_2?: string;
    utm_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_term?: string;
    [key: string]: string | undefined;
  };
  associations?: {
    contacts?: { results: Array<{ id: string }> };
    companies?: { results: Array<{ id: string }> };
  };
}

interface SearchResponse<T> {
  total: number;
  results: T[];
  paging?: {
    next?: { after: string };
  };
}

/**
 * Search deals with optional filters.
 * Returns up to 100 deals per call (HubSpot max).
 */
export async function searchDeals(
  filters?: Array<{ propertyName: string; operator: string; value: string }>,
  properties?: string[],
  after?: string
): Promise<SearchResponse<HubSpotDeal>> {
  const defaultProperties = [
    'dealname', 'dealstage', 'amount', 'closedate', 'pipeline',
    'hs_analytics_source', 'hs_analytics_source_data_1', 'hs_analytics_source_data_2',
    'utm_campaign', 'utm_source', 'utm_medium', 'utm_term',
  ];

  return hubspotRequest<SearchResponse<HubSpotDeal>>(
    '/crm/v3/objects/deals/search',
    'POST',
    {
      filterGroups: filters?.length ? [{ filters }] : [],
      properties: properties || defaultProperties,
      limit: 100,
      ...(after ? { after } : {}),
    }
  );
}

/**
 * Get all deals, paginating through results.
 * Caps at 500 deals to stay within timeout limits.
 */
export async function getAllDeals(
  properties?: string[]
): Promise<HubSpotDeal[]> {
  const allDeals: HubSpotDeal[] = [];
  let after: string | undefined;
  let pages = 0;

  do {
    const response = await searchDeals(undefined, properties, after);
    allDeals.push(...response.results);
    after = response.paging?.next?.after;
    pages++;
  } while (after && pages < 5); // Max 5 pages = 500 deals

  return allDeals;
}

/**
 * Get deals created or modified in the last N days.
 */
export async function getRecentDeals(
  days = 30,
  properties?: string[]
): Promise<HubSpotDeal[]> {
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return (await searchDeals(
    [{
      propertyName: 'hs_lastmodifieddate',
      operator: 'GTE',
      value: `${sinceDate}T00:00:00.000Z`,
    }],
    properties
  )).results;
}

// ─── Contact operations ─────────────────────────────────────────────────────

export interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    company?: string;
    hs_analytics_source?: string;
    utm_campaign?: string;
    utm_source?: string;
    utm_medium?: string;
    utm_term?: string;
    [key: string]: string | undefined;
  };
}

/**
 * Get contact properties including UTM data.
 */
export async function getContact(contactId: string): Promise<HubSpotContact> {
  const properties = [
    'email', 'firstname', 'lastname', 'company',
    'hs_analytics_source', 'utm_campaign', 'utm_source', 'utm_medium', 'utm_term',
  ];

  return hubspotRequest<HubSpotContact>(
    `/crm/v3/objects/contacts/${contactId}?properties=${properties.join(',')}`
  );
}

/**
 * Get contacts associated with a deal.
 */
export async function getDealContacts(dealId: string): Promise<HubSpotContact[]> {
  try {
    const response = await hubspotRequest<{
      results: Array<{ id: string }>;
    }>(`/crm/v4/objects/deals/${dealId}/associations/contacts`);

    if (!response.results?.length) return [];

    // Fetch contact details (batch, max 10 at a time)
    const contacts: HubSpotContact[] = [];
    for (const assoc of response.results.slice(0, 10)) {
      try {
        const contact = await getContact(assoc.id);
        contacts.push(contact);
      } catch {
        // Skip contacts we can't fetch
      }
    }
    return contacts;
  } catch {
    return [];
  }
}

// ─── Company operations ─────────────────────────────────────────────────────

export interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    industry?: string;
    domain?: string;
    [key: string]: string | undefined;
  };
}

/**
 * Get company associated with a deal.
 */
export async function getDealCompany(dealId: string): Promise<HubSpotCompany | null> {
  try {
    const response = await hubspotRequest<{
      results: Array<{ id: string }>;
    }>(`/crm/v4/objects/deals/${dealId}/associations/companies`);

    if (!response.results?.length) return null;

    return hubspotRequest<HubSpotCompany>(
      `/crm/v3/objects/companies/${response.results[0].id}?properties=name,industry,domain`
    );
  } catch {
    return null;
  }
}
