/**
 * Saffron Overview API — /api/ads-agent/overview
 *
 * Returns 60 days of daily account-level Google Ads metrics + agent activity
 * from Supabase. The dashboard splits this into current/previous periods
 * client-side for flexible 7-day or 30-day views.
 */

// TODO: This route has no auth — consistent with other dashboard-facing routes
// (decide, insights, hubspot-sync). Should be migrated to Supabase session auth
// in a future pass.

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queryGoogleAds, microsToDollars } from '@/lib/google-ads';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function GET() {
  try {
    const now = new Date();
    const sixtyDaysAgoDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = sixtyDaysAgoDate.toISOString();
    // GAQL needs YYYY-MM-DD format; LAST_60_DAYS is not a valid predefined range
    const startDate = sixtyDaysAgoDate.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    // 1. Google Ads: 60 days of daily metrics via campaign resource
    //    (customer resource doesn't support BETWEEN date filtering;
    //     aggregate per-campaign rows into daily totals in code)
    const gaqlQuery = `
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `;

    // 2. Supabase: agent actions + pending count (parallel)
    const [adsResults, actionsRes, pendingRes] = await Promise.all([
      queryGoogleAds(gaqlQuery).catch((err: Error) => {
        console.error('Google Ads overview query failed:', err.message);
        return [];
      }),
      supabase
        .from('ads_agent_change_log')
        .select('action_type, outcome, created_at')
        .gte('created_at', sixtyDaysAgo)
        .in('outcome', ['executed', 'auto_executed', 'rejected']),
      supabase
        .from('ads_agent_decision_queue')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending'),
    ]);

    // Parse Google Ads daily data — aggregate per-campaign rows into daily totals
    const dailyMap = new Map<string, { impressions: number; clicks: number; costMicros: number; conversions: number }>();

    for (const row of adsResults as Array<Record<string, unknown>>) {
      const segments = row.segments as Record<string, unknown> | undefined;
      const metrics = row.metrics as Record<string, unknown> | undefined;
      const date = String(segments?.date || '');
      if (!date) continue;

      const existing = dailyMap.get(date) || { impressions: 0, clicks: 0, costMicros: 0, conversions: 0 };
      existing.impressions += Number(metrics?.impressions || 0);
      existing.clicks += Number(metrics?.clicks || 0);
      existing.costMicros += Number(metrics?.costMicros || 0);
      existing.conversions += Number(metrics?.conversions || 0);
      dailyMap.set(date, existing);
    }

    const daily = Array.from(dailyMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => {
        const cost = microsToDollars(d.costMicros);
        return {
          date,
          impressions: d.impressions,
          clicks: d.clicks,
          cost,
          conversions: d.conversions,
          avgCpc: d.clicks > 0 ? cost / d.clicks : 0,
          ctr: d.impressions > 0 ? d.clicks / d.impressions : 0,
          costPerConversion: d.conversions > 0 ? cost / d.conversions : 0,
        };
      });

    // Parse agent actions with date normalization
    const agentActions = (actionsRes.data || []).map((a) => ({
      date: a.created_at.split('T')[0],
      action_type: a.action_type,
      outcome: a.outcome,
    }));

    return NextResponse.json({
      daily,
      agentActions,
      pendingCount: pendingRes.count || 0,
    });
  } catch (error) {
    console.error('Overview API error:', error);
    return NextResponse.json(
      { error: 'Failed to load overview data' },
      { status: 500 }
    );
  }
}
