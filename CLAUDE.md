# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install      # install deps
npm run dev       # dev server (port 3000, auto-bumps if taken)
npm run build     # production build — also type-checks (no separate lint/test scripts exist)
npm run start     # serve a production build
```

There is no test suite and no standalone lint command — `npm run build` is the only verification step (it runs `tsc` type-checking as part of `next build`).

## What this app is

A mobile-first weekly shift schedule (Monday–Sunday) for organizing hospital companion/caregiver
rotations, replacing a manual WhatsApp message format. Single page app at [app/page.tsx](app/page.tsx) → [components/ScheduleApp.tsx](components/ScheduleApp.tsx).

## Architecture

**Data flow**: each week is a standalone record keyed by its Monday's ISO date (`YYYY-MM-DD`),
fetched/saved through `/api/weeks/[week]`. Going to a different week ([components/ScheduleApp.tsx](components/ScheduleApp.tsx) `goWeek`)
just changes the key — history is implicit since old weeks are never overwritten, only the active
key changes. The client also fetches the *previous* week (key - 7 days) purely to read its Sunday
Noite entries for cross-week gap detection (see below).

**Storage** ([lib/store.ts](lib/store.ts)): three backends, checked in priority order.
- If `KV_REST_API_URL`/`KV_REST_API_TOKEN` env vars are set, uses Upstash Redis (`@upstash/redis`,
  `Redis.fromEnv()`) — what a Vercel KV/Upstash integration provisions. Per-key storage.
- Else if `BLOB_READ_WRITE_TOKEN` is set, uses Vercel Blob (`@vercel/blob`) — the whole store is one
  JSON object read/written wholesale at `escala/weeks.json` (`put`/`head`+`fetch`, `allowOverwrite: true`).
  This is what a Vercel Blob store provisions, and is the recommended production setup (no DB needed).
- Otherwise falls back to a local JSON file at `.data/weeks.json`. This fallback is dev-only:
  Vercel's filesystem is ephemeral, so without KV or Blob env vars production silently loses data on
  every cold start/deploy. See [README.md](README.md) for the Vercel Blob setup steps.
- Same three-way pattern is used for the companions/settings list (key `settings:companions`).

**Schedule model & gap logic** ([lib/schedule.ts](lib/schedule.ts)) — the core domain logic, everything else is UI:
- A `Week` is 7 `Day`s, each `Day` has 3 `ShiftLabel`s (`'Manhã' | 'Tarde' | 'Noite'`), each shift is
  a list of `Entry { who, start, end }`.
- `SHIFT_WINDOWS` defines each shift's expected coverage in minutes-from-midnight. Noite's window
  extends to `32*60` (i.e. past midnight, until 08:00 next day) — this is what lets a Noite entry's
  `end` be a clock time *earlier* than its `start` (e.g. `20:00`→`08:00`) and still be interpreted
  as crossing midnight (`normEnd`/`toMin`).
- **Gap detection is cross-day by design**: `gapsForDayShift`/`findGaps` compute uncovered minutes
  for a shift, and for `'Manhã'` specifically also subtract the *previous* day's Noite entries that
  cross midnight into today (`overnightFromPrev`). For Monday, "previous day" is Sunday of the
  *prior week*, which lives in a different `Week` record — that's why the previous week must be
  fetched separately and threaded through as `prevWeekSundayNoite` wherever gaps/completeness are
  computed (`gapsForDayShift`, `dayIsComplete`, `weekToWhatsApp` all accept it as an optional last arg).
  When extending gap logic, remember a day's coverage is never self-contained — always check whether
  a change needs the cross-day/cross-week parameter threaded through too.
- `gapStops`/`hoursAfter`-style helpers produce hour-aligned tap targets so the UI never requires
  typing a time — instead it's an explicit two-step "pick start → pick end" badge flow (see
  `timeStep` state in [components/ScheduleApp.tsx](components/ScheduleApp.tsx) for new entries, `editTime` state for editing an
  existing entry's time).
- `weekToWhatsApp` regenerates the original manual message format, including the "continues across
  shifts" phrasing (e.g. "até às 17:00" instead of repeating the full range) by detecting when the
  same `who` has an adjacent entry whose start/end touches this one.

**Companions list**: the set of names suggested when assigning an entry is *not* free text — it's
config-managed via the 👥 header button (`/api/settings`, persisted alongside weeks) and is the only
source of names offered when tapping an entry to assign/reassign it. There is intentionally no free-text
name input on the schedule itself.

**Seeding**: `SEED_WEEK_KEY` (`'2026-06-22'`) is the one week that returns pre-filled `seedWeek()` data
instead of an empty template when not yet saved — it mirrors the original WhatsApp message this app
replaced. Every other week starts empty via `emptyWeek()`.
