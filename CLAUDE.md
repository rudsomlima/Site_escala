# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install deps
npm run dev          # dev server on port 3100 (fixed in package.json, not the Next.js default 3000)
npm run build        # production build — also type-checks (no separate lint/test scripts exist)
npm run start        # serve a production build
npx tsc --noEmit      # type-check only, without touching .next — prefer this over `npm run build`
                       # while a dev server may be running, since both share the same .next
                       # directory and `next build` will corrupt a concurrently-running `next dev`'s
                       # cache (manifests as random 500s until the dev server is restarted).
```

There is no test suite and no standalone lint command.

## What this app is

A mobile-first weekly shift schedule (Monday–Sunday) for organizing hospital companion/caregiver
rotations, replacing a manual WhatsApp message format. Single page app at [app/page.tsx](app/page.tsx) → [components/ScheduleApp.tsx](components/ScheduleApp.tsx).

## Architecture

**Data flow**: each week is a standalone record keyed by its Monday's ISO date (`YYYY-MM-DD`),
fetched/saved through `/api/weeks/[week]`. Going to a different week ([components/ScheduleApp.tsx](components/ScheduleApp.tsx) `goWeek`)
just changes the key — history is implicit since old weeks are never overwritten, only the active
key changes. The client also fetches the *previous* week (key - 7 days) to read its Sunday Noite
entries for cross-week gap detection, and can write back to it directly (see "já coberto desde
domingo" below).

**Storage** ([lib/store.ts](lib/store.ts)): three backends, checked in priority order.
- If `KV_REST_API_URL`/`KV_REST_API_TOKEN` env vars are set, uses Upstash Redis (`@upstash/redis`,
  `Redis.fromEnv()`) — what a Vercel KV/Upstash integration provisions. Per-key storage.
- Else if `BLOB_READ_WRITE_TOKEN` is set, uses Vercel Blob (`@vercel/blob`) — the whole store is one
  JSON object read/written wholesale at `escala/weeks.json` (`get`/`put`, `access: 'private'`,
  `allowOverwrite: true`, token passed explicitly rather than relying on `@vercel/blob`'s
  OIDC-vs-token auto-detection, which can pick OIDC and fail in environments where it isn't
  enabled for the store). This is what a Vercel Blob store provisions, and is the recommended
  production setup (no DB needed).
- Otherwise falls back to a local JSON file at `.data/weeks.json`. This fallback is dev-only:
  Vercel's filesystem is ephemeral, so without KV or Blob env vars production silently loses data on
  every cold start/deploy. See [README.md](README.md) for the Vercel Blob setup steps.
- Because every write to the file/Blob backends is a whole-document read-modify-write with no
  locking, firing two writes to *different* keys back-to-back (e.g. saving a week and updating a
  global setting in the same action) can race and silently lose one of them. When an action needs
  to write more than one key, sequence the writes — `scheduleSave`'s `onSaved` callback in
  [components/ScheduleApp.tsx](components/ScheduleApp.tsx) exists for exactly this (see `saveWeekShiftRate`).
- Same three-way pattern is used for settings (`settings:companions`, `settings:shiftRate`),
  exposed together through `/api/settings`.

**Schedule model & gap logic** ([lib/schedule.ts](lib/schedule.ts)) — the core domain logic, everything else is UI:
- A `Week` is 7 `Day`s, each `Day` has 3 `ShiftLabel`s (`'Manhã' | 'Tarde' | 'Noite'`), each shift is
  a list of `Entry { who, start, end, spilloverOf? }`. A `Week` also has an optional own `shiftRate`
  (see Payments below).
- `SHIFT_WINDOWS` defines each shift's expected coverage in minutes-from-midnight: Manhã 0–13h,
  Tarde 13–18h, Noite 18h–08h *next day* (`32*60`). `clipToWindow` is what makes an entry's clock
  time count toward a window even when crossing midnight — it tries the time both as given and
  shifted +24h, whichever actually overlaps, so a fragment like a standalone `00:00`–`08:00` entry
  (not part of one continuous `20:00`→`08:00` entry) still counts as Noite coverage instead of being
  silently dropped for not overlapping `[winStart, winEnd)` as-is.
- **Gap detection pulls from every shift, not just its own**: `gapsForDayShift` flattens *all* of a
  day's shifts (minus any `spilloverOf`-tagged entries) before computing gaps for one label —
  `clipToWindow` naturally discards whatever doesn't overlap, so this safely lets an entry stored
  under one shift (e.g. Manhã extended to 20:00) count as coverage for another (Tarde/Noite) even if
  its visual spillover row is missing or stale.
- **Cross-week Manhã coverage**: for `'Manhã'` specifically, gaps also subtract the *previous* day's
  Noite entries that cross midnight (`overnightFromPrev` inside `findGaps`). For Monday, "previous
  day" is Sunday of the *prior week*, a different `Week` record — `prevWeekSundayNoite` is threaded
  through wherever gaps/completeness are computed (`gapsForDayShift`, `dayIsComplete`,
  `weekToWhatsApp`, `weekPayments` all accept or imply it). When extending gap logic, remember a
  day's coverage is never self-contained — check whether a change needs the cross-shift/cross-day/
  cross-week angle threaded through too. If the previous week has no Sunday Noite data at all (never
  filled in, or no prior week exists), Monday's UI offers an extra "🌙 Já coberto desde domingo"
  badge that writes a same-default entry directly into the previous week (capped at 08:00, since
  that's the most a Noite-window entry can ever be credited for).
- **Spillover** (`applySpillover`): when an entry's time extends past its own shift's window into
  another shift *on the same day*, this writes a mirror entry (deterministic id
  `${originId}-spill-${label}`, tagged `spilloverOf: originId`) into the other shift(s) purely so the
  name is visible there too. It's re-derived from scratch on every edit of the source entry (so
  shrinking/growing/deleting the source keeps the spillover in sync), and is **not** the source of
  truth for gap coverage — that's handled independently by `gapsForDayShift` as above. Doesn't cross
  day boundaries (a Noite shift spilling into tomorrow's Manhã is the cross-week case above, not this).
- `mergeContiguous` collapses same-person entries whose times tile exactly (one's `end` equals the
  next's `start`) into one block, with `mergedIds` listing every original id folded in. Used for
  display (the day card list, the WhatsApp text) and for `weekPayments`'s plantão/hour counting —
  in both cases it's fed entries from *all* shifts of a day at once so a duty spanning shift
  boundaries (e.g. Manhã into Tarde) is treated as one continuous block, not two.
- `gapStops` produces hour-aligned tap targets within a `Gap` so the UI never requires typing a
  time. In `components/ScheduleApp.tsx`, normal mode also overlays a +/-10min stepper
  (`StepperBadge`) next to the hour badges; "hora fechada" mode (`exactHoursOnly`, persisted to
  `localStorage`) hides the stepper and widens the badge set to every uncovered hour across the
  *whole day* (`dayWideStops`, not just the tapped gap's own shift) since reaching into an adjacent
  shift to trigger spillover would otherwise be impossible without the stepper.
- `weekToWhatsApp` regenerates the original manual message format, including the "continues across
  shifts" phrasing (e.g. "até às 17:00" instead of repeating the full range) by detecting when the
  same `who` has an adjacent merged entry whose start/end touches this one.

**Payments** (`weekPayments` in [lib/schedule.ts](lib/schedule.ts), Pagamentos modal in
[components/ScheduleApp.tsx](components/ScheduleApp.tsx)): computes hours worked, plantão (duty
block) count, and amount owed per person for a week, at a R$-per-12h `shiftRate`
(`DEFAULT_SHIFT_RATE = 110`). Only counts non-`spilloverOf` entries, merged across the whole day via
`mergeContiguous` to avoid double-counting and to keep cross-shift duties as one plantão. A `Week`
can pin its own `shiftRate`; until edited it falls back to the global default from
`settings:shiftRate`, and editing it from a given week's modal updates both that week's pinned value
and the global default (so untouched weeks pick up the new default, but already-edited weeks keep
their historical rate) — see `saveWeekShiftRate`.

**Companions list**: the set of names suggested when assigning an entry is *not* free text — it's
config-managed (`/api/settings`, persisted alongside the shift rate) and is the only source of names
offered when tapping an entry to assign/reassign it. There is intentionally no free-text name input
on the schedule itself. Reachable via the "⚙️ Configurações" hub at the bottom of the page, which is
also where the Pagamentos modal is opened from.

**Seeding**: `SEED_WEEK_KEY` (`'2026-06-22'`) is the one week that returns pre-filled `seedWeek()` data
instead of an empty template when not yet saved — it mirrors the original WhatsApp message this app
replaced. Every other week starts empty via `emptyWeek()`.
