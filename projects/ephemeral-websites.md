---
title: Ephemeral Websites
status: planning
priority: high
tags: [product, agents, clawvault, deliverables, enterprise]
created: 2026-02-18
---

# [[projects/ephemeral-websites|Ephemeral Websites]]

Agent-generated micro-sites that replace every static deliverable in business: slide decks, spreadsheets, internal reports, dashboards, proposals, onboarding docs, client updates. Not templates — living documents connected to dynamic data sources, spun up on demand, destroyed when done.

## Why This Matters

Every business runs on deliverables that are:
- **Static** — a PDF snapshot of data that was stale before it was exported
- **Disconnected** — copy-pasted from 5 different tools into a slide deck
- **Expensive** — hours of human formatting for something read once
- **Unsearchable** — trapped in email attachments and shared drives

[[projects/ephemeral-websites|Ephemeral websites]] flip all of this:
- **Dynamic** — pull live data from ClawVault, APIs, databases at render time
- **Connected** — one source of truth, always current
- **Instant** — agent generates it in seconds, not hours
- **Shareable** — a URL, not an attachment. Expires when you want it to.
- **Interactive** — drill down, filter, ask questions. Not a flat image.

## Core Concept

An agent deployed in a business (via [[projects/helios]]/OpenClaw) can:
1. Observe a need ("Pedro needs Q4 numbers for the board meeting")
2. Query ClawVault for relevant data, decisions, metrics, context
3. Generate an ephemeral website — styled, interactive, data-rich
4. Share a URL (Tailscale, public with auth, or local)
5. The site lives as long as needed, then self-destructs or archives to vault

## What It Replaces

| Old World | Ephemeral Website |
|-----------|------------------|
| Slide deck (30 min to build) | Generated in 5s, interactive, live data |
| Excel report (emailed as attachment) | URL with filters, drill-down, always current |
| Internal wiki page (outdated in a week) | Auto-refreshes from vault, expires when irrelevant |
| Client proposal (PDF, static) | Branded micro-site, personalized, trackable |
| Onboarding doc (stale after first edit) | Living checklist, progress-aware, adapts to new hire |
| Meeting recap (buried in Slack) | Shared URL with decisions, action items, linked to vault |
| Dashboard (requires BI tool license) | Agent-generated, no setup, pulls from any source |

## Architecture

### Primitives (ClawVault layer)

```
clawvault site create --template report --data "Q4 metrics" --ttl 7d
clawvault site list
clawvault site update <id> --refresh
clawvault site share <id> --auth token
clawvault site archive <id>
clawvault site destroy <id>
```

- **Site manifest** — YAML defining layout, data sources, refresh policy, auth, TTL
- **Data bindings** — connect sections to ClawVault queries, graph traversals, or external APIs
- **Templates** — report, dashboard, proposal, recap, checklist, comparison, timeline
- **Render engine** — server-side HTML generation (no JS framework dependency)
- **Auth** — token-based, Tailscale identity, or public with expiry
- **TTL** — auto-destroy after N days, or on explicit archive

### Skill (OpenClaw layer)

An OpenClaw skill that any agent can use:
- `ephemeral-site create` — generate from natural language or structured data
- `ephemeral-site update` — refresh data, modify layout
- `ephemeral-site share` — generate shareable URL
- Integrates with Canvas for preview before sharing
- Hooks into ClawVault observations — "site X was viewed 12 times, archived"

### Serving

Options (in order of simplicity):
1. **Canvas** — OpenClaw's built-in canvas for single-user preview
2. **Local HTTP** — `clawvault site serve` on a port, Tailscale for team access
3. **Vercel/Cloudflare** — deploy as static site with edge functions for data refresh
4. **S3 + CloudFront** — cheapest for high-volume, auth via signed URLs

### Data Flow

```
Agent observes need
  → Queries ClawVault (memory, graph, tasks, decisions)
  → Pulls external data (APIs, databases, CRMs)
  → Renders site from template + data bindings
  → Serves URL with auth + TTL
  → Tracks views/engagement in vault observations
  → Archives or destroys on expiry
```

## Differentiation

- **Not Notion/Coda** — those are general-purpose docs. These are agent-generated, purpose-built, ephemeral.
- **Not BI dashboards** — no setup, no data modeling, no licenses. Agent figures it out.
- **Not static site generators** — data bindings are live. Site refreshes from source.
- **ClawVault-native** — memory graph, observations, decisions all queryable as data sources. The agent's knowledge IS the content.

## Phase Plan

### Phase 0: Canvas MVP (now)
- Use OpenClaw Canvas to render HTML from agent
- Agent generates HTML+CSS inline, presents via canvas
- No persistence, no sharing, no data bindings
- Proves the concept: "agent makes a web page from vault data"

### Phase 1: Site Primitives
- `clawvault site create/list/serve/destroy`
- Site manifest format (YAML + HTML template)
- Local HTTP serving with Tailscale
- 3 templates: report, dashboard, recap
- ClawVault data bindings (query results → template variables)

### Phase 2: Skill + Templates
- OpenClaw skill for any agent to use
- Template library (10+ templates)
- Natural language → site generation
- Auto-refresh on data change
- Auth (token + Tailscale identity)

### Phase 3: Enterprise
- Multi-org deployment via HELIOS
- Branded templates per org
- Audit trail (who viewed, when, from where)
- Compliance (auto-archive, retention policies)
- External data connectors (Salesforce, HubSpot, Postgres, etc.)

## Open Questions

- Render engine: Mustache/Handlebars (simple) vs MDX (powerful) vs raw HTML (maximum control)?
- Should sites be git-tracked in the vault or separate?
- How to handle sites that need real-time data (WebSocket vs polling vs SSR)?
- Pricing model: per-site, per-view, flat rate?

## Success Metrics

- Time to deliverable: hours → seconds
- Deliverable freshness: stale on creation → live data
- Deliverable reach: email attachment → shareable URL
- Agent autonomy: human builds → agent builds, human reviews
