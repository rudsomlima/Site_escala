'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Day,
  DEFAULT_SHIFT_RATE,
  Entry,
  FREQUENT_NAMES,
  Gap,
  PaymentSummary,
  SHIFT_LABELS,
  ShiftLabel,
  Week,
  addDays,
  applySpillover,
  dayIsComplete,
  emptyWeek,
  fmtBR,
  fmtMin,
  gapsForDayShift,
  gapStops,
  isoDate,
  mergeContiguous,
  mondayOf,
  parseIso,
  toMin,
  weekPayments,
  weekToWhatsApp,
  DAY_NAMES,
} from '@/lib/schedule';

function newId() {
  return Math.random().toString(36).slice(2);
}

// Renders WhatsApp-style *bold* markup as actual bold text, so the preview shows what the
// message will look like once pasted instead of the literal asterisks.
function renderWhatsAppPreview(text: string) {
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*[^*]+\*)/g).filter((p) => p !== '');
    return (
      <div key={i}>
        {parts.length === 0
          ? ' '
          : parts.map((part, j) =>
              part.startsWith('*') && part.endsWith('*') && part.length > 1 ? (
                <strong key={j}>{part.slice(1, -1)}</strong>
              ) : (
                <span key={j}>{part}</span>
              ),
            )}
      </div>
    );
  });
}

function todayIso() {
  return isoDate(new Date());
}

// Hands at a clean vertical line (12 o'clock-ish) for "hora fechada" (whole-hour only) vs
// hands splayed at an angle for "hora fracionada" (free 10min increments allowed) — meant
// to read at a glance which time-picking mode is active.
function ClockModeIcon({ exact, className }: { exact: boolean; className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      {exact ? (
        <path d="M12 12V7M12 12H16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M12 12L9 8M12 12L16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

const HOLD_ACCELERATE_AFTER_MS = 2000;
const HOLD_NORMAL_INTERVAL_MS = 350;
const HOLD_FAST_INTERVAL_MS = 80;

// A +/- button that repeats while held — tapping steps once, holding repeats at a normal
// pace, and after 2s of holding it speeds up, so crossing several hours of 10min steps
// doesn't take dozens of individual taps.
function HoldStepButton({ onStep, children, className }: { onStep: () => void; children: React.ReactNode; className: string }) {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    holdTimer.current = null;
    repeatTimer.current = null;
  };

  useEffect(() => stop, []);

  const start = () => {
    onStepRef.current();
    repeatTimer.current = setInterval(() => onStepRef.current(), HOLD_NORMAL_INTERVAL_MS);
    holdTimer.current = setTimeout(() => {
      if (repeatTimer.current) clearInterval(repeatTimer.current);
      repeatTimer.current = setInterval(() => onStepRef.current(), HOLD_FAST_INTERVAL_MS);
    }, HOLD_ACCELERATE_AFTER_MS);
  };

  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className={className}
    >
      {children}
    </button>
  );
}

// +/- 10min stepper badge: keeps the chosen time visible at all times while it's
// adjusted, instead of hiding the adjustment behind a separate "fine tune" step.
function StepperBadge({ value, onChange, color }: { value: number; onChange: (next: number) => void; color: 'indigo' | 'sky' }) {
  const colorClass = color === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-sky-50 border-sky-200 text-sky-700';
  const valueRef = useRef(value);
  valueRef.current = value;
  const btnClass = 'w-9 h-9 flex items-center justify-center text-lg font-bold rounded-full active:bg-black/10 shrink-0';
  return (
    <span className={`inline-flex items-center gap-3 border rounded-full px-3 py-1 ${colorClass}`}>
      <HoldStepButton onStep={() => onChange(valueRef.current - 10)} className={btnClass}>−</HoldStepButton>
      <span className="text-sm font-bold px-1 min-w-[3.5em] text-center">{fmtMin(value)}</span>
      <HoldStepButton onStep={() => onChange(valueRef.current + 10)} className={btnClass}>+</HoldStepButton>
    </span>
  );
}

// Hour-aligned quick-pick badges (e.g. 18:00, 19:00, 20:00…) plus the +/-10min stepper
// right below — tap a badge to jump straight to that hour, or nudge with +/- for anything
// in between. The stepper stays visible at all times, it's just an optional refinement.
function TimePickRow({
  value,
  stops,
  color,
  onChange,
  onPick,
  exactHoursOnly,
}: {
  value: number;
  stops: number[];
  color: 'indigo' | 'sky';
  onChange: (next: number) => void;
  onPick?: (picked: number) => void;
  exactHoursOnly?: boolean;
}) {
  const idleClass = color === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-sky-50 border-sky-200 text-sky-700';
  const activeClass = color === 'indigo' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-sky-600 border-sky-600 text-white';
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {stops.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => (exactHoursOnly ? onPick?.(s) : onChange(s))}
            className={`text-xs font-semibold border px-2.5 py-1 rounded-full active:opacity-80 ${s === value ? activeClass : idleClass}`}
          >
            {fmtMin(s)}
          </button>
        ))}
      </div>
      {!exactHoursOnly && <StepperBadge value={value} onChange={onChange} color={color} />}
    </div>
  );
}

export default function ScheduleApp() {
  const [weekKey, setWeekKey] = useState(() => isoDate(mondayOf(new Date())));
  const [week, setWeek] = useState<Week | null>(null);
  const [prevWeek, setPrevWeek] = useState<Week | null>(null);
  const [loading, setLoading] = useState(true);
  const [whoPicker, setWhoPicker] = useState<{ day: number; shift: ShiftLabel; entryId: string } | null>(null);
  const [editFlow, setEditFlow] = useState<{ day: number; shift: ShiftLabel; entryId: string; phase: 'start' | 'end'; start: number; end: number } | null>(null);
  const [fillFlow, setFillFlow] = useState<{
    day: number;
    shift: ShiftLabel;
    gapStart: number;
    gapEnd: number;
    phase: 'who' | 'start' | 'end';
    who: string;
    start: number;
    end: number;
  } | null>(null);
  const [coverPrevFlow, setCoverPrevFlow] = useState<{ gapEnd: number } | null>(null);
  const [toast, setToast] = useState('');
  const [companions, setCompanions] = useState<string[]>(FREQUENT_NAMES);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [shiftRate, setShiftRate] = useState(DEFAULT_SHIFT_RATE);
  const [selectedPayNames, setSelectedPayNames] = useState<Set<string>>(new Set());
  const [expandedPayNames, setExpandedPayNames] = useState<Set<string>>(new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryEditing, setSummaryEditing] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [newCompanion, setNewCompanion] = useState('');
  const [editingCompanion, setEditingCompanion] = useState<{ name: string; draft: string } | null>(null);
  const [companionsEditMode, setCompanionsEditMode] = useState(false);
  const [companionsDeleteMode, setCompanionsDeleteMode] = useState(false);
  const [exactHoursOnly, setExactHoursOnly] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setExactHoursOnly(localStorage.getItem('exactHoursOnly') === '1');
  }, []);

  function toggleExactHoursOnly() {
    setExactHoursOnly((prev) => {
      const next = !prev;
      localStorage.setItem('exactHoursOnly', next ? '1' : '0');
      return next;
    });
  }

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: { names: string[]; shiftRate: number }) => {
        setCompanions(d.names);
        setShiftRate(d.shiftRate ?? DEFAULT_SHIFT_RATE);
      });
  }, []);

  function loadWeeks() {
    setLoading(true);
    fetch(`/api/weeks/${weekKey}`)
      .then((r) => r.json())
      .then((w: Week) => setWeek(w))
      .finally(() => setLoading(false));

    const prevKey = isoDate(addDays(parseIso(weekKey), -7));
    fetch(`/api/weeks/${prevKey}`)
      .then((r) => r.json())
      .then((w: Week) => setPrevWeek(w))
      .catch(() => setPrevWeek(null));
  }

  useEffect(loadWeeks, [weekKey]);

  // onSaved: runs only once this week's PUT actually resolves — used to chain a write to a
  // different store key (e.g. the global settings) strictly after this one, since the
  // JSON-document store (lib/store.ts) does a whole-document read-modify-write per request,
  // so firing two writes concurrently risks one clobbering the other (lost update).
  function scheduleSave(next: Week, onSaved?: () => void) {
    setWeek(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/weeks/${weekKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then(() => {
          showToast('Salvo ✓');
          onSaved?.();
        })
        .catch(() => showToast('Erro ao salvar — verifique a conexão'));
    }, 400);
  }

  function saveCompanions(next: string[]) {
    setCompanions(next);
    if (companionsSaveTimer.current) clearTimeout(companionsSaveTimer.current);
    companionsSaveTimer.current = setTimeout(() => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: next }),
      }).then(() => showToast('Lista atualizada ✓'));
    }, 300);
  }

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 1500);
  }

  function updateDay(dayIdx: number, mutate: (day: Day) => void) {
    if (!week) return;
    const next: Week = JSON.parse(JSON.stringify(week));
    mutate(next.days[dayIdx]);
    scheduleSave(next);
  }

  function addGapEntry(dayIdx: number, label: ShiftLabel, who: string, start: number, end: number) {
    const id = newId();
    updateDay(dayIdx, (day) => {
      day.shifts[label].push({ id, who, start: fmtMin(start), end: fmtMin(end) });
      applySpillover(day, id, label, who, start, end);
    });
    setFillFlow(null);
    return id;
  }

  // Monday's Manhã gap calc leans on the previous week's Sunday Noite entries to know
  // whether the small hours are already covered by an overnight shift that started the
  // week before (see overnightFromPrev in lib/schedule.ts). When that previous week has no
  // Noite data at all (never filled in, or this is the first week ever tracked), the gap
  // shows up as missing even though it may genuinely already be covered by an unrecorded
  // shift — this writes a same-default entry into last week's Sunday Noite so the data
  // actually reflects that, instead of just hiding the warning.
  function coverFromPrevWeek(who: string, gapEnd: number) {
    // A previous-week Noite entry can only ever be credited up to its own window's end
    // (08:00 — see SHIFT_WINDOWS/clipToWindow in lib/schedule.ts), no matter what end time
    // is stored here — anything beyond that needs a real Manhã entry instead.
    const cappedEnd = Math.min(gapEnd, 8 * 60);
    const prevKey = isoDate(addDays(parseIso(weekKey), -7));
    const base = prevWeek ?? emptyWeek(prevKey);
    const nextPrevWeek: Week = JSON.parse(JSON.stringify(base));
    nextPrevWeek.days[6].shifts['Noite'].push({ id: newId(), who, start: '20:00', end: fmtMin(cappedEnd) });
    setPrevWeek(nextPrevWeek);
    fetch(`/api/weeks/${prevKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextPrevWeek),
    })
      .then(() => showToast('Salvo ✓'))
      .catch(() => showToast('Erro ao salvar — verifique a conexão'));
    setCoverPrevFlow(null);
  }

  // entryIds: every id folded into this displayed row by mergeContiguous — the first is
  // kept (and updated), the rest are dropped, so a merged block collapses into one real
  // entry as soon as it's touched instead of leaving stale contiguous fragments behind.
  function setEntryWho(dayIdx: number, label: ShiftLabel, entryIds: string[], who: string) {
    const [primaryId, ...rest] = entryIds;
    updateDay(dayIdx, (day) => {
      if (rest.length) day.shifts[label] = day.shifts[label].filter((e) => !rest.includes(e.id));
      const entry = day.shifts[label].find((e) => e.id === primaryId);
      if (entry) {
        entry.who = who;
        applySpillover(day, primaryId, label, who, entry.start ? toMin(entry.start) : 0, entry.end ? toMin(entry.end) : 0);
      }
    });
    setWhoPicker(null);
  }

  function confirmEntryTime(dayIdx: number, label: ShiftLabel, entryIds: string[], start: number, end: number) {
    const [primaryId, ...rest] = entryIds;
    updateDay(dayIdx, (day) => {
      if (rest.length) day.shifts[label] = day.shifts[label].filter((e) => !rest.includes(e.id));
      const entry = day.shifts[label].find((e) => e.id === primaryId);
      if (entry) {
        entry.start = fmtMin(start);
        entry.end = fmtMin(end);
        applySpillover(day, primaryId, label, entry.who, start, end);
      }
    });
    setEditFlow(null);
  }

  // The free slot an entry's own time can move within: its gap once it's excluded from
  // the calc (so its current span counts as available again), merged with any adjacent
  // free time. Falls back to the entry's own current span if nothing else is free.
  function freedGapBounds(dayIdx: number, label: ShiftLabel, entry: Entry, excludeIds: string[]): Gap {
    if (!week) return { start: 0, end: 0 };
    const gaps = gapsForDayShift(week.days, dayIdx, label, prevSundayNoite, excludeIds);
    const s = entry.start ? toMin(entry.start) : 0;
    return gaps.find((g) => g.start <= s && s < g.end) ?? gaps[0] ?? { start: s, end: entry.end ? toMin(entry.end) : s };
  }

  function removeEntry(dayIdx: number, label: ShiftLabel, entryIds: string[]) {
    updateDay(dayIdx, (day) => {
      day.shifts[label] = day.shifts[label].filter((e) => !entryIds.includes(e.id));
      for (const otherLabel of SHIFT_LABELS) {
        day.shifts[otherLabel] = day.shifts[otherLabel].filter((e) => !e.spilloverOf || !entryIds.includes(e.spilloverOf));
      }
    });
    if (whoPicker && entryIds.includes(whoPicker.entryId)) setWhoPicker(null);
    if (editFlow && entryIds.includes(editFlow.entryId)) setEditFlow(null);
  }

  function whatsAppText(): string | null {
    if (!week) return null;
    const prevSundayNoite = prevWeek?.days[6]?.shifts['Noite'];
    return weekToWhatsApp(week, prevSundayNoite);
  }

  // Some Android browsers/webviews don't expose navigator.clipboard (needs HTTPS,
  // or a non-WebView context) — fall back to the classic textarea+execCommand trick,
  // which also works fine on iOS Safari.
  function legacyCopy(text: string) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      document.execCommand('copy');
      showToast('Copiado! Cole no WhatsApp 📲');
    } catch {
      showToast('Não foi possível copiar automaticamente');
    }
    document.body.removeChild(textarea);
  }

  function copyText(text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast('Copiado! Cole no WhatsApp 📲')).catch(() => legacyCopy(text));
    } else {
      legacyCopy(text);
    }
  }

  function copyToWhatsApp() {
    const text = whatsAppText();
    if (text) copyText(text);
  }

  function openSummary() {
    setSummaryDraft(whatsAppText() ?? '');
    setSummaryEditing(false);
    setSummaryOpen(true);
  }

  function deleteWeek() {
    if (!week) return;
    if (!confirm('Apagar toda a escala desta semana? Essa ação não pode ser desfeita.')) return;
    scheduleSave(emptyWeek(weekKey));
    showToast('Semana apagada');
  }

  function goWeek(delta: number) {
    const current = parseIso(weekKey);
    setWeekKey(isoDate(addDays(current, delta * 7)));
    setWhoPicker(null);
    setEditFlow(null);
    setFillFlow(null);
    setCoverPrevFlow(null);
  }

  function addCompanion() {
    const name = newCompanion.trim();
    if (!name || companions.includes(name)) return;
    saveCompanions([...companions, name]);
    setNewCompanion('');
  }

  function removeCompanion(name: string) {
    saveCompanions(companions.filter((n) => n !== name));
  }

  // Unlike add/remove (which only touch the suggestions list), renaming also rewrites every
  // entry that already used the old name across every saved week (see
  // app/api/settings/rename/route.ts) — so the currently loaded week(s) need a refetch
  // afterward to pick up entries that were renamed server-side.
  function renameCompanion(oldName: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) {
      setEditingCompanion(null);
      return;
    }
    fetch('/api/settings/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldName, newName: trimmed }),
    })
      .then((r) => r.json())
      .then(() => {
        setCompanions((prev) => Array.from(new Set(prev.map((n) => (n === oldName ? trimmed : n)))));
        loadWeeks();
        showToast('Nome atualizado ✓');
      })
      .catch(() => showToast('Erro ao renomear — verifique a conexão'));
    setEditingCompanion(null);
  }

  // Names actually scheduled this week (own entries only, not visual spillover rows) —
  // falls back to the suggested companions list if the week is still empty.
  function namesWorkingThisWeek(): string[] {
    if (!week) return companions;
    const set = new Set<string>();
    for (const day of week.days) {
      for (const label of SHIFT_LABELS) {
        for (const e of day.shifts[label]) {
          if (e.who && !e.spilloverOf) set.add(e.who);
        }
      }
    }
    return set.size > 0 ? Array.from(set).sort() : companions;
  }

  function openPayments() {
    setSelectedPayNames(new Set());
    setExpandedPayNames(new Set());
    setPaymentsOpen(true);
  }

  function togglePayName(name: string) {
    setSelectedPayNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllPayNames(names: string[]) {
    setSelectedPayNames((prev) => (names.every((n) => prev.has(n)) ? new Set() : new Set(names)));
  }

  function toggleExpandAllPay(names: string[]) {
    setExpandedPayNames((prev) => (names.every((n) => prev.has(n)) ? new Set() : new Set(names)));
  }

  // The current week's own pinned rate, if it has one, otherwise the live global default —
  // see Week.shiftRate's doc comment in lib/schedule.ts for why.
  function saveWeekShiftRate(next: number) {
    if (!week) return;
    const nextWeek: Week = { ...week, shiftRate: next };
    setShiftRate(next);
    // Update the global default only after this week's own value has actually finished
    // saving — see scheduleSave's onSaved doc comment for why this can't run concurrently.
    scheduleSave(nextWeek, () => {
      fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shiftRate: next }),
      }).then(() => showToast('Valor atualizado ✓'));
    });
  }

  function fmtHours(h: number): string {
    return h % 1 === 0 ? `${h}h` : `${h.toFixed(1).replace('.', ',')}h`;
  }

  function fmtMoney(v: number): string {
    return `R$ ${v.toFixed(2).replace('.', ',')}`;
  }

  const monday = parseIso(weekKey);
  const isCurrentWeek = weekKey === isoDate(mondayOf(new Date()));
  const prevSundayNoite = prevWeek?.days[6]?.shifts['Noite'];

  // In "hora fechada" mode the +/- stepper is hidden, so hour badges are the only way to
  // pick a time — bounding them to just the gap that was tapped would make it impossible to
  // reach into an adjacent shift (e.g. extend a Manhã entry into Tarde/Noite, which
  // applySpillover supports). This unions every shift's uncovered hours for the day instead,
  // so any free hour is reachable regardless of which gap's "Cobrir" button was tapped.
  function dayWideStops(dayIdx: number, excludeEntryIds?: string[]): number[] {
    if (!week) return [];
    const stops = new Set<number>();
    for (const l of SHIFT_LABELS) {
      for (const g of gapsForDayShift(week.days, dayIdx, l, prevSundayNoite, excludeEntryIds)) {
        for (const s of gapStops(g)) stops.add(s);
      }
    }
    return Array.from(stops).sort((a, b) => a - b);
  }

  // One combined "falta cobrir" list for the whole day instead of three separate ones per
  // shift — adjacent gaps from different shifts (one's end touching the next's start, e.g.
  // Tarde's gap ending at 18:00 and Noite's starting at 18:00) are merged into a single
  // range. Each merged range keeps the *earliest* shift it came from as its origin — that's
  // the shift the resulting entry gets saved under; addGapEntry's applySpillover call
  // already takes care of distributing it into whichever later shift(s) it actually spans.
  function dayCombinedGaps(dayIdx: number): { gap: Gap; shift: ShiftLabel }[] {
    if (!week) return [];
    const tagged: { gap: Gap; shift: ShiftLabel }[] = [];
    for (const label of SHIFT_LABELS) {
      for (const g of gapsForDayShift(week.days, dayIdx, label, prevSundayNoite)) {
        tagged.push({ gap: { ...g }, shift: label });
      }
    }
    tagged.sort((a, b) => a.gap.start - b.gap.start);
    const merged: { gap: Gap; shift: ShiftLabel }[] = [];
    for (const t of tagged) {
      const last = merged[merged.length - 1];
      if (last && last.gap.end === t.gap.start) last.gap.end = t.gap.end;
      else merged.push(t);
    }
    return merged;
  }

  const effectiveShiftRate = week?.shiftRate ?? shiftRate;
  const paymentResults: PaymentSummary[] = week
    ? weekPayments(week, effectiveShiftRate).filter((p) => selectedPayNames.has(p.who))
    : [];

  return (
    <div className="min-h-screen pb-24">
      <header className="bg-indigo-600 text-white px-4 py-3 sticky top-0 z-10 shadow">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => goWeek(-1)}
            aria-label="Semana anterior"
            className="shrink-0 w-9 h-9 rounded-full bg-white/20 text-white text-xl font-bold flex items-center justify-center active:bg-white/35 active:scale-95 transition"
          >
            ‹
          </button>
          <p className="flex-1 text-center text-white text-sm font-medium">
            Semana de {fmtBR(monday)}{' '}
            {isCurrentWeek && <span className="ml-1 bg-rose-500 text-white px-2 py-0.5 rounded-full text-[10px] align-middle font-bold">ATUAL</span>}
          </p>
          <button
            onClick={() => goWeek(1)}
            aria-label="Próxima semana"
            className="shrink-0 w-9 h-9 rounded-full bg-white/20 text-white text-xl font-bold flex items-center justify-center active:bg-white/35 active:scale-95 transition"
          >
            ›
          </button>
        </div>
      </header>

      <main className="px-3 pt-3 space-y-3 max-w-md mx-auto">
        {loading || !week ? (
          <p className="text-center text-slate-400 py-10">Carregando…</p>
        ) : (
          week.days.map((day, dayIdx) => {
            const date = addDays(monday, dayIdx);
            const isToday = isoDate(date) === todayIso();
            const complete = dayIsComplete(week.days, dayIdx, prevSundayNoite);
            return (
              <details key={dayIdx} open={isToday} className={`bg-white rounded-2xl shadow-sm overflow-hidden ${isToday ? 'ring-2 ring-indigo-500' : ''}`}>
                <summary className="px-4 py-3 flex items-center justify-between cursor-pointer select-none list-none">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold">{DAY_NAMES[dayIdx]}</span>
                    <span className="text-slate-400 text-sm">{fmtBR(date)}</span>
                    {isToday && <span className="text-[10px] bg-indigo-600 text-white px-2 py-0.5 rounded-full">HOJE</span>}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${complete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {complete ? '✅ Completo' : '⚠️ Falta gente'}
                  </span>
                </summary>

                <div className="px-4 pb-4 space-y-4 border-t border-slate-100 pt-3">
                  {(() => {
                    const combinedGaps = dayCombinedGaps(dayIdx);
                    if (combinedGaps.length === 0) return null;
                    return (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-600 font-medium">
                          ⚠️ Falta cobrir {combinedGaps.map(({ gap }) => `${fmtMin(gap.start)}–${fmtMin(gap.end)}`).join(', ')}
                        </p>
                        {combinedGaps.map(({ gap, shift: label }) => {
                          const flow =
                            fillFlow && fillFlow.day === dayIdx && fillFlow.shift === label && fillFlow.gapStart === gap.start ? fillFlow : null;

                          if (!flow) {
                            return (
                              <button
                                key={gap.start}
                                type="button"
                                onClick={() =>
                                  setFillFlow({ day: dayIdx, shift: label, gapStart: gap.start, gapEnd: gap.end, phase: 'who', who: '', start: gap.start, end: gap.end })
                                }
                                className="text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-700 px-2.5 py-1 rounded-full active:bg-amber-100"
                              >
                                Cobrir {fmtMin(gap.start)}–{fmtMin(gap.end)}
                              </button>
                            );
                          }

                          if (flow.phase === 'who') {
                            return (
                              <div key={gap.start} className="flex flex-wrap gap-1.5">
                                <span className="text-[11px] text-slate-400 w-full">Quem vai cobrir {fmtMin(gap.start)}–{fmtMin(gap.end)}?</span>
                                {companions.map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => setFillFlow({ ...flow, who: n, phase: 'start' })}
                                    className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full active:bg-indigo-200"
                                  >
                                    {n}
                                  </button>
                                ))}
                                <button type="button" onClick={() => setFillFlow(null)} className="text-[11px] text-rose-500 underline ml-1">
                                  cancelar
                                </button>
                              </div>
                            );
                          }

                          const allStops = exactHoursOnly ? dayWideStops(dayIdx) : gapStops({ start: flow.gapStart, end: flow.gapEnd });
                          const stops = flow.phase === 'start' ? allStops.slice(0, -1) : allStops.filter((s) => s > flow.start);
                          const pick = (picked: number) =>
                            flow.phase === 'start'
                              ? setFillFlow({ ...flow, phase: 'end', start: picked, end: picked })
                              : addGapEntry(dayIdx, label, flow.who, flow.start, picked);
                          return (
                            <div key={gap.start} className="bg-slate-50 rounded-lg px-2 py-1.5 space-y-1.5">
                              <span className="font-medium text-slate-800 text-sm">
                                {flow.who} <span className="text-[11px] text-slate-400 font-normal">{flow.phase === 'start' ? 'início' : 'fim'}</span>
                              </span>
                              <div className="flex flex-wrap items-start gap-2">
                                <TimePickRow
                                  color={flow.phase === 'start' ? 'indigo' : 'sky'}
                                  stops={stops}
                                  value={flow.phase === 'start' ? flow.start : flow.end}
                                  onChange={(v) => setFillFlow({ ...flow, [flow.phase]: v })}
                                  onPick={pick}
                                  exactHoursOnly={exactHoursOnly}
                                />
                                {!exactHoursOnly && (
                                  <button
                                    type="button"
                                    disabled={flow.phase === 'end' && flow.end <= flow.start}
                                    onClick={() =>
                                      flow.phase === 'start'
                                        ? setFillFlow({ ...flow, phase: 'end', end: flow.start })
                                        : addGapEntry(dayIdx, label, flow.who, flow.start, flow.end)
                                    }
                                    className="text-sm font-bold bg-emerald-600 border border-emerald-600 text-white px-4 py-2 rounded-full active:bg-emerald-700 disabled:opacity-40"
                                  >
                                    {flow.phase === 'start' ? 'seguir →' : 'OK ✓'}
                                  </button>
                                )}
                                <button type="button" onClick={() => setFillFlow(null)} className="text-[11px] text-rose-500 underline">
                                  cancelar
                                </button>
                              </div>
                            </div>
                          );
                        })}

                        {dayIdx === 0 &&
                          !prevSundayNoite?.length &&
                          (() => {
                            const openGap = gapsForDayShift(week.days, dayIdx, 'Manhã', prevSundayNoite).find((g) => g.start === 0);
                            if (!openGap) return null;
                            if (coverPrevFlow) {
                              return (
                                <div className="flex flex-wrap gap-1.5">
                                  <span className="text-[11px] text-slate-400 w-full">Quem já cobria desde domingo (semana anterior)?</span>
                                  {companions.map((n) => (
                                    <button
                                      key={n}
                                      type="button"
                                      onClick={() => coverFromPrevWeek(n, coverPrevFlow.gapEnd)}
                                      className="text-xs bg-violet-50 text-violet-700 px-2.5 py-1 rounded-full active:bg-violet-200"
                                    >
                                      {n}
                                    </button>
                                  ))}
                                  <button type="button" onClick={() => setCoverPrevFlow(null)} className="text-[11px] text-rose-500 underline ml-1">
                                    cancelar
                                  </button>
                                </div>
                              );
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => setCoverPrevFlow({ gapEnd: openGap.end })}
                                className="text-xs font-semibold bg-violet-50 border border-violet-200 text-violet-700 px-2.5 py-1 rounded-full active:bg-violet-100"
                              >
                                🌙 Já coberto desde domingo
                              </button>
                            );
                          })()}
                      </div>
                    );
                  })()}

                  {SHIFT_LABELS.map((label) => {
                    const entries = mergeContiguous(day.shifts[label]);
                    return (
                      <div key={label} className="space-y-1.5">
                        <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>

                        {entries.map((entry) => {
                          const isEditingTime = editFlow && editFlow.day === dayIdx && editFlow.shift === label && editFlow.entryId === entry.id;
                          return (
                            <div key={entry.id} className="bg-slate-50 rounded-lg px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                <span className="text-indigo-500 text-sm">●</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditFlow(null);
                                    setWhoPicker(whoPicker?.entryId === entry.id ? null : { day: dayIdx, shift: label, entryId: entry.id });
                                  }}
                                  className="flex-1 min-w-0 text-left font-medium text-slate-800 truncate"
                                >
                                  {entry.who || <span className="text-slate-400 font-normal">Selecionar nome</span>}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWhoPicker(null);
                                    setEditFlow(
                                      isEditingTime
                                        ? null
                                        : {
                                            day: dayIdx,
                                            shift: label,
                                            entryId: entry.id,
                                            phase: 'start',
                                            start: entry.start ? toMin(entry.start) : 0,
                                            end: entry.end ? toMin(entry.end) : 0,
                                          },
                                    );
                                  }}
                                  className="text-xs font-semibold text-sky-700 px-2 py-1 rounded-full bg-sky-50 border border-sky-200 active:bg-sky-100"
                                >
                                  {entry.start || '--:--'} – {entry.end || '--:--'}
                                </button>
                                <button
                                  onClick={() => removeEntry(dayIdx, label, entry.mergedIds)}
                                  aria-label="Excluir"
                                  className="text-slate-400 active:text-rose-500 text-lg leading-none w-9 h-9 flex items-center justify-center shrink-0"
                                >
                                  ✕
                                </button>
                              </div>

                              {whoPicker && whoPicker.day === dayIdx && whoPicker.shift === label && whoPicker.entryId === entry.id && (
                                <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-slate-200">
                                  <span className="text-[11px] text-slate-400 w-full">Quem vai cobrir {entry.start} às {entry.end}?</span>
                                  {companions.map((n) => (
                                    <button
                                      key={n}
                                      onClick={() => setEntryWho(dayIdx, label, entry.mergedIds, n)}
                                      className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full active:bg-indigo-200"
                                    >
                                      {n}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {isEditingTime && (() => {
                                const bounds = freedGapBounds(dayIdx, label, entry, entry.mergedIds);
                                const allStops = exactHoursOnly ? dayWideStops(dayIdx, entry.mergedIds) : gapStops(bounds);
                                const stops = editFlow.phase === 'start' ? allStops.slice(0, -1) : allStops.filter((s) => s > editFlow.start);
                                const pick = (picked: number) =>
                                  editFlow.phase === 'start'
                                    ? setEditFlow({ ...editFlow, phase: 'end', start: picked, end: picked })
                                    : confirmEntryTime(dayIdx, label, entry.mergedIds, editFlow.start, picked);
                                return (
                                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
                                    <span className="text-[11px] text-slate-400">{editFlow.phase === 'start' ? 'início' : 'fim'}</span>
                                    <div className="flex flex-wrap items-start gap-2">
                                      <TimePickRow
                                        color={editFlow.phase === 'start' ? 'indigo' : 'sky'}
                                        stops={stops}
                                        value={editFlow.phase === 'start' ? editFlow.start : editFlow.end}
                                        onChange={(v) => setEditFlow({ ...editFlow, [editFlow.phase]: v })}
                                        onPick={pick}
                                        exactHoursOnly={exactHoursOnly}
                                      />
                                      {!exactHoursOnly && (
                                        <button
                                          type="button"
                                          disabled={editFlow.phase === 'end' && editFlow.end <= editFlow.start}
                                          onClick={() =>
                                            editFlow.phase === 'start'
                                              ? setEditFlow({ ...editFlow, phase: 'end', end: editFlow.start })
                                              : confirmEntryTime(dayIdx, label, entry.mergedIds, editFlow.start, editFlow.end)
                                          }
                                          className="text-sm font-bold bg-emerald-600 border border-emerald-600 text-white px-4 py-2 rounded-full active:bg-emerald-700 disabled:opacity-40"
                                        >
                                          {editFlow.phase === 'start' ? 'seguir →' : 'OK ✓'}
                                        </button>
                                      )}
                                      <button type="button" onClick={() => setEditFlow(null)} className="text-[11px] text-rose-500 underline">
                                        cancelar
                                      </button>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })
        )}

        {!loading && week && (
          <>
            <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
              <button
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-2 active:bg-slate-100"
              >
                👥 Acompanhantes
              </button>
              <button
                onClick={openPayments}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-2 active:bg-slate-100"
              >
                💰 Pagamentos
              </button>
              <button
                onClick={toggleExactHoursOnly}
                aria-label="Alternar hora fechada ou fracionada"
                className={`flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-2 border ${
                  exactHoursOnly
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-500'
                }`}
              >
                <ClockModeIcon exact={exactHoursOnly} /> {exactHoursOnly ? 'Hora fechada' : 'Hora fracionada'}
              </button>
            </div>

            <button
              onClick={deleteWeek}
              className="w-full text-center text-xs text-rose-500 font-medium py-3 active:text-rose-700"
            >
              🗑️ Apagar escala desta semana
            </button>
          </>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-3 py-3 flex gap-2 max-w-md mx-auto">
        <button
          onClick={openSummary}
          className="bg-slate-100 text-slate-700 font-semibold rounded-xl py-3 px-4 active:scale-95 transition"
        >
          👁️ Resumo
        </button>
        <button onClick={copyToWhatsApp} className="flex-1 bg-emerald-600 text-white font-semibold rounded-xl py-3 active:scale-95 transition">
          📋 Copiar p/ WhatsApp
        </button>
      </div>

      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-sm px-4 py-2 rounded-full z-20">
          {toast}
        </div>
      )}

      {settingsOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-30 flex items-end justify-center"
          onClick={() => {
            setSettingsOpen(false);
            setCompanionsEditMode(false);
            setCompanionsDeleteMode(false);
            setEditingCompanion(null);
          }}
        >
          <div
            className="bg-white rounded-t-2xl w-full max-w-md p-4 pb-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">👥 Acompanhantes sugeridos</h2>
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  setCompanionsEditMode(false);
                  setCompanionsDeleteMode(false);
                  setEditingCompanion(null);
                }}
                className="text-slate-400 text-xl leading-none px-1"
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Quem aparece como sugestão rápida ao preencher um horário.</p>

            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  setCompanionsEditMode((v) => !v);
                  setCompanionsDeleteMode(false);
                  setEditingCompanion(null);
                }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  companionsEditMode ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-200 text-slate-500'
                }`}
              >
                ✏️ Editar
              </button>
              <button
                onClick={() => {
                  setCompanionsDeleteMode((v) => !v);
                  setCompanionsEditMode(false);
                  setEditingCompanion(null);
                }}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${
                  companionsDeleteMode ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-500'
                }`}
              >
                🗑️ Excluir
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {companions.map((n) =>
                editingCompanion?.name === n ? (
                  <span key={n} className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={editingCompanion.draft}
                      onChange={(e) => setEditingCompanion({ name: n, draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') renameCompanion(n, editingCompanion.draft);
                        if (e.key === 'Escape') setEditingCompanion(null);
                      }}
                      className="text-xs border border-indigo-300 rounded-full px-2.5 py-1 outline-none w-28"
                    />
                    <button onClick={() => renameCompanion(n, editingCompanion.draft)} className="text-emerald-600 active:opacity-70">✓</button>
                    <button onClick={() => setEditingCompanion(null)} className="text-slate-400 active:opacity-70">✕</button>
                  </span>
                ) : (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      if (companionsEditMode) setEditingCompanion({ name: n, draft: n });
                      else if (companionsDeleteMode) {
                        if (confirm(`Remover "${n}" da lista de sugestões?`)) removeCompanion(n);
                      }
                    }}
                    className={`text-xs px-2.5 py-1 rounded-full border ${
                      companionsDeleteMode
                        ? 'bg-rose-50 border-rose-200 text-rose-700 active:bg-rose-100'
                        : companionsEditMode
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700 active:bg-indigo-100'
                          : 'bg-slate-100 border-slate-100 text-slate-700'
                    }`}
                  >
                    {n}
                  </button>
                ),
              )}
              {companions.length === 0 && <p className="text-xs text-slate-400 italic">Nenhum nome cadastrado</p>}
            </div>

            <div className="flex gap-2">
              <input
                value={newCompanion}
                onChange={(e) => setNewCompanion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addCompanion()}
                placeholder="Adicionar nome"
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <button onClick={addCompanion} className="bg-indigo-600 text-white px-4 rounded-lg font-semibold text-sm active:scale-95">
                Adicionar
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentsOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 flex items-end justify-center" onClick={() => setPaymentsOpen(false)}>
          <div
            className="bg-white rounded-t-2xl w-full max-w-md p-4 pb-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">💰 Pagamentos da semana</h2>
              <button onClick={() => setPaymentsOpen(false)} className="text-slate-400 text-xl leading-none px-1">✕</button>
            </div>

            <label className="block text-xs text-slate-400 mb-1">Valor por 12h</label>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm text-slate-500">R$</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                value={effectiveShiftRate}
                onChange={(e) => saveWeekShiftRate(Number(e.target.value) || 0)}
                className="w-24 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
            </div>

            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-400">Quem entra no cálculo:</p>
              {namesWorkingThisWeek().length > 0 && (
                <button
                  onClick={() => toggleAllPayNames(namesWorkingThisWeek())}
                  className="text-[11px] font-semibold text-indigo-600 active:opacity-70"
                >
                  {namesWorkingThisWeek().every((n) => selectedPayNames.has(n)) ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {namesWorkingThisWeek().map((n) => (
                <button
                  key={n}
                  onClick={() => togglePayName(n)}
                  className={`text-xs px-2.5 py-1 rounded-full border ${
                    selectedPayNames.has(n)
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-200 text-slate-500'
                  }`}
                >
                  {n}
                </button>
              ))}
              {namesWorkingThisWeek().length === 0 && <p className="text-xs text-slate-400 italic">Nenhum acompanhante na semana</p>}
            </div>

            {paymentResults.length > 0 && (
              <button
                onClick={() => toggleExpandAllPay(paymentResults.map((p) => p.who))}
                className="text-[11px] font-semibold text-indigo-600 active:opacity-70 mb-2"
              >
                {paymentResults.every((p) => expandedPayNames.has(p.who)) ? '▾ Recolher todos' : '▸ Expandir todos'}
              </button>
            )}

            <div className="space-y-1.5">
              {paymentResults.length === 0 ? (
                <p className="text-xs text-slate-400 italic">Selecione ao menos um acompanhante.</p>
              ) : (
                paymentResults.map((p) => {
                  const expanded = expandedPayNames.has(p.who);
                  return (
                    <div key={p.who} className="bg-slate-50 rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPayNames((prev) => {
                            const next = new Set(prev);
                            if (next.has(p.who)) next.delete(p.who);
                            else next.add(p.who);
                            return next;
                          })
                        }
                        className="w-full flex items-center justify-between px-3 py-2 text-left active:bg-slate-100"
                      >
                        <div>
                          <p className="font-medium text-slate-800 text-sm">
                            {p.who} <span className="text-slate-400">{expanded ? '▾' : '▸'}</span>
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {fmtHours(p.hours)} · {p.shifts} {p.shifts === 1 ? 'plantão' : 'plantões'}
                          </p>
                        </div>
                        <p className="font-bold text-emerald-700">{fmtMoney(p.amount)}</p>
                      </button>
                      {expanded && (
                        <div className="px-3 pb-2 space-y-1 border-t border-slate-200 pt-2">
                          {p.blocks.map((b, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="text-slate-500">
                                {DAY_NAMES[b.dayIdx]} {b.date} · {b.start}–{b.end} · {fmtHours(b.hours)}
                              </span>
                              <span className="font-semibold text-slate-700">{fmtMoney(b.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {paymentResults.length > 0 && (
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200">
                <span className="text-sm font-semibold text-slate-600">Total</span>
                <span className="font-bold text-slate-800">{fmtMoney(paymentResults.reduce((sum, p) => sum + p.amount, 0))}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {summaryOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 flex items-end justify-center" onClick={() => setSummaryOpen(false)}>
          <div
            className="bg-white rounded-t-2xl w-full max-w-md p-4 pb-6 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="font-bold text-slate-800">👁️ Resumo da semana</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => setSummaryEditing((v) => !v)} className="text-xs font-semibold text-indigo-600 active:opacity-70">
                  {summaryEditing ? '👁️ Visualizar' : '✏️ Editar'}
                </button>
                <button onClick={() => setSummaryOpen(false)} className="text-slate-400 text-xl leading-none px-1">✕</button>
              </div>
            </div>
            {summaryEditing ? (
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                className="flex-1 overflow-y-auto text-sm leading-relaxed text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 outline-none focus:border-indigo-400 resize-none"
                rows={14}
              />
            ) : (
              <div className="flex-1 overflow-y-auto text-base leading-relaxed text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
                {renderWhatsAppPreview(summaryDraft)}
              </div>
            )}
            <button
              onClick={() => copyText(summaryDraft)}
              className="mt-3 shrink-0 bg-emerald-600 text-white font-semibold rounded-xl py-3 active:scale-95 transition"
            >
              📋 Copiar p/ WhatsApp
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
