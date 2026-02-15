/**
 * Saffron Overview API — /api/ads-agent/overview
 *
 * Returns 60 days of daily account-level Google Ads metrics + agent activity
 * from Supabase. The dashboard splits this into current/previous periods
 * client-side for flexible 7-day or 30-day views.
 */

// TODO: This route uses CRON_SECRET bearer auth which is exposed client-side
// via the fetch call in the dashboard. Should be migrated to Supabase session
// auth in a future pass. Keeping consistent with existing routes for now.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { queryGoogleAds, microsToDollars } from '@/lib/google-ads';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Google Ads: 60 days of daily account-level metrics (single API call)
    const gaqlQuery = `
      SELECT
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.average_cpc,
        metrics.ctr,
        metrics.cost_per_conversion
      FROM customer
      WHERE segments.date DURING LAST_60_DAYS
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

    // Parse Google Ads daily data
    const daily = (adsResults as Array<Record<string, unknown>>).map((row) => {
      const segments = row.segments as Record<string, unknown> | undefined;
      const metrics = row.metrics as Record<string, unknown> | undefined;
      return {
        date: String(segments?.date || ''),
        impressions: Number(metrics?.impressions || 0),
        clicks: Number(metrics?.clicks || 0),
        cost: microsToDollars(metrics?.costMicros as string | number | null),
        conversions: Number(metrics?.conversions || 0),
        avgCpc: microsToDollars(metrics?.averageCpc as string | number | null),
        ctr: Number(metrics?.ctr || 0),
        costPerConversion: microsToDollars(metrics?.costPerConversion as string | number | null),
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
