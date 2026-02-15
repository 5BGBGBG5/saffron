/**
 * Saffron Agent HubSpot Sync — /api/ads-agent/hubspot-sync
 *
 * POST: Triggers HubSpot deal sync for the active account.
 * GET: Returns conversion quality scores.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { syncHubSpotDeals } from '@/lib/hubspot/sync';
import { getConversionQualityBySource, getConversionQualityByKeyword } from '@/lib/hubspot/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export async function POST(_request: NextRequest) {
  try {
    if (!process.env.HUBSPOT_PRIVATE_APP_TOKEN) {
      return NextResponse.json(
        { error: 'HubSpot not configured — HUBSPOT_PRIVATE_APP_TOKEN required' },
        { status: 400 }
      );
    }

    // Get active account
    const { data: accounts } = await supabase
      .from('ads_agent_accounts')
      .select('id')
      .eq('is_active', true)
      .limit(1);

    if (!accounts?.length) {
      return NextResponse.json({ error: 'No active account found' }, { status: 404 });
    }

    const accountId = accounts[0].id;
    const result = await syncHubSpotDeals(accountId, 90); // Sync last 90 days

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('HubSpot sync error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Get active account
    const { data: accounts } = await supabase
      .from('ads_agent_accounts')
      .select('id')
      .eq('is_active', true)
      .limit(1);

    if (!accounts?.length) {
      return NextResponse.json({ error: 'No active account found' }, { status: 404 });
    }

    const accountId = accounts[0].id;

    const [byCampaign, byKeyword, deals] = await Promise.all([
      getConversionQualityBySource(accountId),
      getConversionQualityByKeyword(accountId),
      supabase
        .from('ads_agent_hubspot_deals')
        .select('*')
        .eq('account_id', accountId)
        .order('synced_at', { ascending: false })
        .limit(100),
    ]);

    // Pipeline summary
    const allDeals = deals.data || [];
    const pipelineStats = {
      totalDeals: allDeals.length,
      totalValue: allDeals.reduce((sum, d) => sum + (d.deal_amount || 0), 0),
      byStage: {} as Record<string, { count: number; value: number }>,
      lastSynced: allDeals[0]?.synced_at || null,
    };

    for (const deal of allDeals) {
      const stage = deal.deal_stage || 'unknown';
      if (!pipelineStats.byStage[stage]) {
        pipelineStats.byStage[stage] = { count: 0, value: 0 };
      }
      pipelineStats.byStage[stage].count++;
      pipelineStats.byStage[stage].value += deal.deal_amount || 0;
    }

    return NextResponse.json({
      pipeline: pipelineStats,
      qualityByCampaign: byCampaign,
      qualityByKeyword: byKeyword,
      recentDeals: allDeals.slice(0, 20),
    });
  } catch (error) {
    console.error('HubSpot data fetch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
