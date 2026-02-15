/**
 * HubSpot — Deal sync and conversion quality scoring.
 *
 * Pulls deal data from HubSpot, extracts UTM parameters,
 * and stores in Supabase for analysis against Google Ads data.
 */

import { createClient } from '@supabase/supabase-js';
import {
  getRecentDeals,
  getDealContacts,
  getDealCompany,
} from './client';

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Deal sync ──────────────────────────────────────────────────────────────

interface SyncResult {
  synced: number;
  errors: number;
  deals: Array<{
    hubspot_deal_id: string;
    deal_name: string;
    deal_stage: string;
    utm_campaign: string | null;
  }>;
}

/**
 * Sync recent deals from HubSpot to Supabase.
 * Extracts UTM parameters from deal properties and associated contacts.
 */
export async function syncHubSpotDeals(
  accountId: string,
  days = 30
): Promise<SyncResult> {
  const deals = await getRecentDeals(days);
  const result: SyncResult = { synced: 0, errors: 0, deals: [] };

  for (const deal of deals) {
    try {
      // Extract UTM data — check deal properties first, then contacts
      let utmCampaign = deal.properties.utm_campaign || null;
      let utmTerm = deal.properties.utm_term || null;
      let utmSource = deal.properties.utm_source || deal.properties.hs_analytics_source || null;
      let utmMedium = deal.properties.utm_medium || null;
      let contactEmail: string | null = null;
      let companyName: string | null = null;
      let industry: string | null = null;

      // If no UTM on deal, check associated contacts
      if (!utmCampaign && !utmSource) {
        const contacts = await getDealContacts(deal.id);
        for (const contact of contacts) {
          if (!contactEmail) contactEmail = contact.properties.email || null;
          if (!utmCampaign) utmCampaign = contact.properties.utm_campaign || null;
          if (!utmTerm) utmTerm = contact.properties.utm_term || null;
          if (!utmSource) utmSource = contact.properties.utm_source || contact.properties.hs_analytics_source || null;
          if (!utmMedium) utmMedium = contact.properties.utm_medium || null;
        }
      }

      // Get company data
      const company = await getDealCompany(deal.id);
      if (company) {
        companyName = company.properties.name || null;
        industry = company.properties.industry || null;
      }

      // Upsert to Supabase
      const { error } = await supabase
        .from('ads_agent_hubspot_deals')
        .upsert({
          account_id: accountId,
          hubspot_deal_id: deal.id,
          deal_name: deal.properties.dealname || null,
          deal_stage: deal.properties.dealstage || null,
          deal_amount: deal.properties.amount ? parseFloat(deal.properties.amount) : null,
          close_date: deal.properties.closedate || null,
          pipeline: deal.properties.pipeline || null,
          source: utmSource,
          utm_campaign: utmCampaign,
          utm_term: utmTerm,
          utm_source: utmSource,
          utm_medium: utmMedium,
          contact_email: contactEmail,
          company_name: companyName,
          industry,
          synced_at: new Date().toISOString(),
        }, {
          onConflict: 'hubspot_deal_id',
        });

      if (error) {
        console.error(`Failed to sync deal ${deal.id}:`, error.message);
        result.errors++;
      } else {
        result.synced++;
        result.deals.push({
          hubspot_deal_id: deal.id,
          deal_name: deal.properties.dealname || 'Unknown',
          deal_stage: deal.properties.dealstage || 'Unknown',
          utm_campaign: utmCampaign,
        });
      }
    } catch (err) {
      console.error(`Error syncing deal ${deal.id}:`, err);
      result.errors++;
    }
  }

  return result;
}

// ─── Conversion quality scoring ─────────────────────────────────────────────

export interface ConversionQualityScore {
  utm_campaign: string;
  total_deals: number;
  closed_deals: number;
  total_deal_value: number;
  closed_deal_value: number;
  close_rate: number;
  avg_deal_value: number;
  quality_score: 'high' | 'medium' | 'low';
}

/**
 * Score conversion quality by UTM campaign source.
 * Joins HubSpot deal data with campaign information.
 */
export async function getConversionQualityBySource(
  accountId: string
): Promise<ConversionQualityScore[]> {
  const { data: deals } = await supabase
    .from('ads_agent_hubspot_deals')
    .select('*')
    .eq('account_id', accountId)
    .not('utm_campaign', 'is', null);

  if (!deals?.length) return [];

  // Group by utm_campaign
  const campaignMap = new Map<string, {
    total: number;
    closed: number;
    totalValue: number;
    closedValue: number;
  }>();

  for (const deal of deals) {
    const campaign = deal.utm_campaign;
    if (!campaign) continue;

    const existing = campaignMap.get(campaign) || { total: 0, closed: 0, totalValue: 0, closedValue: 0 };
    existing.total++;
    existing.totalValue += deal.deal_amount || 0;

    // Check if deal is closed-won (common HubSpot stages)
    const stage = (deal.deal_stage || '').toLowerCase();
    if (stage.includes('closedwon') || stage.includes('closed won') || stage === 'closedwon') {
      existing.closed++;
      existing.closedValue += deal.deal_amount || 0;
    }

    campaignMap.set(campaign, existing);
  }

  // Calculate scores
  const scores: ConversionQualityScore[] = [];
  for (const [campaign, data] of campaignMap) {
    const closeRate = data.total > 0 ? data.closed / data.total : 0;
    const avgValue = data.total > 0 ? data.totalValue / data.total : 0;

    // Quality scoring: based on close rate and deal value
    let qualityScore: 'high' | 'medium' | 'low' = 'medium';
    if (closeRate >= 0.3 && avgValue > 10000) qualityScore = 'high';
    else if (closeRate < 0.1 || (data.total >= 5 && data.closed === 0)) qualityScore = 'low';

    scores.push({
      utm_campaign: campaign,
      total_deals: data.total,
      closed_deals: data.closed,
      total_deal_value: data.totalValue,
      closed_deal_value: data.closedValue,
      close_rate: closeRate,
      avg_deal_value: avgValue,
      quality_score: qualityScore,
    });
  }

  return scores.sort((a, b) => b.closed_deal_value - a.closed_deal_value);
}

/**
 * Score conversion quality by UTM keyword/term.
 */
export async function getConversionQualityByKeyword(
  accountId: string
): Promise<Array<{
  utm_term: string;
  total_deals: number;
  closed_deals: number;
  total_deal_value: number;
  quality_score: 'high' | 'medium' | 'low';
}>> {
  const { data: deals } = await supabase
    .from('ads_agent_hubspot_deals')
    .select('*')
    .eq('account_id', accountId)
    .not('utm_term', 'is', null);

  if (!deals?.length) return [];

  const termMap = new Map<string, { total: number; closed: number; totalValue: number }>();

  for (const deal of deals) {
    const term = deal.utm_term;
    if (!term) continue;

    const existing = termMap.get(term) || { total: 0, closed: 0, totalValue: 0 };
    existing.total++;
    existing.totalValue += deal.deal_amount || 0;

    const stage = (deal.deal_stage || '').toLowerCase();
    if (stage.includes('closedwon') || stage.includes('closed won')) {
      existing.closed++;
    }

    termMap.set(term, existing);
  }

  return Array.from(termMap.entries())
    .map(([term, data]) => ({
      utm_term: term,
      total_deals: data.total,
      closed_deals: data.closed,
      total_deal_value: data.totalValue,
      quality_score: (data.closed > 0 ? 'high' : data.total >= 3 ? 'low' : 'medium') as 'high' | 'medium' | 'low',
    }))
    .sort((a, b) => b.closed_deals - a.closed_deals);
}
