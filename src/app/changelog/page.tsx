import { CHANGELOG_ENTRIES, ChangeType } from '@/lib/changelog-data';
import Link from 'next/link';

const typeBadge: Record<ChangeType, { label: string; bg: string; text: string }> = {
  feature: { label: 'Feature', bg: 'bg-emerald-500/15 border-emerald-500/30', text: 'text-emerald-400' },
  fix: { label: 'Fix', bg: 'bg-amber-500/15 border-amber-500/30', text: 'text-amber-400' },
  improvement: { label: 'Improvement', bg: 'bg-cyan-500/15 border-cyan-500/30', text: 'text-cyan-400' },
};

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ChangelogPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 opacity-30 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-500/20 via-emerald-500/10 to-teal-600/20" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-teal-400/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-10">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)] hover:text-[var(--accent-primary)] mb-4"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-teal-200 to-emerald-200 bg-clip-text text-transparent">
            Changelog
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            What&apos;s new in Saffron
          </p>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[7px] top-2 bottom-2 w-px bg-[var(--border-primary)]" />

          <div className="space-y-8">
            {CHANGELOG_ENTRIES.map((entry, i) => {
              const badge = typeBadge[entry.type];
              return (
                <div key={i} className="relative pl-8">
                  {/* Dot */}
                  <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-[var(--border-primary)] bg-[var(--background-primary)]">
                    <div className={`absolute inset-[3px] rounded-full ${
                      entry.type === 'feature' ? 'bg-emerald-400' :
                      entry.type === 'fix' ? 'bg-amber-400' : 'bg-cyan-400'
                    }`} />
                  </div>

                  <div className="glass-card p-5 !rounded-xl">
                    <div className="flex items-center gap-3 mb-2">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${badge.bg} ${badge.text}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">
                        {formatDate(entry.date)}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                      {entry.title}
                    </h3>
                    <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                      {entry.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
