export type Entry = { id: string; who: string; start: string; end: string };
export type ShiftLabel = 'Manhã' | 'Tarde' | 'Noite';
export type Day = { shifts: Record<ShiftLabel, Entry[]> };
export type Week = { weekStart: string; days: Day[] };

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

const DAY_MIN = 24 * 60;

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

// Collapses entries by the same person whose times tile exactly (one's end equals the
// next's start) into a single entry spanning the whole block — e.g. two taps that filled
// 18:00–19:00 and 19:00–00:00 separately become one 18:00–00:00 entry for display.
export function mergeContiguous(entries: Entry[]): Entry[] {
  const withTime = entries.filter((e) => e.who && e.start && e.end);
  const withoutTime = entries.filter((e) => !(e.who && e.start && e.end));
  const consumed = new Set<string>();
  const blocks: Entry[] = [];

  for (const e of withTime) {
    if (consumed.has(e.id)) continue;
    const hasPred = withTime.some((o) => o.id !== e.id && o.who === e.who && o.end === e.start && !consumed.has(o.id));
    if (hasPred) continue;
    consumed.add(e.id);
    let cur = e;
    while (true) {
      const next = withTime.find((o) => !consumed.has(o.id) && o.who === cur.who && o.start === cur.end);
      if (!next) break;
      consumed.add(next.id);
      cur = next;
    }
    blocks.push({ ...e, end: cur.end });
  }

  return [...blocks, ...withoutTime];
}

// prevWeekSundayNoite: the previous week's Sunday Noite entries, used so Monday's Manhã
// gap calc also considers a shift that started the week before.
// excludeEntryId: drop one entry from the calculation — used when editing that entry's own
// time, so its current slot (merged with any adjacent gaps) shows up as available again.
export function gapsForDayShift(
  days: Day[],
  dayIdx: number,
  label: ShiftLabel,
  prevWeekSundayNoite?: Entry[],
  excludeEntryId?: string,
): Gap[] {
  const entries = days[dayIdx].shifts[label].filter((e) => e.id !== excludeEntryId);
  const overnightFromPrev =
    label === 'Manhã' ? (dayIdx > 0 ? days[dayIdx - 1].shifts['Noite'] : prevWeekSundayNoite) : undefined;
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
