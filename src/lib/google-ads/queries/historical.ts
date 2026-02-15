/**
 * Google Ads — Historical performance queries (up to 365 days).
 *
 * Uses 30-day chunking to avoid 4MB response size limits on searchStream.
 * Each chunk queries a 30-day window, results are concatenated.
 */

import { queryGoogleAds, microsToDollars } from '../client';

// ─── Date helpers ────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]; // 'YYYY-MM-DD'
}

function getDateChunks(days: number, chunkSize = 30): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  const now = new Date();
  let end = new Date(now);
  end.setDate(end.getDate() - 1); // Yesterday (today may be incomplete)

  const earliest = new Date(now);
  earliest.setDate(earliest.getDate() - days);

  while (end > earliest) {
    const start = new Date(end);
    start.setDate(start.getDate() - chunkSize + 1);
    if (start < earliest) {
      start.setTime(earliest.getTime());
    }
    chunks.push({ start: formatDate(start), end: formatDate(end) });
    end = new Date(start);
    end.setDate(end.getDate() - 1);
  }

  return chunks.reverse(); // chronological order
}

// ─── Campaign Historical (daily) ────────────────────────────────────────────

export interface CampaignDailyHistorical {
  date: string;
  campaignId: string;
  campaignName: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  avgCpc: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
}

/**
 * Get daily campaign metrics for up to 365 days, chunked into 30-day windows.
 */
export async function getCampaignHistorical(
  days = 365,
  customerId?: string
): Promise<CampaignDailyHistorical[]> {
  const chunks = getDateChunks(days);
  const allResults: CampaignDailyHistorical[] = [];

  for (const chunk of chunks) {
    const query = `
      SELECT
        segments.date,
        campaign.id,
        campaign.name,
        campaign.status,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.cost_micros,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date BETWEEN '${chunk.start}' AND '${chunk.end}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `;

    const rows = await queryGoogleAds(query, customerId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of rows as any[]) {
      allResults.push({
        date: row.segments.date,
        campaignId: row.campaign.id,
        campaignName: row.campaign.name,
        status: row.campaign.status,
        impressions: parseInt(row.metrics.impressions || '0', 10),
        clicks: parseInt(row.metrics.clicks || '0', 10),
        ctr: parseFloat(row.metrics.ctr || '0'),
        avgCpc: microsToDollars(row.metrics.averageCpc),
        cost: microsToDollars(row.metrics.costMicros),
        conversions: parseFloat(row.metrics.conversions || '0'),
        costPerConversion: microsToDollars(row.metrics.costPerConversion),
      });
    }
  }

  return allResults;
}

// ─── Keyword Historical (daily) ─────────────────────────────────────────────

export interface KeywordDailyHistorical {
  date: string;
  criterionId: string;
  keywordText: string;
  matchType: string;
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  costPerConversion: number;
}

/**
 * Get daily keyword metrics for up to 365 days, chunked into 30-day windows.
 * Only returns keywords that had impressions to keep data manageable.
 */
export async function getKeywordHistorical(
  days = 365,
  customerId?: string
): Promise<KeywordDailyHistorical[]> {
  const chunks = getDateChunks(days);
  const allResults: KeywordDailyHistorical[] = [];

  for (const chunk of chunks) {
    const query = `
      SELECT
        segments.date,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        campaign.id,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.cost_per_conversion
      FROM keyword_view
      WHERE segments.date BETWEEN '${chunk.start}' AND '${chunk.end}'
        AND ad_group_criterion.status != 'REMOVED'
        AND metrics.impressions > 0
      ORDER BY segments.date ASC
    `;

    const rows = await queryGoogleAds(query, customerId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of rows as any[]) {
      allResults.push({
        date: row.segments.date,
        criterionId: row.adGroupCriterion.criterionId,
        keywordText: row.adGroupCriterion.keyword.text,
        matchType: row.adGroupCriterion.keyword.matchType,
        campaignId: row.campaign.id,
        campaignName: row.campaign.name,
        impressions: parseInt(row.metrics.impressions || '0', 10),
        clicks: parseInt(row.metrics.clicks || '0', 10),
        cost: microsToDollars(row.metrics.costMicros),
        conversions: parseFloat(row.metrics.conversions || '0'),
        costPerConversion: microsToDollars(row.metrics.costPerConversion),
      });
    }
  }

  return allResults;
}

// ─── Day-of-Week Performance ─────────────────────────────────────────────────

export interface DayOfWeekPerformance {
  dayOfWeek: string; // 'MONDAY', 'TUESDAY', etc.
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  avgCpc: number;
  ctr: number;
  costPerConversion: number;
  dataPoints: number; // number of days aggregated
}

/**
 * Aggregate performance by day-of-week over the given period.
 * Computed from campaign daily data — no extra API call needed.
 */
export function computeDayOfWeekPerformance(
  dailyData: CampaignDailyHistorical[]
): DayOfWeekPerformance[] {
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const buckets = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number; count: number }>();

  for (const name of dayNames) {
    buckets.set(name, { impressions: 0, clicks: 0, cost: 0, conversions: 0, count: 0 });
  }

  for (const row of dailyData) {
    const date = new Date(row.date + 'T12:00:00Z'); // noon UTC to avoid DST issues
    const dayName = dayNames[date.getUTCDay()];
    const bucket = buckets.get(dayName)!;
    bucket.impressions += row.impressions;
    bucket.clicks += row.clicks;
    bucket.cost += row.cost;
    bucket.conversions += row.conversions;
    bucket.count += 1;
  }

  return dayNames.map((dayOfWeek) => {
    const b = buckets.get(dayOfWeek)!;
    const days = b.count || 1;
    return {
      dayOfWeek,
      impressions: Math.round(b.impressions / days),
      clicks: Math.round(b.clicks / days),
      cost: parseFloat((b.cost / days).toFixed(2)),
      conversions: parseFloat((b.conversions / days).toFixed(2)),
      avgCpc: b.clicks > 0 ? parseFloat((b.cost / b.clicks).toFixed(2)) : 0,
      ctr: b.impressions > 0 ? parseFloat((b.clicks / b.impressions).toFixed(4)) : 0,
      costPerConversion: b.conversions > 0 ? parseFloat((b.cost / b.conversions).toFixed(2)) : 0,
      dataPoints: b.count,
    };
  });
}

// ─── Month-over-Month Trends ─────────────────────────────────────────────────

export interface MonthlyTrend {
  month: string; // 'YYYY-MM'
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  avgCpc: number;
  ctr: number;
  costPerConversion: number;
}

/**
 * Aggregate campaign daily data into monthly rollups.
 * Computed from campaign daily data — no extra API call needed.
 */
export function computeMonthlyTrends(
  dailyData: CampaignDailyHistorical[]
): MonthlyTrend[] {
  const months = new Map<string, { impressions: number; clicks: number; cost: number; conversions: number }>();

  for (const row of dailyData) {
    const month = row.date.substring(0, 7); // 'YYYY-MM'
    const existing = months.get(month);
    if (existing) {
      existing.impressions += row.impressions;
      existing.clicks += row.clicks;
      existing.cost += row.cost;
      existing.conversions += row.conversions;
    } else {
      months.set(month, {
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        conversions: row.conversions,
      });
    }
  }

  return Array.from(months.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      impressions: data.impressions,
      clicks: data.clicks,
      cost: parseFloat(data.cost.toFixed(2)),
      conversions: parseFloat(data.conversions.toFixed(2)),
      avgCpc: data.clicks > 0 ? parseFloat((data.cost / data.clicks).toFixed(2)) : 0,
      ctr: data.impressions > 0 ? parseFloat((data.clicks / data.impressions).toFixed(4)) : 0,
      costPerConversion: data.conversions > 0 ? parseFloat((data.cost / data.conversions).toFixed(2)) : 0,
    }));
}

// ─── Search Term Report ──────────────────────────────────────────────────────

export interface SearchTermData {
  searchTerm: string;
  keywordText: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  cost: number;
  conversions: number;
  ctr: number;
  costPerConversion: number;
}

/**
 * Get search term performance for the last 90 days.
 * Uses 30-day chunking. Only returns terms with clicks.
 */
export async function getSearchTermReport(
  days = 90,
  customerId?: string
): Promise<SearchTermData[]> {
  const chunks = getDateChunks(days);
  // Aggregate across chunks by search term
  const termMap = new Map<string, { term: string; keyword: string; campaign: string; impressions: number; clicks: number; costMicros: bigint; conversions: number }>();

  for (const chunk of chunks) {
    const query = `
      SELECT
        search_term_view.search_term,
        campaign.name,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM search_term_view
      WHERE segments.date BETWEEN '${chunk.start}' AND '${chunk.end}'
        AND metrics.clicks > 0
    `;

    const rows = await queryGoogleAds(query, customerId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const row of rows as any[]) {
      const term = row.searchTermView.searchTerm;
      const existing = termMap.get(term);
      if (existing) {
        existing.impressions += parseInt(row.metrics.impressions || '0', 10);
        existing.clicks += parseInt(row.metrics.clicks || '0', 10);
        existing.costMicros += BigInt(row.metrics.costMicros || '0');
        existing.conversions += parseFloat(row.metrics.conversions || '0');
      } else {
        termMap.set(term, {
          term,
          keyword: term, // search term itself is the keyword context
          campaign: row.campaign.name,
          impressions: parseInt(row.metrics.impressions || '0', 10),
          clicks: parseInt(row.metrics.clicks || '0', 10),
          costMicros: BigInt(row.metrics.costMicros || '0'),
          conversions: parseFloat(row.metrics.conversions || '0'),
        });
      }
    }
  }

  return Array.from(termMap.values())
    .map((t) => {
      const cost = Number(t.costMicros) / 1_000_000;
      return {
        searchTerm: t.term,
        keywordText: t.keyword,
        campaignName: t.campaign,
        impressions: t.impressions,
        clicks: t.clicks,
        cost: parseFloat(cost.toFixed(2)),
        conversions: t.conversions,
        ctr: t.impressions > 0 ? parseFloat((t.clicks / t.impressions).toFixed(4)) : 0,
        costPerConversion: t.conversions > 0 ? parseFloat((cost / t.conversions).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.cost - a.cost); // highest spend first
}
