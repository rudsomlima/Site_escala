// spilloverOf: set on entries auto-created by applySpillover — marks this entry as the
// portion of another shift's entry that spilled into this shift's window, so it can be
// recomputed (replaced) instead of duplicated whenever the source entry changes.
export type Entry = { id: string; who: string; start: string; end: string; spilloverOf?: string };
export type ShiftLabel = 'Manhã' | 'Tarde' | 'Noite';
export type Day = { shifts: Record<ShiftLabel, Entry[]> };
// shiftRate: this week's own R$/12h payment rate, snapshotted the first time it's edited
// from inside the Payments modal. Weeks without it fall back to the global default
// (settings:shiftRate) so changing the default only affects weeks that haven't been
// individually edited yet — already-pinned weeks keep their historical value.
export type Week = { weekStart: string; days: Day[]; shiftRate?: number };

export const SHIFT_LABELS: ShiftLabel[] = ['Manhã', 'Tarde', 'Noite'];
export const DAY_NAMES = ['SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO', 'DOMINGO'];

// Shift windows in minutes from 00:00. A shift starting after 0h is Manhã, after 13h is
// Tarde, after 18h is Noite. Noite extends past midnight (until 08:00 next day = 32:00).
export const SHIFT_WINDOWS: Record<ShiftLabel, [number, number]> = {
  'Manhã': [0, 13 * 60],
  'Tarde': [13 * 60, 18 * 60],
  'Noite': [18 * 60, 32 * 60],
};

export const FREQUENT_NAMES = [
  'Marilene', 'Betinho', 'Renata', 'Giz', 'Gizlene', 'Técnica Josi', 'Adriane', 'Rudsom',
];

export function mondayOf(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fmtBR(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function emptyWeek(weekStartIso: string): Week {
  const days: Day[] = Array.from({ length: 7 }, () => ({
    shifts: { 'Manhã': [], 'Tarde': [], 'Noite': [] },
  }));
  return { weekStart: weekStartIso, days };
}

export function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function fmtMin(min: number): string {
  const m = ((min % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export const DAY_MIN = 24 * 60;
export const DEFAULT_SHIFT_RATE = 110;

// Clips a clock-time entry [s0, e0) to a shift window, trying it both as given and — for
// windows that extend past midnight, like Noite — as if its clock times were "after
// midnight" (+24h), whichever actually overlaps the window. This is what lets a fragment
// like 00:00–08:00 stored as its own entry (rather than as part of one continuous
// 20:00–08:00 entry, e.g. when filled in two separate taps that happened to land on
// either side of midnight) still count as covering the small-hours part of an overnight
// shift, instead of being silently dropped for not overlapping [winStart, winEnd) as-is.
function clipToWindow(s0: number, e0: number, winStart: number, winEnd: number): [number, number] | null {
  const aEnd = e0 <= s0 ? e0 + DAY_MIN : e0;
  const candidates: [number, number][] = [[s0, aEnd]];
  if (winEnd > DAY_MIN) candidates.push([s0 + DAY_MIN, aEnd + DAY_MIN]);
  for (const [s, e] of candidates) {
    const cs = Math.max(s, winStart);
    const ce = Math.min(e, winEnd);
    if (ce > cs) return [cs, ce];
  }
  return null;
}

export type Gap = { start: number; end: number };

// overnightFromPrev: the previous day's Noite entries, used so a Manhã gap that's
// already covered by yesterday's overnight shift isn't flagged as missing.
export function findGaps(entries: Entry[], label: ShiftLabel, overnightFromPrev?: Entry[]): Gap[] {
  const [winStart, winEnd] = SHIFT_WINDOWS[label];
  const intervals: [number, number][] = entries
    .filter((e) => e.start && e.end)
    .map((e) => clipToWindow(toMin(e.start), toMin(e.end), winStart, winEnd))
    .filter((iv): iv is [number, number] => iv !== null);

  if (overnightFromPrev) {
    const [noiteStart, noiteEnd] = SHIFT_WINDOWS['Noite'];
    for (const e of overnightFromPrev) {
      if (!e.start || !e.end) continue;
      const iv = clipToWindow(toMin(e.start), toMin(e.end), noiteStart, noiteEnd);
      if (!iv || iv[1] <= DAY_MIN) continue;
      // The portion of yesterday's Noite window past midnight, remapped to today's clock.
      const clippedEnd = Math.min(iv[1] - DAY_MIN, winEnd);
      if (clippedEnd > winStart) intervals.push([winStart, clippedEnd]);
    }
  }

  intervals.sort((a, b) => a[0] - b[0]);
  const free: Gap[] = [];
  let cursor = winStart;
  for (const [s, e] of intervals) {
    if (s > cursor) free.push({ start: cursor, end: s });
    cursor = Math.max(cursor, e);
  }
  if (cursor < winEnd) free.push({ start: cursor, end: winEnd });

  return free.filter((g) => g.end > g.start);
}

export type MergedEntry = Entry & { mergedIds: string[] };

// Collapses entries by the same person whose times tile exactly (one's end equals the
// next's start) into a single entry spanning the whole block — e.g. two taps that filled
// 18:00–19:00 and 19:00–00:00 separately become one 18:00–00:00 entry for display.
// mergedIds lists every original entry id folded into each block, so callers that need to
// act on the underlying data (deleting, or persisting an edit) can do so for all of them.
export function mergeContiguous(entries: Entry[]): MergedEntry[] {
  const withTime = entries.filter((e) => e.who && e.start && e.end);
  const withoutTime = entries.filter((e) => !(e.who && e.start && e.end));
  const consumed = new Set<string>();
  const blocks: MergedEntry[] = [];

  for (const e of withTime) {
    if (consumed.has(e.id)) continue;
    const hasPred = withTime.some((o) => o.id !== e.id && o.who === e.who && o.end === e.start && !consumed.has(o.id));
    if (hasPred) continue;
    consumed.add(e.id);
    let cur = e;
    const mergedIds = [e.id];
    while (true) {
      const next = withTime.find((o) => !consumed.has(o.id) && o.who === cur.who && o.start === cur.end);
      if (!next) break;
      consumed.add(next.id);
      mergedIds.push(next.id);
      cur = next;
    }
    blocks.push({ ...e, end: cur.end, mergedIds });
  }

  blocks.sort((a, b) => toMin(a.start) - toMin(b.start));
  return [...blocks, ...withoutTime.map((e) => ({ ...e, mergedIds: [e.id] }))];
}

// When an entry's time extends past its own shift's window into another shift on the same
// day (e.g. a Manhã entry edited to end at 20:00 also covers all of Tarde and the early
// part of Noite), the other shift(s) need their own entry for that person too, or they'll
// keep showing as "falta cobrir" despite being covered. This both creates that coverage and
// keeps it in sync: it first removes any entries this same source previously spilled into
// other shifts (spilloverOf === originId), then re-adds fresh ones for the current range —
// so shrinking the source's time removes coverage it no longer implies, and growing it adds
// more, without ever duplicating across repeated edits of the same entry.
// Only covers spillover within the same calendar day — a Noite entry crossing into the next
// day's Manhã is handled separately by the existing overnightFromPrev gap logic.
export function applySpillover(day: Day, originId: string, originLabel: ShiftLabel, who: string, startMin: number, endMin: number): void {
  for (const label of SHIFT_LABELS) {
    day.shifts[label] = day.shifts[label].filter((e) => e.spilloverOf !== originId);
  }
  if (!who) return;
  const normEnd = endMin <= startMin ? endMin + DAY_MIN : endMin;
  for (const label of SHIFT_LABELS) {
    if (label === originLabel) continue;
    const [winStart, winEnd] = SHIFT_WINDOWS[label];
    const overlapStart = Math.max(startMin, winStart);
    const overlapEnd = Math.min(normEnd, winEnd);
    if (overlapEnd > overlapStart) {
      day.shifts[label].push({
        id: `${originId}-spill-${label}`,
        who,
        start: fmtMin(overlapStart),
        end: fmtMin(overlapEnd),
        spilloverOf: originId,
      });
    }
  }
}

export type PaymentBlock = { dayIdx: number; date: string; start: string; end: string; hours: number; amount: number };
export type PaymentSummary = { who: string; hours: number; shifts: number; amount: number; blocks: PaymentBlock[] };

// Hours, duty-block ("plantão") count, and amount owed per person for the week, at
// `shiftRate` reais per 12h worked. Only counts each person's own entries — spillover rows
// (spilloverOf set) are just a visual echo of time already counted in the origin entry, so
// including them would double-count hours. mergeContiguous is reused across the whole day
// (not per shift) so a duty that crosses shift boundaries (e.g. Manhã into Tarde) is one
// plantão, not two — same logic applySpillover relies on, just without writing anything.
// Cross-day duties (e.g. a Noite shift spilling into the next day) aren't merged across
// days; each day's entries are counted independently, matching applySpillover's same-day-only scope.
export function weekPayments(week: Week, shiftRate: number): PaymentSummary[] {
  const monday = parseIso(week.weekStart);
  const totals = new Map<string, { minutes: number; blocks: PaymentBlock[] }>();
  week.days.forEach((day, dayIdx) => {
    const dayEntries = SHIFT_LABELS.flatMap((l) => day.shifts[l]).filter((e) => !e.spilloverOf);
    for (const block of mergeContiguous(dayEntries)) {
      if (!block.who || !block.start || !block.end) continue;
      const s = toMin(block.start);
      const e = toMin(block.end);
      const minutes = e <= s ? e + DAY_MIN - s : e - s;
      const cur = totals.get(block.who) ?? { minutes: 0, blocks: [] };
      cur.minutes += minutes;
      cur.blocks.push({
        dayIdx,
        date: fmtBR(addDays(monday, dayIdx)),
        start: block.start,
        end: block.end,
        hours: minutes / 60,
        amount: (minutes / 60 / 12) * shiftRate,
      });
      totals.set(block.who, cur);
    }
  });
  return Array.from(totals.entries())
    .map(([who, { minutes, blocks }]) => ({
      who,
      hours: minutes / 60,
      shifts: blocks.length,
      amount: (minutes / 60 / 12) * shiftRate,
      blocks,
    }))
    .sort((a, b) => a.who.localeCompare(b.who));
}

// prevWeekSundayNoite: the previous week's Sunday Noite entries, used so Monday's Manhã
// gap calc also considers a shift that started the week before.
// excludeEntryIds: drop these entries from the calculation — used when editing an entry's
// (possibly merged) own time, so its current slot (merged with any adjacent gaps) shows up
// as available again.
export function gapsForDayShift(
  days: Day[],
  dayIdx: number,
  label: ShiftLabel,
  prevWeekSundayNoite?: Entry[],
  excludeEntryIds?: string[],
): Gap[] {
  // Pull in every shift's entries for the day, not just this one's own array — an entry
  // stored under Manhã/Tarde that runs into the next shift's window should count as
  // coverage there even if its visual spillover row (applySpillover) is missing or stale
  // (e.g. legacy data from before that feature existed). clipToWindow already drops
  // entries that don't actually overlap the target window, so this is safe — entries
  // already tagged spilloverOf are excluded here since their origin is already considered.
  const day = days[dayIdx];
  const entries = SHIFT_LABELS.flatMap((l) => day.shifts[l]).filter(
    (e) => !e.spilloverOf && !excludeEntryIds?.includes(e.id),
  );
  const overnightFromPrev =
    label === 'Manhã'
      ? dayIdx > 0
        ? days[dayIdx - 1].shifts['Noite'].filter((e) => !e.spilloverOf)
        : prevWeekSundayNoite
      : undefined;
  return findGaps(entries, label, overnightFromPrev);
}

// Hour-aligned stops across a gap, e.g. a 18:00–22:00 gap becomes
// [18:00, 19:00, 20:00, 21:00, 22:00] — tap a start stop, then an end stop after it.
export function gapStops(gap: Gap): number[] {
  const stops: number[] = [];
  let cur = gap.start;
  while (cur < gap.end) {
    stops.push(cur);
    cur = Math.min(cur + 60, gap.end);
  }
  stops.push(gap.end);
  return stops;
}

export function dayIsComplete(days: Day[], dayIdx: number, prevWeekSundayNoite?: Entry[]): boolean {
  return SHIFT_LABELS.every((label) => gapsForDayShift(days, dayIdx, label, prevWeekSundayNoite).length === 0);
}

export function weekToWhatsApp(week: Week, prevWeekSundayNoite?: Entry[]): string {
  const monday = parseIso(week.weekStart);
  let text = `*ESCALA — semana de ${fmtBR(monday)}*\n\n`;
  week.days.forEach((day, i) => {
    const date = addDays(monday, i);
    const complete = dayIsComplete(week.days, i, prevWeekSundayNoite);
    text += `*${DAY_NAMES[i]} (${fmtBR(date)})* ${complete ? '✅' : '❌'}\n`;

    // Merge contiguous same-person entries within each shift first (e.g. two taps that
    // filled 18:00–19:00 and 19:00–00:00 separately), then flatten so we can detect the
    // same person continuing seamlessly across shifts (e.g. Manhã→Tarde) and avoid
    // repeating the boundary time.
    const mergedByLabel = new Map(SHIFT_LABELS.map((label) => [label, mergeContiguous(day.shifts[label])]));
    const all: Entry[] = SHIFT_LABELS.flatMap((label) => mergedByLabel.get(label)!);

    SHIFT_LABELS.forEach((label) => {
      const entries = mergedByLabel.get(label)!;
      if (entries.length === 0) {
        text += `${label}:\n`;
        return;
      }
      entries.forEach((e) => {
        if (!e.who) {
          text += `${label}:\n`;
          return;
        }
        let time = '';
        if (e.start && e.end) {
          const continuesFromPrev = all.some((o) => o.id !== e.id && o.who === e.who && o.end === e.start);
          const continuesToNext = all.some((o) => o.id !== e.id && o.who === e.who && o.start === e.end);
          if (continuesFromPrev && !continuesToNext) time = ` até às ${e.end}`;
          else if (continuesToNext && !continuesFromPrev) time = ` às ${e.start}`;
          else if (!continuesFromPrev && !continuesToNext) time = ` ${e.start} às ${e.end}`;
        }
        text += `${label}: *${e.who}*${time}\n`;
      });
    });
    text += '\n';
  });
  return text.trim();
}

export function seedWeek(weekStartIso: string): Week {
  const week = emptyWeek(weekStartIso);
  const mk = (who: string, start: string, end: string): Entry => ({
    id: Math.random().toString(36).slice(2),
    who,
    start,
    end,
  });

  week.days[0].shifts['Manhã'] = [mk('Marilene', '08:00', '12:00')];
  week.days[0].shifts['Tarde'] = [mk('Marilene', '12:00', '17:00'), mk('Betinho', '17:00', '20:00')];
  week.days[0].shifts['Noite'] = [mk('Renata', '20:00', '08:00')];

  week.days[1].shifts['Manhã'] = [mk('Betinho', '08:00', '12:00')];
  week.days[1].shifts['Tarde'] = [mk('Betinho', '12:00', '14:00'), mk('Giz', '14:00', '20:00')];
  week.days[1].shifts['Noite'] = [mk('Técnica Josi', '20:00', '08:00')];

  week.days[2].shifts['Manhã'] = [mk('Giz', '08:00', '13:00')];
  week.days[2].shifts['Tarde'] = [mk('Marilene', '13:00', '18:00'), mk('Rudsom', '18:00', '20:00')];
  week.days[2].shifts['Noite'] = [mk('Renata', '20:00', '08:00')];

  week.days[3].shifts['Manhã'] = [mk('Marilene', '08:00', '12:00')];
  week.days[3].shifts['Tarde'] = [mk('Marilene', '12:00', '18:00'), mk('Rudsom', '18:00', '20:00')];
  week.days[3].shifts['Noite'] = [mk('Renata', '20:00', '08:00')];

  week.days[4].shifts['Manhã'] = [mk('Gizlene', '08:00', '14:00')];
  week.days[4].shifts['Tarde'] = [mk('Adriane', '14:00', '20:00')];
  week.days[4].shifts['Noite'] = [mk('Renata', '20:00', '08:00')];

  week.days[5].shifts['Manhã'] = [mk('Técnica Josi', '06:00', '12:00')];
  week.days[5].shifts['Tarde'] = [mk('Técnica Josi', '12:00', '18:00')];
  week.days[5].shifts['Noite'] = [mk('Técnica Josi', '18:00', '08:00')];

  week.days[6].shifts['Noite'] = [mk('Adriane (Deyse)', '18:00', '08:00')];

  return week;
}

export const SEED_WEEK_KEY = '2026-06-22';
