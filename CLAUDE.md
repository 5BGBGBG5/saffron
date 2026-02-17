# Saffron — SALT Crew PPC management agent for Google Ads

## Stack
Next.js (App Router) + Vercel + Supabase (AiEO project) + @anthropic-ai/sdk + Google Ads API + HubSpot API + SerpAPI

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/health` | GET | Health check — returns `{ status, agent, timestamp }` |
| `/api/status` | GET | Agent status — returns last run, active proposals, status |
| `/api/trigger` | POST | Manual trigger — runs the main analysis on demand |
| `/api/ads-agent/run` | POST/GET | Daily cron — Layer 1 guardrails + Layer 2 Claude analysis |
| `/api/ads-agent/digest` | POST/GET | Daily cron — generates narrative daily summary |
| `/api/ads-agent/weekly` | POST/GET | Sunday orchestrator — auction insights, budget reallocation, landing pages, competitor ad scan (SerpAPI), RSA generation (with competitor context), keyword rehabilitation, HubSpot sync |
| `/api/ads-agent/insights` | GET/POST | GET returns stored insights; POST triggers 365-day historical analysis |
| `/api/ads-agent/decide` | POST | Executes approved/rejected proposals against Google Ads API |
| `/api/ads-agent/hubspot-sync` | GET/POST | HubSpot deal sync + conversion quality scoring |

## Database Tables (AiEO Supabase project: zqvyaxexfbgyvebfnudz)

- `ads_agent_accounts` — Active Google Ads account configs
- `ads_agent_guardrails` — Safety rules (budget caps, CPC spike alerts, etc.)
- `ads_agent_decision_queue` — Pending proposals for human approval (includes `agent_loop_iterations`, `agent_loop_tools_used`, `agent_investigation_summary` columns)
- `ads_agent_notifications` — Alerts and messages
- `ads_agent_change_log` — Historical record of all actions (action_types include `agent_investigation`)
- `ads_agent_daily_digest` — End-of-day summaries
- `ads_agent_historical_insights` — AI-generated insights from analysis
- `ads_agent_auction_insights` — Competitor auction data
- `ads_agent_rehabilitation_log` — Strategic keyword recovery tracking
- `ads_agent_hubspot_deals` — HubSpot deals mapped to campaigns
- `ads_agent_competitor_ads` — Raw competitor ad copy captured via SerpAPI
- `ads_agent_competitor_intel` — Weekly competitor messaging analysis summaries

## Agent Loop

Saffron uses a two-layer analysis pattern. Layer 1 is deterministic guardrail checks. Layer 2 is a Claude tool-use agent loop that investigates recommendations before submission.

**Files:** `src/lib/google-ads/agent-loop.ts` (orchestration), `src/lib/google-ads/agent-tools.ts` (tool definitions)

**Fallback:** `runLayer2Legacy()` exists as a non-agent-loop fallback.

### Tools

| Tool | Purpose |
|------|---------|
| `check_signal_bus` | Read cross-agent signals (Cayenne Reddit intelligence) |
| `get_historical_performance` | Pull historical metrics for context |
| `check_reallocation_impact` | Model budget reallocation scenarios |
| `evaluate_recommendation` | Validate recommendation against guardrails |
| `submit_recommendations` | **Terminal** — submit recommendations |
| `skip_recommendations` | **Terminal** — skip with reason |

**Budget:** Max 5 tool calls, max 30 seconds per iteration.

**Logging:** Each iteration logs an `agent_investigation` entry to `ads_agent_change_log` with full tool call history in the `data_used` JSONB column.

## Cron Schedule

| Schedule | Route | Description |
|----------|-------|-------------|
| `0 10 * * *` | `/api/ads-agent/run` | Daily 10 AM UTC — main analysis |
| `0 23 * * *` | `/api/ads-agent/digest` | Daily 11 PM UTC — daily digest |
| Sundays | `/api/ads-agent/weekly` | Triggered by run route on Sundays |

## Standard Endpoints

- `GET /api/health` — Always returns `{ status: "healthy", agent: "saffron" }`
- `GET /api/status` — Returns `{ agent, lastRun, lastAction, activeProposals, status }`
- `POST /api/trigger` — Manually triggers the main analysis run

## Signal Bus Events

Saffron writes to the `shared_agent_signals` table (with try/catch — fails silently if table doesn't exist):

| Event Type | Trigger | Payload |
|-----------|---------|---------|
| `high_cpc_alert` | CPC spike detected above threshold | keyword, currentCpc, avgCpc7Day, pctChange |
| `budget_pace_warning` | Daily spend exceeds pacing threshold | accountId, pctUsed, dailyCap, threshold |
| `proposal_executed` | Approved change applied via Google Ads API | decisionId, actionType, actionSummary, accountId |
| `weekly_report_complete` | Sunday orchestrator finishes | accounts count, timestamp |
| `trending_search_term` | High-volume converting search term found | term, conversions, cost |
| `competitor_ad_scan_complete` | Weekly competitor ad scan finishes | accountId, keywords, ads, competitors |

### Consumes

Saffron's agent loop consumes Cayenne signals via `check_signal_bus`:

| Signal | From | Purpose |
|--------|------|---------|
| `reddit_trending_topic` | Cayenne | Inform PPC strategy with trending Reddit topics |
| `reddit_pain_point_cluster` | Cayenne | Surface organic pain points for ad targeting |
| `reddit_competitor_mention` | Cayenne | Factor competitor Reddit activity into recommendations |

## Key Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Notes

- This agent is part of the SALT Crew network. See salt-crew-core/ARCHITECTURE.md for shared SALT Crew conventions.
- Saffron reads/writes to the same AiEO Supabase project as the SALT monorepo — no separate database.
- Environment variables are listed in `.env.example` with descriptions.
