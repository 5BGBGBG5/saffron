export type ChangeType = 'feature' | 'fix' | 'improvement';

export interface ChangelogEntry {
  date: string;
  type: ChangeType;
  title: string;
  description: string;
}

// Newest first. To add an entry, prepend to this array.
export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    date: '2026-02-20',
    type: 'fix',
    title: 'Ad copy character limits and budget field name mismatch',
    description:
      'Fixed execution failures for replace_ad and adjust_budget actions. Descriptions exceeding the 90-character Google Ads limit are now truncated at word boundaries. The budget field name mismatch (new_budget_micros vs new_amount_micros) is resolved.',
  },
  {
    date: '2026-02-17',
    type: 'feature',
    title: 'Agent loop for recommendations',
    description:
      'Replaced the single-pass Claude call with an iterative tool-use agent loop. Saffron now investigates cross-agent signals, historical performance, and reallocation impact before submitting recommendations.',
  },
  {
    date: '2026-02-15',
    type: 'feature',
    title: 'Overview dashboard tab',
    description:
      'Added an Overview tab showing 60-day Google Ads performance trends with CPA and conversion charts pulled directly from the API.',
  },
  {
    date: '2026-02-15',
    type: 'feature',
    title: 'Replace ad compound action',
    description:
      'Added replace_ad as a single atomic action that creates a new RSA and pauses the old ad in one step, preventing ad groups from temporarily having no active ads.',
  },
  {
    date: '2026-02-15',
    type: 'feature',
    title: 'Ad visibility and pause/enable controls',
    description:
      'Added daily ad performance data to the dashboard with the ability to pause and enable individual ads directly from the UI.',
  },
  {
    date: '2026-02-15',
    type: 'improvement',
    title: 'Budget engine guardrails and enriched reasoning',
    description:
      'Added guardrail-based safety checks for budget changes, CPC spike detection, and minimum data thresholds. Proposal reasons now include detailed metric context.',
  },
  {
    date: '2026-02-15',
    type: 'feature',
    title: 'Standalone Saffron extraction',
    description:
      'Extracted Saffron from the SALT monorepo into its own standalone Next.js project with independent deployment on Vercel.',
  },
];
