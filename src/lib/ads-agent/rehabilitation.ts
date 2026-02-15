/**
 * Saffron — Keyword Rehabilitation Logic.
 *
 * Strategic industry keywords (meat processing, dairy, seafood, etc.) should
 * never be automatically eliminated even if CPA is high. Instead, Saffron
 * tries different tactics before ever reducing spend.
 *
 * Design philosophy: "smart and structured, but not so structured that it
 * misses out on smart decisions."
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.AIEO_SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder',
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Industry keyword patterns ──────────────────────────────────────────────
// Keywords containing any of these terms are considered strategic and protected.
// Saffron will try rehabilitation tactics instead of pausing/removing.

export const INDUSTRY_TERMS = [
  // Meat & Poultry
  'meat', 'beef', 'pork', 'poultry', 'chicken', 'turkey', 'lamb',
  'sausage', 'deli', 'butcher', 'slaughter', 'protein',
  // Seafood
  'seafood', 'fish', 'shrimp', 'salmon', 'tuna', 'shellfish', 'aquaculture',
  // Dairy
  'dairy', 'milk', 'cheese', 'yogurt', 'cream', 'butter', 'whey',
  // Bakery
  'bakery', 'bread', 'pastry', 'confectionery', 'snack',
  // Beverage
  'brewery', 'beverage', 'wine', 'distillery', 'juice', 'bottling',
  // General Food & Bev
  'food processing', 'food manufacturing', 'food production', 'food safety',
  'food and beverage', 'food & beverage', 'f&b', 'food industry',
  // Compliance / Standards
  'haccp', 'usda', 'fda', 'gfsi', 'sqf', 'brc', 'fsma',
  'food traceability', 'lot tracking', 'catch weight',
  // ERP + industry combos (these match as substrings)
  'erp for food', 'erp for meat', 'erp for dairy', 'erp for seafood',
  'erp for bakery', 'erp for beverage', 'food erp', 'meat erp',
  'food software', 'meat software',
];

/**
 * Determine the industry category for a keyword.
 * Returns null if the keyword is not in a strategic industry.
 */
export function classifyIndustry(keywordText: string): string | null {
  const lower = keywordText.toLowerCase();

  // Check specific industries first (more specific = higher priority)
  if (/meat|beef|pork|sausage|deli|butcher|slaughter|protein/.test(lower)) return 'meat_processing';
  if (/poultry|chicken|turkey/.test(lower)) return 'poultry';
  if (/seafood|fish|shrimp|salmon|tuna|shellfish|aquaculture/.test(lower)) return 'seafood';
  if (/dairy|milk|cheese|yogurt|cream|butter|whey/.test(lower)) return 'dairy';
  if (/bakery|bread|pastry|confectionery|snack/.test(lower)) return 'bakery';
  if (/brewery|beverage|wine|distillery|juice|bottling/.test(lower)) return 'beverage';
  if (/haccp|usda|fda|gfsi|sqf|brc|fsma|food traceability|lot tracking|catch weight/.test(lower)) return 'compliance';
  if (/food processing|food manufacturing|food production|food safety|food.*(erp|software)|f&b|food and beverage|food & beverage|food industry/.test(lower)) return 'food_general';

  return null;
}

/**
 * Check if a keyword text matches any strategic industry term.
 */
export function isStrategicKeyword(keywordText: string): boolean {
  return classifyIndustry(keywordText) !== null;
}

/**
 * Get the list of industry terms formatted for Claude's system prompt.
 * This tells Claude to never propose pausing these keywords.
 */
export function getRehabGuardrailPrompt(): string {
  return `CRITICAL KEYWORD REHABILITATION RULE:
The following keywords are in strategic food & beverage industries for this B2B ERP company.
These keywords are naturally expensive with low search volume. NEVER propose pause_keyword
or add_negative_keyword for any keyword containing these industry terms:
${INDUSTRY_TERMS.map(t => `"${t}"`).join(', ')}

Instead of pausing these keywords, propose rehabilitation tactics:
- "generate_rsa": Create new ad copy variations targeting the keyword's industry
- "adjust_bid": Try different bid levels to improve ad position
- Any creative tactic that could improve performance WITHOUT eliminating the keyword

Only propose pausing industry keywords if they have been in rehabilitation for 6+ months
with zero conversions despite multiple tactic changes.`;
}

// ─── Rehabilitation candidate identification ────────────────────────────────

export interface RehabCandidate {
  keywordText: string;
  criterionId: string;
  adGroupId: string;
  campaignId: string;
  campaignName: string;
  industryCategory: string;
  currentCpa: number;
  cost: number;
  conversions: number;
  clicks: number;
}

/**
 * Identify keywords that should enter rehabilitation.
 * Criteria: strategic industry keyword + high CPA or zero conversions with significant spend.
 */
export function identifyRehabCandidates(
  keywords: Array<{
    keywordText: string;
    criterionId: string;
    adGroupId: string;
    campaignId: string;
    campaignName: string;
    costPerConversion: number;
    cost: number;
    conversions: number;
    clicks: number;
  }>,
  accountAvgCpa: number
): RehabCandidate[] {
  const candidates: RehabCandidate[] = [];

  for (const kw of keywords) {
    const industry = classifyIndustry(kw.keywordText);
    if (!industry) continue; // Not a strategic keyword

    // High CPA (>2x account average) or zero conversions with spend
    const isHighCpa = kw.conversions > 0 && kw.costPerConversion > accountAvgCpa * 2;
    const isZeroConversions = kw.conversions === 0 && kw.cost > 50; // Spent >$50 with no conversions

    if (isHighCpa || isZeroConversions) {
      candidates.push({
        keywordText: kw.keywordText,
        criterionId: kw.criterionId,
        adGroupId: kw.adGroupId,
        campaignId: kw.campaignId,
        campaignName: kw.campaignName,
        industryCategory: industry,
        currentCpa: kw.costPerConversion,
        cost: kw.cost,
        conversions: kw.conversions,
        clicks: kw.clicks,
      });
    }
  }

  return candidates;
}

// ─── Rehabilitation history ─────────────────────────────────────────────────

export interface RehabEntry {
  id: string;
  keyword_text: string;
  keyword_criterion_id: string;
  ad_group_id: string;
  campaign_id: string;
  campaign_name: string;
  industry_category: string;
  status: string;
  attempts: Array<{
    date: string;
    tactic: string;
    action_type: string;
    decision_id?: string;
    result?: string;
  }>;
  current_cpa: number;
  baseline_cpa: number;
  best_cpa: number;
  total_attempts: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get rehabilitation history for a keyword.
 */
export async function getRehabHistory(
  keywordText: string,
  accountId: string
): Promise<RehabEntry | null> {
  const { data } = await supabase
    .from('ads_agent_rehabilitation_log')
    .select('*')
    .eq('account_id', accountId)
    .eq('keyword_text', keywordText)
    .single();

  return data as RehabEntry | null;
}

/**
 * Get all active rehabilitation entries for an account.
 */
export async function getActiveRehabs(accountId: string): Promise<RehabEntry[]> {
  const { data } = await supabase
    .from('ads_agent_rehabilitation_log')
    .select('*')
    .eq('account_id', accountId)
    .in('status', ['active', 'improving'])
    .order('updated_at', { ascending: false });

  return (data || []) as RehabEntry[];
}

/**
 * Create or update a rehabilitation entry.
 */
export async function upsertRehabEntry(
  accountId: string,
  candidate: RehabCandidate,
  existingEntry?: RehabEntry | null
): Promise<void> {
  const now = new Date().toISOString();

  if (existingEntry) {
    // Update existing entry with new CPA data
    const bestCpa = candidate.currentCpa > 0
      ? Math.min(existingEntry.best_cpa || Infinity, candidate.currentCpa)
      : existingEntry.best_cpa;

    await supabase
      .from('ads_agent_rehabilitation_log')
      .update({
        current_cpa: candidate.currentCpa,
        best_cpa: bestCpa,
        status: candidate.currentCpa < (existingEntry.baseline_cpa || Infinity) * 0.8
          ? 'improving' : existingEntry.status,
        updated_at: now,
      })
      .eq('id', existingEntry.id);
  } else {
    // Create new entry
    await supabase
      .from('ads_agent_rehabilitation_log')
      .insert({
        account_id: accountId,
        keyword_text: candidate.keywordText,
        keyword_criterion_id: candidate.criterionId,
        ad_group_id: candidate.adGroupId,
        campaign_id: candidate.campaignId,
        campaign_name: candidate.campaignName,
        industry_category: candidate.industryCategory,
        status: 'active',
        attempts: [],
        current_cpa: candidate.currentCpa,
        baseline_cpa: candidate.currentCpa,
        best_cpa: candidate.currentCpa,
        total_attempts: 0,
      });
  }
}

/**
 * Record a rehabilitation attempt.
 */
export async function recordRehabAttempt(
  rehabId: string,
  tactic: string,
  actionType: string,
  decisionId?: string
): Promise<void> {
  const { data: entry } = await supabase
    .from('ads_agent_rehabilitation_log')
    .select('attempts, total_attempts')
    .eq('id', rehabId)
    .single();

  if (!entry) return;

  const attempts = (entry.attempts as RehabEntry['attempts']) || [];
  attempts.push({
    date: new Date().toISOString(),
    tactic,
    action_type: actionType,
    decision_id: decisionId,
  });

  await supabase
    .from('ads_agent_rehabilitation_log')
    .update({
      attempts,
      total_attempts: (entry.total_attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rehabId);
}

// ─── Tactic suggestion ─────────────────────────────────────────────────────

/** Ordered list of rehabilitation tactics to try. */
const TACTIC_SEQUENCE = [
  { tactic: 'new_ad_copy', description: 'Generate new RSA ad copy targeted to this industry' },
  { tactic: 'match_type_change', description: 'Try different match type (BROAD ↔ PHRASE)' },
  { tactic: 'bid_adjustment', description: 'Adjust bid to improve ad position' },
  { tactic: 'landing_page_review', description: 'Flag landing page for manual review and optimization' },
  { tactic: 'new_ad_angle', description: 'Try completely different ad messaging angle' },
  { tactic: 'audience_targeting', description: 'Review and adjust audience targeting' },
];

/**
 * Suggest the next rehabilitation tactic based on what's already been tried.
 */
export function suggestNextTactic(
  attempts: RehabEntry['attempts']
): { tactic: string; description: string } {
  const triedTactics = new Set(attempts.map(a => a.tactic));

  // Find first untried tactic
  for (const t of TACTIC_SEQUENCE) {
    if (!triedTactics.has(t.tactic)) return t;
  }

  // All tactics tried — cycle back with variations
  const cycleIndex = attempts.length % TACTIC_SEQUENCE.length;
  return {
    tactic: TACTIC_SEQUENCE[cycleIndex].tactic,
    description: `Re-attempt: ${TACTIC_SEQUENCE[cycleIndex].description} (variation ${Math.floor(attempts.length / TACTIC_SEQUENCE.length) + 1})`,
  };
}
