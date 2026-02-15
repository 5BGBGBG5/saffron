# Saffron — Your Google Ads Co-Pilot

Saffron is an AI agent that watches your Google Ads account around the clock and recommends changes for you to approve or reject.

## What it does

Every morning, Saffron pulls fresh data from Google Ads — campaign spend, keyword performance, ad click-through rates, conversions — and runs it through a set of safety checks and an AI analysis. It looks for things like CPC spikes, underperforming ads, budget imbalances, and keyword opportunities. If it finds something worth acting on, it creates a recommendation and puts it in your queue.

On Sundays, Saffron goes deeper. It analyzes auction competition, reviews landing page alignment, scans competitor ad copy via search results, generates new ad copy for underperforming ad groups, proposes budget reallocations across campaigns, rehabilitates expensive-but-strategic keywords, and syncs with HubSpot to check which campaigns actually drive closed deals.

## What it can recommend

Budget adjustments, budget reallocations between campaigns, bid changes on keywords, adding or removing keywords, creating new ad copy, pausing underperforming ads, replacing an ad with new copy (creates the new one, then pauses the old one in a single step), and enabling or pausing campaigns.

## Nothing happens without your approval

Every recommendation sits in the Decision Queue as "pending" until you approve or reject it. Saffron never touches Google Ads on its own. When you approve, it executes the change immediately. When you reject, it learns from that for future recommendations. Pending items expire after 72 hours if you don't act on them.

## Built-in safety guardrails

No campaign budget drops below $25/day. Brand and non-brand campaigns can't swap budget with each other. Campaigns with new ads get a 14-day protection window before budget can be moved away. No single reallocation moves more than 25% of a campaign's budget. Bid changes are capped at 20% per adjustment. Campaigns with recent conversions can't be paused. If there isn't enough click data yet, Saffron holds off on optimization recommendations entirely.

## How to use it

Open the Saffron dashboard. The Decision Queue tab shows pending recommendations — each one explains what it wants to do and why, with the actual numbers behind the suggestion. Read the reason, then hit approve or reject. The Change Log tab shows everything that's happened. The Notifications tab flags anomalies like CPC spikes or budget pacing alerts. Hit the Recommend button anytime to trigger a fresh analysis on demand.
