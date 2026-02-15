"use client";

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createClient } from '@supabase/supabase-js';
import {
  Bell,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Shield,
  Activity,
  TrendingUp,
  DollarSign,
  MousePointerClick,
  Eye,
  Target,
  Clock,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Zap,
  FileText,
  BarChart3,
  X,
  Lightbulb,
  Calendar,
  Search,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export const dynamic = 'force-dynamic';

// AiEO Supabase client — Saffron's tables live in the AiEO project
const supabase = createClient(
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.NEXT_PUBLIC_AIEO_SUPABASE_ANON_KEY || 'placeholder'
);

// ─── Types ───────────────────────────────────────────────────────────────────

type Account = {
  id: string;
  account_name: string;
  google_ads_customer_id: string | null;
  monthly_budget: number;
  daily_budget_cap: number | null;
  currency: string;
  agent_mode: 'recommend' | 'semi_auto' | 'autonomous';
  is_active: boolean;
};

type Notification = {
  id: string;
  account_id: string;
  notification_type: string;
  severity: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  action_url: string | null;
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
};

type DecisionQueueItem = {
  id: string;
  account_id: string;
  change_log_id: string | null;
  action_type: string;
  action_summary: string;
  action_detail: Record<string, unknown>;
  reason: string;
  data_snapshot: Record<string, unknown> | null;
  risk_level: 'low' | 'medium' | 'high';
  priority: number;
  status: string;
  expires_at: string | null;
  created_at: string;
};

type DailyDigest = {
  id: string;
  account_id: string;
  digest_date: string;
  total_spend: number | null;
  budget_pacing_pct: number | null;
  total_clicks: number | null;
  total_impressions: number | null;
  total_conversions: number | null;
  avg_cpc: number | null;
  avg_ctr: number | null;
  cost_per_conversion: number | null;
  changes_made: number | null;
  changes_pending: number | null;
  changes_rejected: number | null;
  guardrails_triggered: number | null;
  anomalies_detected: unknown[] | null;
  top_performing: Record<string, unknown> | null;
  worst_performing: Record<string, unknown> | null;
  agent_notes: string | null;
  created_at: string;
};

type ChangeLogEntry = {
  id: string;
  account_id: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  action_type: string;
  action_detail: string;
  data_used: Record<string, unknown> | null;
  reason: string | null;
  outcome: string;
  executed_by: string | null;
  executed_at: string | null;
  created_at: string;
};

type Guardrail = {
  id: string;
  account_id: string;
  rule_name: string;
  rule_type: string;
  threshold_value: number | null;
  threshold_config: Record<string, unknown> | null;
  is_active: boolean;
  violation_action: string;
  created_at: string;
  updated_at: string;
};

type HistoricalInsight = {
  id: string;
  account_id: string;
  insight_type: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  confidence: number | null;
  impact_estimate: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type InsightsData = {
  insights: HistoricalInsight[];
  chartData: {
    monthlyTrends: Array<{
      month: string;
      impressions: number;
      clicks: number;
      cost: number;
      conversions: number;
      avgCpc: number;
      ctr: number;
      costPerConversion: number;
    }>;
    dayOfWeekPerformance: Array<{
      dayOfWeek: string;
      impressions: number;
      clicks: number;
      cost: number;
      conversions: number;
      avgCpc: number;
      ctr: number;
      costPerConversion: number;
      dataPoints: number;
    }>;
    topWastedKeywords: Array<{ keyword: string; cost: number; conversions: number }>;
    topConvertingKeywords: Array<{ keyword: string; cost: number; conversions: number; cpa: number }>;
  } | null;
  summary: {
    totalDays: number;
    totalSpend: number;
    totalClicks: number;
    totalImpressions: number;
    totalConversions: number;
    avgCpc: number;
    avgCpa: number;
    ctr: number;
    spendTrendDirection: string;
    conversionTrendDirection: string;
    bestDay: string;
    worstDay: string;
  } | null;
  narrative: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const severityConfig = {
  critical: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: AlertTriangle, label: 'Critical' },
  warning: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', icon: AlertTriangle, label: 'Warning' },
  info: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', icon: Info, label: 'Info' },
  success: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', icon: CheckCircle, label: 'Success' },
};

const riskConfig = {
  low: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  medium: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  high: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
};

const modeConfig = {
  recommend: { color: 'text-amber-400', bg: 'bg-amber-500/20', label: 'Recommend' },
  semi_auto: { color: 'text-blue-400', bg: 'bg-blue-500/20', label: 'Semi-Auto' },
  autonomous: { color: 'text-emerald-400', bg: 'bg-emerald-500/20', label: 'Autonomous' },
};

function formatCurrency(value: number | null, currency = 'USD'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function timeUntil(dateStr: string | null): string {
  if (!dateStr) return '—';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = date.getTime() - now.getTime();
  if (diffMs <= 0) return 'expired';
  const diffHrs = Math.floor(diffMs / 3600000);
  if (diffHrs < 1) return '<1h left';
  if (diffHrs < 24) return `${diffHrs}h left`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d left`;
}

const actionTypeLabels: Record<string, string> = {
  create_campaign: 'Create Campaign',
  pause_campaign: 'Pause Campaign',
  add_keyword: 'Add Keyword',
  add_negative_keyword: 'Add Negative',
  adjust_bid: 'Adjust Bid',
  adjust_budget: 'Adjust Budget',
  create_ad: 'Create Ad',
  pause_keyword: 'Pause Keyword',
  enable_campaign: 'Enable Campaign',
};

// ─── Section Components ──────────────────────────────────────────────────────

// ─── 1. Notification Center ─────────────────────────────────────────────────

function NotificationCenter({
  notifications,
  loading,
  onMarkRead,
  onDismiss,
}: {
  notifications: Notification[];
  loading: boolean;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const unread = notifications.filter(n => !n.is_read && !n.is_dismissed);
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  const sorted = [...unread].sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Notifications</h2>
          {unread.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
              {unread.length}
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card p-4 animate-pulse">
              <div className="h-4 bg-[var(--background-hover)] rounded w-1/3 mb-2" />
              <div className="h-3 bg-[var(--background-hover)] rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-[var(--text-secondary)] text-sm">All caught up — no unread notifications.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          <AnimatePresence>
            {sorted.map(n => {
              const sev = severityConfig[n.severity];
              const Icon = sev.icon;
              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 60 }}
                  className={`glass-card p-4 border ${sev.border} ${sev.bg}`}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${sev.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${sev.bg} ${sev.color}`}>
                          {sev.label}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">{timeAgo(n.created_at)}</span>
                      </div>
                      <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">{n.title}</h3>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{n.message}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => onMarkRead(n.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--background-hover)] text-[var(--text-secondary)] hover:text-[var(--accent-primary)] transition-colors"
                        title="Mark as read"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onDismiss(n.id)}
                        className="p-1.5 rounded-lg hover:bg-[var(--background-hover)] text-[var(--text-secondary)] hover:text-red-400 transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

// ─── 2. Decision Queue ──────────────────────────────────────────────────────

function DecisionQueue({
  items,
  loading,
  onDecide,
}: {
  items: DecisionQueueItem[];
  loading: boolean;
  onDecide: (id: string, decision: 'approved' | 'rejected', notes?: string) => void;
}) {
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);

  const pending = items
    .filter(i => i.status === 'pending')
    .sort((a, b) => {
      const priDiff = (b.priority ?? 0) - (a.priority ?? 0);
      if (priDiff !== 0) return priDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const handleDecide = async (id: string, decision: 'approved' | 'rejected') => {
    setDeciding(id);
    await onDecide(id, decision, reviewNotes[id]);
    setDeciding(null);
    setReviewNotes(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Decision Queue</h2>
          {pending.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">
              {pending.length} pending
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="glass-card p-4 animate-pulse">
              <div className="h-4 bg-[var(--background-hover)] rounded w-2/5 mb-2" />
              <div className="h-3 bg-[var(--background-hover)] rounded w-3/5 mb-3" />
              <div className="h-8 bg-[var(--background-hover)] rounded w-1/4" />
            </div>
          ))}
        </div>
      ) : pending.length === 0 ? (
        <div className="glass-card p-6 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-[var(--text-secondary)] text-sm">No pending decisions — Saffron is waiting for new data.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pending.map(item => {
            const risk = riskConfig[item.risk_level] || riskConfig.medium;
            const isExpanded = expandedId === item.id;
            return (
              <motion.div
                key={item.id}
                layout
                className={`glass-card p-4 border ${risk.border}`}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${risk.bg} ${risk.color}`}>
                        {item.risk_level}
                      </span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--background-hover)] text-[var(--text-secondary)]">
                        {actionTypeLabels[item.action_type] || item.action_type}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">
                        P{item.priority}
                      </span>
                    </div>
                    <h3 className="text-sm font-medium text-[var(--text-primary)]">{item.action_summary}</h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] flex-shrink-0">
                    <Clock className="w-3.5 h-3.5" />
                    {timeUntil(item.expires_at)}
                  </div>
                </div>

                {/* Reason */}
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3">{item.reason}</p>

                {/* Expandable data snapshot */}
                {item.data_snapshot && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : item.id)}
                    className="flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline mb-3"
                  >
                    {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    Supporting data
                  </button>
                )}
                <AnimatePresence>
                  {isExpanded && item.data_snapshot && (
                    <motion.pre
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="text-xs text-[var(--text-secondary)] bg-[var(--background-primary)] rounded-lg p-3 mb-3 overflow-x-auto"
                    >
                      {JSON.stringify(item.data_snapshot, null, 2)}
                    </motion.pre>
                  )}
                </AnimatePresence>

                {/* Notes + Approve/Reject */}
                <div className="flex items-end gap-2">
                  <input
                    type="text"
                    placeholder="Notes (optional)"
                    value={reviewNotes[item.id] || ''}
                    onChange={e => setReviewNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                    className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-primary)]"
                  />
                  <button
                    onClick={() => handleDecide(item.id, 'approved')}
                    disabled={deciding === item.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={() => handleDecide(item.id, 'rejected')}
                    disabled={deciding === item.id}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── 3. Daily Digest Card ───────────────────────────────────────────────────

function DailyDigestCard({
  digest,
  loading,
  monthlyBudget,
  selectedDate,
  onDateChange,
}: {
  digest: DailyDigest | null;
  loading: boolean;
  monthlyBudget: number;
  selectedDate: string;
  onDateChange: (date: string) => void;
}) {
  if (loading) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Daily Digest</h2>
        </div>
        <div className="glass-card p-6 animate-pulse">
          <div className="h-4 bg-[var(--background-hover)] rounded w-1/4 mb-4" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 bg-[var(--background-hover)] rounded" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Daily Digest</h2>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={e => onDateChange(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
        />
      </div>

      {!digest ? (
        <div className="glass-card p-6 text-center">
          <FileText className="w-8 h-8 text-[var(--text-secondary)] mx-auto mb-2" />
          <p className="text-[var(--text-secondary)] text-sm">No digest available for this date.</p>
        </div>
      ) : (
        <div className="glass-card p-5">
          {/* Budget pacing bar */}
          <div className="mb-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-[var(--text-secondary)]">Budget Pacing</span>
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {formatCurrency(digest.total_spend)} / {formatCurrency(monthlyBudget)} ({formatPct(digest.budget_pacing_pct)})
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-[var(--background-primary)] overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(digest.budget_pacing_pct ?? 0, 100)}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className={`h-full rounded-full ${
                  (digest.budget_pacing_pct ?? 0) > 90 ? 'bg-red-500' :
                  (digest.budget_pacing_pct ?? 0) > 70 ? 'bg-amber-500' :
                  'bg-emerald-500'
                }`}
              />
            </div>
          </div>

          {/* Key metrics grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <MetricTile icon={MousePointerClick} label="Clicks" value={formatNumber(digest.total_clicks)} />
            <MetricTile icon={Eye} label="Impressions" value={formatNumber(digest.total_impressions)} />
            <MetricTile icon={Target} label="Conversions" value={formatNumber(digest.total_conversions)} />
            <MetricTile icon={DollarSign} label="Avg CPC" value={formatCurrency(digest.avg_cpc)} />
            <MetricTile icon={TrendingUp} label="CTR" value={formatPct(digest.avg_ctr ? digest.avg_ctr * 100 : null)} />
            <MetricTile icon={DollarSign} label="Cost/Conv" value={formatCurrency(digest.cost_per_conversion)} />
            <MetricTile icon={Activity} label="Changes Made" value={String(digest.changes_made ?? 0)} />
            <MetricTile icon={Clock} label="Pending" value={String(digest.changes_pending ?? 0)} />
          </div>

          {/* Saffron activity summary */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="text-center p-2 rounded-lg bg-emerald-500/10">
              <div className="text-lg font-semibold text-emerald-400">{digest.changes_made ?? 0}</div>
              <div className="text-xs text-[var(--text-secondary)]">Executed</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-amber-500/10">
              <div className="text-lg font-semibold text-amber-400">{digest.changes_pending ?? 0}</div>
              <div className="text-xs text-[var(--text-secondary)]">Pending</div>
            </div>
            <div className="text-center p-2 rounded-lg bg-red-500/10">
              <div className="text-lg font-semibold text-red-400">{digest.changes_rejected ?? 0}</div>
              <div className="text-xs text-[var(--text-secondary)]">Rejected</div>
            </div>
          </div>

          {/* Anomalies */}
          {digest.anomalies_detected && (digest.anomalies_detected as unknown[]).length > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <h4 className="text-xs font-medium text-amber-400 mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Anomalies Detected
              </h4>
              <ul className="space-y-1">
                {(digest.anomalies_detected as string[]).map((a, i) => (
                  <li key={i} className="text-xs text-[var(--text-secondary)]">{typeof a === 'string' ? a : JSON.stringify(a)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Saffron narrative */}
          {digest.agent_notes && (
            <div className="p-3 rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)]">
              <h4 className="text-xs font-medium text-[var(--accent-primary)] mb-1.5">Saffron&apos;s Notes</h4>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{digest.agent_notes}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function MetricTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-[var(--background-primary)] border border-[var(--border-secondary)]">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-[var(--accent-primary)]" />
        <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="text-sm font-semibold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

// ─── 4. Change Log ──────────────────────────────────────────────────────────

function ChangeLog({
  entries,
  loading,
  totalCount,
  page,
  pageSize,
  onPageChange,
  actionTypeFilter,
  onActionTypeFilterChange,
  outcomeFilter,
  onOutcomeFilterChange,
}: {
  entries: ChangeLogEntry[];
  loading: boolean;
  totalCount: number;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  actionTypeFilter: string;
  onActionTypeFilterChange: (v: string) => void;
  outcomeFilter: string;
  onOutcomeFilterChange: (v: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const totalPages = Math.ceil(totalCount / pageSize);

  const outcomeStyles: Record<string, string> = {
    executed: 'bg-emerald-500/10 text-emerald-400',
    approved: 'bg-blue-500/10 text-blue-400',
    rejected: 'bg-red-500/10 text-red-400',
    pending: 'bg-amber-500/10 text-amber-400',
    auto_executed: 'bg-cyan-500/10 text-cyan-400',
    expired: 'bg-gray-500/10 text-gray-400',
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Change Log</h2>
          <span className="text-xs text-[var(--text-secondary)]">({totalCount} entries)</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={actionTypeFilter}
            onChange={e => onActionTypeFilterChange(e.target.value)}
            className="px-2 py-1 text-xs rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          >
            <option value="all">All Actions</option>
            <option value="create_campaign">Create Campaign</option>
            <option value="pause_campaign">Pause Campaign</option>
            <option value="add_keyword">Add Keyword</option>
            <option value="add_negative_keyword">Add Negative</option>
            <option value="adjust_bid">Adjust Bid</option>
            <option value="adjust_budget">Adjust Budget</option>
            <option value="create_ad">Create Ad</option>
          </select>
          <select
            value={outcomeFilter}
            onChange={e => onOutcomeFilterChange(e.target.value)}
            className="px-2 py-1 text-xs rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
          >
            <option value="all">All Outcomes</option>
            <option value="executed">Executed</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending">Pending</option>
            <option value="auto_executed">Auto-Executed</option>
            <option value="expired">Expired</option>
          </select>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 bg-[var(--background-hover)] rounded animate-pulse" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-[var(--text-secondary)] text-sm">No change log entries found.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--border-primary)]">
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Time</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Detail</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Outcome</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">By</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-secondary)]">
                  {entries.map(entry => (
                    <React.Fragment key={entry.id}>
                      <tr className="hover:bg-[var(--background-hover)] transition-colors">
                        <td className="px-4 py-3 text-xs text-[var(--text-secondary)] whitespace-nowrap">
                          {new Date(entry.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}{' '}
                          {new Date(entry.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--background-hover)] text-[var(--text-primary)]">
                            {actionTypeLabels[entry.action_type] || entry.action_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-primary)] max-w-[300px] truncate">{entry.action_detail}</td>
                        <td className="px-4 py-3 text-xs text-[var(--text-secondary)] max-w-[200px] truncate">{entry.reason || '—'}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${outcomeStyles[entry.outcome] || 'text-[var(--text-secondary)]'}`}>
                            {entry.outcome}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">{entry.executed_by || '—'}</td>
                        <td className="px-4 py-3">
                          {entry.data_used && (
                            <button
                              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                              className="text-xs text-[var(--accent-primary)] hover:underline"
                            >
                              {expandedId === entry.id ? 'Hide' : 'Data'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedId === entry.id && entry.data_used && (
                        <tr>
                          <td colSpan={7} className="px-4 py-3 bg-[var(--background-primary)]">
                            <pre className="text-xs text-[var(--text-secondary)] overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(entry.data_used, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-primary)]">
                <span className="text-xs text-[var(--text-secondary)]">
                  Page {page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onPageChange(page - 1)}
                    disabled={page <= 1}
                    className="px-3 py-1 text-xs rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => onPageChange(page + 1)}
                    disabled={page >= totalPages}
                    className="px-3 py-1 text-xs rounded-lg bg-[var(--background-primary)] border border-[var(--border-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 transition-colors"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ─── 5. Guardrail Configuration ─────────────────────────────────────────────

function GuardrailConfig({
  guardrails,
  loading,
  onToggle,
  onUpdateThreshold,
}: {
  guardrails: Guardrail[];
  loading: boolean;
  onToggle: (id: string, active: boolean) => void;
  onUpdateThreshold: (id: string, value: number) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleSave = (id: string) => {
    const num = parseFloat(editValue);
    if (!isNaN(num)) {
      onUpdateThreshold(id, num);
    }
    setEditingId(null);
  };

  const ruleTypeDescriptions: Record<string, string> = {
    max_daily_spend_pct: '% of daily budget',
    max_bid_change_pct: '% max change',
    min_data_points: 'clicks required',
    min_conversion_window_hours: 'hours',
    max_cpc_threshold: 'USD max',
    cpc_spike_alert_pct: '% vs 7-day avg',
    never_pause_converting: 'days lookback',
    require_approval_above_spend: 'USD threshold',
  };

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-5 h-5 text-[var(--accent-primary)]" />
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Guardrails</h2>
      </div>

      <div className="glass-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-[var(--background-hover)] rounded animate-pulse" />
            ))}
          </div>
        ) : guardrails.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-[var(--text-secondary)] text-sm">No guardrails configured yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--border-primary)]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Rule</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Threshold</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Violation Action</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wider">Active</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-secondary)]">
                {guardrails.map(g => (
                  <tr key={g.id} className="hover:bg-[var(--background-hover)] transition-colors">
                    <td className="px-4 py-3 text-sm text-[var(--text-primary)]">{g.rule_name}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--background-hover)] text-[var(--text-secondary)]">
                        {g.rule_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {editingId === g.id ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={editValue}
                            onChange={e => setEditValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleSave(g.id)}
                            className="w-20 px-2 py-1 text-xs rounded bg-[var(--background-primary)] border border-[var(--accent-primary)] text-[var(--text-primary)] focus:outline-none"
                            autoFocus
                          />
                          <button onClick={() => handleSave(g.id)} className="text-xs text-emerald-400 hover:underline">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-[var(--text-secondary)] hover:underline">Cancel</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(g.id); setEditValue(String(g.threshold_value ?? '')); }}
                          className="text-sm text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors"
                        >
                          {g.threshold_value ?? '—'}
                          <span className="text-xs text-[var(--text-secondary)] ml-1">
                            {ruleTypeDescriptions[g.rule_type] || ''}
                          </span>
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        g.violation_action === 'block_and_alert' ? 'bg-red-500/10 text-red-400' :
                        g.violation_action === 'alert_only' ? 'bg-amber-500/10 text-amber-400' :
                        'bg-gray-500/10 text-gray-400'
                      }`}>
                        {g.violation_action.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => onToggle(g.id, !g.is_active)}
                        className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${
                          g.is_active ? 'bg-emerald-500' : 'bg-[var(--border-primary)]'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transform transition-transform mt-[3px] ${
                            g.is_active ? 'translate-x-[18px]' : 'translate-x-[3px]'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 6. Historical Insights ──────────────────────────────────────────────────

function HistoricalInsights({
  insights,
  insightsData,
  loading,
  generating,
  onGenerate,
  onDismissInsight,
}: {
  insights: HistoricalInsight[];
  insightsData: InsightsData | null;
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
  onDismissInsight: (id: string) => void;
}) {
  const chartData = insightsData?.chartData;
  const summary = insightsData?.summary;

  const insightTypeConfig: Record<string, { color: string; bg: string; label: string }> = {
    trend: { color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Trend' },
    anomaly_pattern: { color: 'text-red-400', bg: 'bg-red-500/10', label: 'Pattern' },
    optimization: { color: 'text-emerald-400', bg: 'bg-emerald-500/10', label: 'Optimization' },
    seasonal: { color: 'text-purple-400', bg: 'bg-purple-500/10', label: 'Seasonal' },
  };

  const impactConfig: Record<string, { color: string; bg: string }> = {
    high: { color: 'text-red-400', bg: 'bg-red-500/10' },
    medium: { color: 'text-amber-400', bg: 'bg-amber-500/10' },
    low: { color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  };

  // Short day labels for chart
  const dayLabels: Record<string, string> = {
    SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
    THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat',
  };

  const activeInsights = insights.filter(i => i.status === 'active');

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-[var(--accent-primary)]" />
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Historical Insights</h2>
          {activeInsights.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400">
              {activeInsights.length}
            </span>
          )}
        </div>
        <button
          onClick={onGenerate}
          disabled={generating}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 hover:bg-[var(--accent-primary)]/30 disabled:opacity-50 transition-colors"
        >
          {generating ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              Analyzing 365 days...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Generate Insights
            </>
          )}
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="glass-card p-5 animate-pulse">
              <div className="h-4 bg-[var(--background-hover)] rounded w-1/4 mb-3" />
              <div className="h-32 bg-[var(--background-hover)] rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* KPI Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <MetricTile icon={DollarSign} label="Total Spend" value={formatCurrency(summary.totalSpend)} />
              <MetricTile icon={MousePointerClick} label="Total Clicks" value={formatNumber(summary.totalClicks)} />
              <MetricTile icon={Target} label="Conversions" value={formatNumber(summary.totalConversions)} />
              <MetricTile icon={DollarSign} label="Avg CPC" value={formatCurrency(summary.avgCpc)} />
              <MetricTile icon={DollarSign} label="Avg CPA" value={summary.avgCpa > 0 ? formatCurrency(summary.avgCpa) : '—'} />
            </div>
          )}

          {/* Monthly Trend Chart */}
          {chartData?.monthlyTrends && chartData.monthlyTrends.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--accent-primary)]" />
                Monthly Spend & Conversions
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData.monthlyTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15,23,42,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.8)',
                    }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={((value: any, name: any) => {
                      const v = Number(value) || 0;
                      if (name === 'Spend') return [`$${v.toFixed(2)}`, name];
                      return [v, name];
                    }) as any}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="cost"
                    name="Spend"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={{ fill: '#f59e0b', r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="conversions"
                    name="Conversions"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ fill: '#10b981', r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Day of Week Chart */}
          {chartData?.dayOfWeekPerformance && chartData.dayOfWeekPerformance.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-medium text-[var(--text-primary)] mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[var(--accent-primary)]" />
                Day-of-Week Performance (Daily Averages)
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData.dayOfWeekPerformance.map(d => ({ ...d, dayLabel: dayLabels[d.dayOfWeek] || d.dayOfWeek }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis
                    dataKey="dayLabel"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15,23,42,0.95)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'rgba(255,255,255,0.8)',
                    }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={((value: any, name: any) => {
                      const v = Number(value) || 0;
                      if (name === 'Avg Spend') return [`$${v.toFixed(2)}`, name];
                      return [v, name];
                    }) as any}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)' }} />
                  <Bar yAxisId="left" dataKey="cost" name="Avg Spend" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="clicks" name="Avg Clicks" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Keyword Performance Tables */}
          {chartData && (chartData.topWastedKeywords?.length > 0 || chartData.topConvertingKeywords?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top Wasted Keywords */}
              {chartData.topWastedKeywords && chartData.topWastedKeywords.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-sm font-medium text-red-400 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Top Wasted Spend (0 conversions)
                  </h3>
                  <div className="space-y-2">
                    {chartData.topWastedKeywords.map((kw, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-primary)] truncate max-w-[200px]">{kw.keyword}</span>
                        <span className="text-red-400 font-medium">{formatCurrency(kw.cost)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Converting Keywords */}
              {chartData.topConvertingKeywords && chartData.topConvertingKeywords.length > 0 && (
                <div className="glass-card p-4">
                  <h3 className="text-sm font-medium text-emerald-400 mb-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" />
                    Top Converting Keywords
                  </h3>
                  <div className="space-y-2">
                    {chartData.topConvertingKeywords.map((kw, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-[var(--text-primary)] truncate max-w-[150px]">{kw.keyword}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-emerald-400">{kw.conversions} conv</span>
                          <span className="text-[var(--text-secondary)]">CPA: {formatCurrency(kw.cpa)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Narrative */}
          {insightsData?.narrative && (
            <div className="glass-card p-4 border border-[var(--accent-primary)]/20">
              <h3 className="text-xs font-medium text-[var(--accent-primary)] mb-2">Saffron&apos;s Analysis</h3>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap">{insightsData.narrative}</p>
            </div>
          )}

          {/* Insight Cards */}
          {activeInsights.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-[var(--accent-primary)]" />
                AI-Generated Insights
              </h3>
              {activeInsights.map(insight => {
                const typeConf = insightTypeConfig[insight.insight_type] || insightTypeConfig.optimization;
                const impConf = impactConfig[insight.impact_estimate || 'medium'] || impactConfig.medium;
                return (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-card p-4 border border-[var(--border-secondary)]"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${typeConf.bg} ${typeConf.color}`}>
                          {typeConf.label}
                        </span>
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${impConf.bg} ${impConf.color}`}>
                          {insight.impact_estimate || 'medium'} impact
                        </span>
                        {insight.confidence !== null && (
                          <span className="text-xs text-[var(--text-secondary)]">
                            {Math.round(insight.confidence * 100)}% confidence
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => onDismissInsight(insight.id)}
                        className="p-1 rounded hover:bg-[var(--background-hover)] text-[var(--text-secondary)] hover:text-red-400 transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <h4 className="text-sm font-medium text-[var(--text-primary)] mb-1">{insight.title}</h4>
                    <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-2">{insight.description}</p>
                    {insight.data?.recommended_action ? (
                      <div className="text-xs text-[var(--accent-primary)] mt-2 p-2 rounded bg-[var(--accent-primary)]/5 border border-[var(--accent-primary)]/10">
                        <strong>Recommended:</strong> {String(insight.data.recommended_action)}
                      </div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          ) : !chartData && !generating ? (
            <div className="glass-card p-6 text-center">
              <Lightbulb className="w-8 h-8 text-[var(--text-secondary)] mx-auto mb-2" />
              <p className="text-[var(--text-secondary)] text-sm">
                Click &quot;Generate Insights&quot; to analyze 365 days of Google Ads data.
              </p>
              <p className="text-[var(--text-secondary)] text-xs mt-1">
                Saffron will identify patterns, trends, and optimization opportunities.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

// ─── Competitors Panel ──────────────────────────────────────────────────────

function CompetitorsPanel({
  competitors,
  loading,
  onRefresh,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  competitors: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch('/api/ads-agent/weekly', { method: 'POST' });
      // Wait a moment then refresh data
      setTimeout(() => {
        onRefresh();
        setRefreshing(false);
      }, 3000);
    } catch {
      setRefreshing(false);
    }
  };

  // Aggregate by competitor domain
  const competitorAgg = useMemo(() => {
    const map = new Map<string, {
      domain: string;
      avgImpressionShare: number;
      avgOverlapRate: number;
      avgOutrankingShare: number;
      avgPositionAbove: number;
      campaigns: string[];
      count: number;
    }>();

    for (const row of competitors) {
      const existing = map.get(row.competitor_domain) || {
        domain: row.competitor_domain,
        avgImpressionShare: 0,
        avgOverlapRate: 0,
        avgOutrankingShare: 0,
        avgPositionAbove: 0,
        campaigns: [] as string[],
        count: 0,
      };
      existing.avgImpressionShare += row.impression_share || 0;
      existing.avgOverlapRate += row.overlap_rate || 0;
      existing.avgOutrankingShare += row.outranking_share || 0;
      existing.avgPositionAbove += row.position_above_rate || 0;
      if (!existing.campaigns.includes(row.campaign_name)) {
        existing.campaigns.push(row.campaign_name);
      }
      existing.count++;
      map.set(row.competitor_domain, existing);
    }

    return Array.from(map.values())
      .map(c => ({
        ...c,
        avgImpressionShare: c.avgImpressionShare / c.count,
        avgOverlapRate: c.avgOverlapRate / c.count,
        avgOutrankingShare: c.avgOutrankingShare / c.count,
        avgPositionAbove: c.avgPositionAbove / c.count,
      }))
      .sort((a, b) => b.avgImpressionShare - a.avgImpressionShare);
  }, [competitors]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent-primary)]" />
        <span className="ml-2 text-[var(--text-secondary)]">Loading competitor data...</span>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Competitor Landscape</h2>
          <p className="text-sm text-[var(--text-secondary)]">Auction insights showing who competes for your ad space</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] rounded-lg text-sm font-medium hover:bg-[var(--accent-primary)]/20 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing...' : 'Refresh Data'}
        </button>
      </div>

      {competitorAgg.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">
          <Search className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p>No competitor data yet.</p>
          <p className="text-sm mt-1">Click &quot;Refresh Data&quot; to pull auction insights from Google Ads.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-primary)]">
                <th className="text-left py-3 px-3 text-[var(--text-secondary)] font-medium">Competitor</th>
                <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Impression Share</th>
                <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Overlap Rate</th>
                <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Outranking Share</th>
                <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Position Above</th>
                <th className="text-left py-3 px-3 text-[var(--text-secondary)] font-medium">Campaigns</th>
              </tr>
            </thead>
            <tbody>
              {competitorAgg.map((comp, i) => (
                <tr key={comp.domain} className={`border-b border-[var(--border-primary)]/50 ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]/30' : ''}`}>
                  <td className="py-3 px-3 font-medium text-[var(--text-primary)]">{comp.domain}</td>
                  <td className="py-3 px-3 text-right">
                    <span className={comp.avgImpressionShare > 0.5 ? 'text-red-400' : comp.avgImpressionShare > 0.3 ? 'text-amber-400' : 'text-emerald-400'}>
                      {(comp.avgImpressionShare * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{(comp.avgOverlapRate * 100).toFixed(1)}%</td>
                  <td className="py-3 px-3 text-right">
                    <span className={comp.avgOutrankingShare > 0.5 ? 'text-red-400' : 'text-[var(--text-secondary)]'}>
                      {(comp.avgOutrankingShare * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{(comp.avgPositionAbove * 100).toFixed(1)}%</td>
                  <td className="py-3 px-3 text-[var(--text-secondary)] text-xs">{comp.campaigns.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Revenue Panel ──────────────────────────────────────────────────────────

function RevenuePanel({
  data,
  loading,
  onSync,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  loading: boolean;
  onSync: () => void;
}) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/ads-agent/hubspot-sync', { method: 'POST' });
      setTimeout(() => {
        onSync();
        setSyncing(false);
      }, 3000);
    } catch {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent-primary)]" />
        <span className="ml-2 text-[var(--text-secondary)]">Loading revenue data...</span>
      </div>
    );
  }

  const pipeline = data?.pipeline;
  const qualityByCampaign = data?.qualityByCampaign || [];
  const qualityByKeyword = data?.qualityByKeyword || [];

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Revenue Intelligence</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            HubSpot deal data mapped to Google Ads campaigns
            {pipeline?.lastSynced && (
              <span className="ml-2 text-xs opacity-60">Last synced: {new Date(pipeline.lastSynced).toLocaleDateString()}</span>
            )}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] rounded-lg text-sm font-medium hover:bg-[var(--accent-primary)]/20 transition disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync HubSpot'}
        </button>
      </div>

      {!pipeline || pipeline.totalDeals === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">
          <DollarSign className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p>No HubSpot deal data yet.</p>
          <p className="text-sm mt-1">Click &quot;Sync HubSpot&quot; to pull deal data and map it to your campaigns.</p>
        </div>
      ) : (
        <>
          {/* Pipeline KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-primary)]">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Total Deals</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{pipeline.totalDeals}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-primary)]">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Total Value</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">${(pipeline.totalValue || 0).toLocaleString()}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-primary)]">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Deal Stages</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">{Object.keys(pipeline.byStage || {}).length}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] rounded-lg p-4 border border-[var(--border-primary)]">
              <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">Avg Deal Value</p>
              <p className="text-2xl font-bold text-[var(--text-primary)] mt-1">
                ${pipeline.totalDeals > 0 ? Math.round(pipeline.totalValue / pipeline.totalDeals).toLocaleString() : '0'}
              </p>
            </div>
          </div>

          {/* Campaign Quality */}
          {qualityByCampaign.length > 0 && (
            <div>
              <h3 className="text-md font-semibold text-[var(--text-primary)] mb-3">Campaign → Revenue Quality</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-primary)]">
                      <th className="text-left py-3 px-3 text-[var(--text-secondary)] font-medium">UTM Campaign</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Deals</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Closed</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Close Rate</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Revenue</th>
                      <th className="text-center py-3 px-3 text-[var(--text-secondary)] font-medium">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {qualityByCampaign.map((q: any, i: number) => (
                      <tr key={q.utm_campaign} className={`border-b border-[var(--border-primary)]/50 ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]/30' : ''}`}>
                        <td className="py-3 px-3 font-medium text-[var(--text-primary)]">{q.utm_campaign}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{q.total_deals}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{q.closed_deals}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{(q.close_rate * 100).toFixed(0)}%</td>
                        <td className="py-3 px-3 text-right font-medium text-emerald-400">${(q.closed_deal_value || 0).toLocaleString()}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            q.quality_score === 'high' ? 'bg-emerald-500/20 text-emerald-400' :
                            q.quality_score === 'low' ? 'bg-red-500/20 text-red-400' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>
                            {q.quality_score}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Keyword Quality */}
          {qualityByKeyword.length > 0 && (
            <div>
              <h3 className="text-md font-semibold text-[var(--text-primary)] mb-3">Keyword → Revenue Mapping</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-primary)]">
                      <th className="text-left py-3 px-3 text-[var(--text-secondary)] font-medium">UTM Term (Keyword)</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Deals</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Closed</th>
                      <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Total Value</th>
                      <th className="text-center py-3 px-3 text-[var(--text-secondary)] font-medium">Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                    {qualityByKeyword.map((q: any, i: number) => (
                      <tr key={q.utm_term} className={`border-b border-[var(--border-primary)]/50 ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]/30' : ''}`}>
                        <td className="py-3 px-3 font-medium text-[var(--text-primary)]">{q.utm_term}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{q.total_deals}</td>
                        <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{q.closed_deals}</td>
                        <td className="py-3 px-3 text-right font-medium text-emerald-400">${(q.total_deal_value || 0).toLocaleString()}</td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            q.quality_score === 'high' ? 'bg-emerald-500/20 text-emerald-400' :
                            q.quality_score === 'low' ? 'bg-red-500/20 text-red-400' :
                            'bg-amber-500/20 text-amber-400'
                          }`}>
                            {q.quality_score}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ─── Active Tab Navigation ──────────────────────────────────────────────────

type TabId = 'notifications' | 'decisions' | 'digest' | 'insights' | 'competitors' | 'revenue' | 'changelog' | 'guardrails';

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'decisions', label: 'Decisions', icon: Zap },
  { id: 'digest', label: 'Daily Digest', icon: BarChart3 },
  { id: 'insights', label: 'Insights', icon: Lightbulb },
  // { id: 'competitors', label: 'Competitors', icon: Search },   // Hidden: Google Ads auction_insight API requires allowlisting
  // { id: 'revenue', label: 'Revenue', icon: DollarSign },       // Hidden: HUBSPOT_PRIVATE_APP_TOKEN not yet configured in Vercel
  { id: 'changelog', label: 'Change Log', icon: FileText },
  { id: 'guardrails', label: 'Guardrails', icon: Shield },
];

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function SaffronPage() {
  // ── Account state ──
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);

  // ── Section data ──
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);

  const [decisions, setDecisions] = useState<DecisionQueueItem[]>([]);
  const [decisionsLoading, setDecisionsLoading] = useState(true);

  const [digest, setDigest] = useState<DailyDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(true);
  const [digestDate, setDigestDate] = useState(new Date().toISOString().split('T')[0]);

  const [changeLog, setChangeLog] = useState<ChangeLogEntry[]>([]);
  const [changeLogLoading, setChangeLogLoading] = useState(true);
  const [changeLogCount, setChangeLogCount] = useState(0);
  const [changeLogPage, setChangeLogPage] = useState(1);
  const changeLogPageSize = 25;
  const [actionTypeFilter, setActionTypeFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');

  const [guardrails, setGuardrails] = useState<Guardrail[]>([]);
  const [guardrailsLoading, setGuardrailsLoading] = useState(true);

  const [insights, setInsights] = useState<HistoricalInsight[]>([]);
  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [insightsGenerating, setInsightsGenerating] = useState(false);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [competitors, setCompetitors] = useState<any[]>([]);
  const [competitorsLoading, setCompetitorsLoading] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [revenueData, setRevenueData] = useState<any>(null);
  const [revenueLoading, setRevenueLoading] = useState(true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rehabData, setRehabData] = useState<any[]>([]);
  const [rehabLoading, setRehabLoading] = useState(true);

  const [activeTab, setActiveTab] = useState<TabId>('notifications');
  const [error, setError] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  // ── Fetch accounts on mount ──
  useEffect(() => {
    async function fetchAccounts() {
      setAccountsLoading(true);
      const { data, error } = await supabase
        .from('ads_agent_accounts')
        .select('id, account_name, google_ads_customer_id, monthly_budget, daily_budget_cap, currency, agent_mode, is_active')
        .eq('is_active', true)
        .order('account_name');

      if (error) {
        setError(`Failed to load accounts: ${error.message}`);
        setAccountsLoading(false);
        return;
      }
      setAccounts(data || []);
      if (data && data.length > 0) {
        setSelectedAccountId(data[0].id);
      }
      setAccountsLoading(false);
    }
    fetchAccounts();
  }, []);

  // ── Fetch notifications ──
  const fetchNotifications = useCallback(async () => {
    if (!selectedAccountId) return;
    setNotificationsLoading(true);
    const { data, error } = await supabase
      .from('ads_agent_notifications')
      .select('*')
      .eq('account_id', selectedAccountId)
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error) setNotifications(data || []);
    setNotificationsLoading(false);
  }, [selectedAccountId]);

  // ── Fetch decisions ──
  const fetchDecisions = useCallback(async () => {
    if (!selectedAccountId) return;
    setDecisionsLoading(true);
    const { data, error } = await supabase
      .from('ads_agent_decision_queue')
      .select('*')
      .eq('account_id', selectedAccountId)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (!error) setDecisions(data || []);
    setDecisionsLoading(false);
  }, [selectedAccountId]);

  // ── Fetch digest ──
  const fetchDigest = useCallback(async () => {
    if (!selectedAccountId) return;
    setDigestLoading(true);
    const { data, error } = await supabase
      .from('ads_agent_daily_digest')
      .select('*')
      .eq('account_id', selectedAccountId)
      .eq('digest_date', digestDate)
      .maybeSingle();

    if (!error) setDigest(data);
    setDigestLoading(false);
  }, [selectedAccountId, digestDate]);

  // ── Fetch change log ──
  const fetchChangeLog = useCallback(async () => {
    if (!selectedAccountId) return;
    setChangeLogLoading(true);

    let query = supabase
      .from('ads_agent_change_log')
      .select('*', { count: 'exact' })
      .eq('account_id', selectedAccountId);

    if (actionTypeFilter !== 'all') query = query.eq('action_type', actionTypeFilter);
    if (outcomeFilter !== 'all') query = query.eq('outcome', outcomeFilter);

    const start = (changeLogPage - 1) * changeLogPageSize;
    const end = start + changeLogPageSize - 1;

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(start, end);

    if (!error) {
      setChangeLog(data || []);
      setChangeLogCount(count || 0);
    }
    setChangeLogLoading(false);
  }, [selectedAccountId, changeLogPage, actionTypeFilter, outcomeFilter]);

  // ── Fetch guardrails ──
  const fetchGuardrails = useCallback(async () => {
    if (!selectedAccountId) return;
    setGuardrailsLoading(true);
    const { data, error } = await supabase
      .from('ads_agent_guardrails')
      .select('*')
      .eq('account_id', selectedAccountId)
      .order('rule_name');

    if (!error) setGuardrails(data || []);
    setGuardrailsLoading(false);
  }, [selectedAccountId]);

  // ── Fetch insights ──
  const fetchInsights = useCallback(async () => {
    if (!selectedAccountId) return;
    setInsightsLoading(true);
    const { data, error } = await supabase
      .from('ads_agent_historical_insights')
      .select('*')
      .eq('account_id', selectedAccountId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!error) setInsights(data || []);
    setInsightsLoading(false);
  }, [selectedAccountId]);

  // ── Fetch competitors ──
  const fetchCompetitors = useCallback(async () => {
    if (!selectedAccountId) return;
    setCompetitorsLoading(true);
    const { data } = await supabase
      .from('ads_agent_auction_insights')
      .select('*')
      .eq('account_id', selectedAccountId)
      .order('impression_share', { ascending: false });
    setCompetitors(data || []);
    setCompetitorsLoading(false);
  }, [selectedAccountId]);

  // ── Fetch revenue data ──
  const fetchRevenue = useCallback(async () => {
    if (!selectedAccountId) return;
    setRevenueLoading(true);
    try {
      const response = await fetch('/api/ads-agent/hubspot-sync');
      if (response.ok) {
        const data = await response.json();
        setRevenueData(data);
      }
    } catch (err) {
      console.error('Failed to fetch revenue data:', err);
    }
    setRevenueLoading(false);
  }, [selectedAccountId]);

  // ── Fetch rehabilitation data ──
  const fetchRehab = useCallback(async () => {
    if (!selectedAccountId) return;
    setRehabLoading(true);
    const { data } = await supabase
      .from('ads_agent_rehabilitation_log')
      .select('*')
      .eq('account_id', selectedAccountId)
      .order('updated_at', { ascending: false });
    setRehabData(data || []);
    setRehabLoading(false);
  }, [selectedAccountId]);

  // ── Load data when account changes ──
  useEffect(() => {
    if (!selectedAccountId) return;
    fetchNotifications();
    fetchDecisions();
    fetchDigest();
    fetchChangeLog();
    fetchGuardrails();
    fetchInsights();
  }, [selectedAccountId, fetchNotifications, fetchDecisions, fetchDigest, fetchChangeLog, fetchGuardrails, fetchInsights]);

  // ── Re-fetch digest when date changes ──
  useEffect(() => {
    fetchDigest();
  }, [digestDate, fetchDigest]);

  // ── Re-fetch change log when filters/page change ──
  useEffect(() => {
    fetchChangeLog();
  }, [changeLogPage, actionTypeFilter, outcomeFilter, fetchChangeLog]);

  // ── Load tab-specific data ──
  useEffect(() => {
    if (!selectedAccountId) return;
    if (activeTab === 'competitors') fetchCompetitors();
    if (activeTab === 'revenue') fetchRevenue();
    if (activeTab === 'insights') fetchRehab();
  }, [activeTab, selectedAccountId, fetchCompetitors, fetchRevenue, fetchRehab]);

  // ── Action handlers ──

  const handleMarkRead = async (id: string) => {
    const { error } = await supabase
      .from('ads_agent_notifications')
      .update({ is_read: true })
      .eq('id', id);
    if (!error) setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const handleDismiss = async (id: string) => {
    const { error } = await supabase
      .from('ads_agent_notifications')
      .update({ is_dismissed: true })
      .eq('id', id);
    if (!error) setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_dismissed: true } : n));
  };

  const handleDecide = async (id: string, decision: 'approved' | 'rejected', notes?: string) => {
    try {
      const res = await fetch('/api/ads-agent/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision_id: id, decision, notes }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('Decision failed:', body);
        return;
      }
      // Refresh decisions and change log
      fetchDecisions();
      fetchChangeLog();
      fetchNotifications();
    } catch (err) {
      console.error('Decision error:', err);
    }
  };

  const handleGuardrailToggle = async (id: string, active: boolean) => {
    const { error } = await supabase
      .from('ads_agent_guardrails')
      .update({ is_active: active, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) setGuardrails(prev => prev.map(g => g.id === id ? { ...g, is_active: active } : g));
  };

  const handleGuardrailThreshold = async (id: string, value: number) => {
    const { error } = await supabase
      .from('ads_agent_guardrails')
      .update({ threshold_value: value, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) setGuardrails(prev => prev.map(g => g.id === id ? { ...g, threshold_value: value } : g));
  };

  // ── Generate insights ──
  const handleGenerateInsights = async () => {
    setInsightsGenerating(true);
    try {
      const res = await fetch('/api/ads-agent/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.results?.[0]) {
          const result = data.results[0];
          setInsightsData({
            insights: [],
            chartData: result.chartData || null,
            summary: result.summary || null,
            narrative: result.narrative || null,
          });
        }
        // Refresh stored insights
        fetchInsights();
        fetchNotifications();
      }
    } catch (err) {
      console.error('Failed to generate insights:', err);
    }
    setInsightsGenerating(false);
  };

  const handleDismissInsight = async (id: string) => {
    const { error } = await supabase
      .from('ads_agent_historical_insights')
      .update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('id', id);
    if (!error) setInsights(prev => prev.filter(i => i.id !== id));
  };

  // ── Badge counts ──
  const unreadCount = notifications.filter(n => !n.is_read && !n.is_dismissed).length;
  const pendingCount = decisions.filter(d => d.status === 'pending').length;
  const insightCount = insights.filter(i => i.status === 'active').length;

  // ── Render ──

  if (accountsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-[var(--accent-primary)] mx-auto animate-spin mb-3" />
          <p className="text-[var(--text-secondary)] text-sm">Loading Saffron...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="glass-card p-6 max-w-md text-center">
          <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* ── Background effects ── */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/20 via-emerald-500/10 to-teal-600/20 animate-pulse" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-400/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-emerald-400/10 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-4 py-6">
        {/* ── Page Header ── */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6"
        >
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-teal-200 to-emerald-200 bg-clip-text text-transparent">
              Saffron
            </h1>
            <p className="text-sm text-[var(--text-secondary)]">PPC Agent — SALT Crew</p>
          </div>

          <div className="flex items-center gap-3">
            {/* Account selector */}
            <select
              value={selectedAccountId || ''}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg bg-[var(--background-secondary)] border border-[var(--border-primary)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-primary)]"
            >
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.account_name}</option>
              ))}
            </select>

            {/* Mode indicator */}
            {selectedAccount && (
              <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium ${modeConfig[selectedAccount.agent_mode].bg}`}>
                <div className={`w-2 h-2 rounded-full ${
                  selectedAccount.agent_mode === 'recommend' ? 'bg-amber-400' :
                  selectedAccount.agent_mode === 'semi_auto' ? 'bg-blue-400' : 'bg-emerald-400'
                }`} />
                <span className={modeConfig[selectedAccount.agent_mode].color}>
                  {modeConfig[selectedAccount.agent_mode].label}
                </span>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Tab Navigation ── */}
        <div className="border-b border-[var(--border-primary)] mb-6">
          <nav className="-mb-px flex space-x-1 overflow-x-auto">
            {tabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              let badge: number | null = null;
              if (tab.id === 'notifications' && unreadCount > 0) badge = unreadCount;
              if (tab.id === 'decisions' && pendingCount > 0) badge = pendingCount;
              if (tab.id === 'insights' && insightCount > 0) badge = insightCount;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap py-3 px-4 border-b-2 text-sm font-medium transition-all ${
                    isActive
                      ? 'border-[var(--accent-primary)] text-[var(--accent-primary)]'
                      : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)]'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                  {badge !== null && (
                    <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Tab Content ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
          >
            {activeTab === 'notifications' && (
              <NotificationCenter
                notifications={notifications}
                loading={notificationsLoading}
                onMarkRead={handleMarkRead}
                onDismiss={handleDismiss}
              />
            )}
            {activeTab === 'decisions' && (
              <DecisionQueue
                items={decisions}
                loading={decisionsLoading}
                onDecide={handleDecide}
              />
            )}
            {activeTab === 'digest' && (
              <DailyDigestCard
                digest={digest}
                loading={digestLoading}
                monthlyBudget={selectedAccount?.monthly_budget ?? 0}
                selectedDate={digestDate}
                onDateChange={setDigestDate}
              />
            )}
            {activeTab === 'insights' && (
              <>
                <HistoricalInsights
                  insights={insights}
                  insightsData={insightsData}
                  loading={insightsLoading}
                  generating={insightsGenerating}
                  onGenerate={handleGenerateInsights}
                  onDismissInsight={handleDismissInsight}
                />
                {/* Keyword Rehabilitation Section */}
                {rehabLoading ? (
                  <div className="mt-6 p-6 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl">
                    <p className="text-[var(--text-secondary)] text-sm">Loading rehabilitation data...</p>
                  </div>
                ) : rehabData.length > 0 && (
                  <div className="mt-6 p-6 bg-[var(--bg-card)] border border-[var(--border-primary)] rounded-xl">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
                      <Shield className="w-5 h-5 text-amber-400" />
                      Keyword Rehabilitation
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] mb-4">
                      Strategic industry keywords being rehabilitated instead of eliminated. Saffron cycles through tactics (new ad copy, match type changes, bid adjustments) before giving up on these valuable terms.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--border-primary)]">
                            <th className="text-left py-3 px-3 text-[var(--text-secondary)] font-medium">Keyword</th>
                            <th className="text-left py-3 px-3 text-[var(--text-secondary)] font-medium">Industry</th>
                            <th className="text-center py-3 px-3 text-[var(--text-secondary)] font-medium">Status</th>
                            <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Attempts</th>
                            <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Baseline CPA</th>
                            <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Current CPA</th>
                            <th className="text-right py-3 px-3 text-[var(--text-secondary)] font-medium">Best CPA</th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          {rehabData.map((r: any, i: number) => (
                            <tr key={r.id} className={`border-b border-[var(--border-primary)]/50 ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]/30' : ''}`}>
                              <td className="py-3 px-3 font-medium text-[var(--text-primary)]">{r.keyword_text}</td>
                              <td className="py-3 px-3 text-[var(--text-secondary)]">{r.industry_category || '—'}</td>
                              <td className="py-3 px-3 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                  r.status === 'improving' ? 'bg-emerald-500/20 text-emerald-400' :
                                  r.status === 'exhausted' ? 'bg-red-500/20 text-red-400' :
                                  r.status === 'stable' ? 'bg-blue-500/20 text-blue-400' :
                                  'bg-amber-500/20 text-amber-400'
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-right text-[var(--text-secondary)]">{r.total_attempts}</td>
                              <td className="py-3 px-3 text-right text-[var(--text-secondary)]">${(r.baseline_cpa || 0).toFixed(2)}</td>
                              <td className="py-3 px-3 text-right font-medium text-[var(--text-primary)]">${(r.current_cpa || 0).toFixed(2)}</td>
                              <td className="py-3 px-3 text-right text-emerald-400">${(r.best_cpa || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
            {activeTab === 'competitors' && (
              <CompetitorsPanel
                competitors={competitors}
                loading={competitorsLoading}
                onRefresh={fetchCompetitors}
              />
            )}
            {activeTab === 'revenue' && (
              <RevenuePanel
                data={revenueData}
                loading={revenueLoading}
                onSync={fetchRevenue}
              />
            )}
            {activeTab === 'changelog' && (
              <ChangeLog
                entries={changeLog}
                loading={changeLogLoading}
                totalCount={changeLogCount}
                page={changeLogPage}
                pageSize={changeLogPageSize}
                onPageChange={setChangeLogPage}
                actionTypeFilter={actionTypeFilter}
                onActionTypeFilterChange={v => { setActionTypeFilter(v); setChangeLogPage(1); }}
                outcomeFilter={outcomeFilter}
                onOutcomeFilterChange={v => { setOutcomeFilter(v); setChangeLogPage(1); }}
              />
            )}
            {activeTab === 'guardrails' && (
              <GuardrailConfig
                guardrails={guardrails}
                loading={guardrailsLoading}
                onToggle={handleGuardrailToggle}
                onUpdateThreshold={handleGuardrailThreshold}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
