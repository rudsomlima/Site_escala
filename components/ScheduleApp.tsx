'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Day,
  Entry,
  FREQUENT_NAMES,
  Gap,
  SHIFT_LABELS,
  ShiftLabel,
  Week,
  addDays,
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

// +/- 10min stepper badge: keeps the chosen time visible at all times while it's
// adjusted, instead of hiding the adjustment behind a separate "fine tune" step.
function StepperBadge({ value, onChange, color }: { value: number; onChange: (next: number) => void; color: 'indigo' | 'sky' }) {
  const colorClass = color === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-sky-50 border-sky-200 text-sky-700';
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-full pl-1 pr-1.5 py-1 ${colorClass}`}>
      <button type="button" onClick={() => onChange(value - 10)} className="w-6 h-6 flex items-center justify-center font-bold rounded-full active:bg-black/10">−</button>
      <span className="text-sm font-bold px-0.5">{fmtMin(value)}</span>
      <button type="button" onClick={() => onChange(value + 10)} className="w-6 h-6 flex items-center justify-center font-bold rounded-full active:bg-black/10">+</button>
    </span>
  );
}

// Hour-aligned quick-pick badges (e.g. 18:00, 19:00, 20:00…) plus the +/-10min stepper
// right below — tap a badge to jump straight to that hour, or nudge with +/- for anything
// in between. The stepper stays visible at all times, it's just an optional refinement.
function TimePickRow({ value, stops, color, onChange }: { value: number; stops: number[]; color: 'indigo' | 'sky'; onChange: (next: number) => void }) {
  const idleClass = color === 'indigo' ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-sky-50 border-sky-200 text-sky-700';
  const activeClass = color === 'indigo' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-sky-600 border-sky-600 text-white';
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {stops.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            className={`text-xs font-semibold border px-2.5 py-1 rounded-full active:opacity-80 ${s === value ? activeClass : idleClass}`}
          >
            {fmtMin(s)}
          </button>
        ))}
      </div>
      <StepperBadge value={value} onChange={onChange} color={color} />
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
  const [toast, setToast] = useState('');
  const [companions, setCompanions] = useState<string[]>(FREQUENT_NAMES);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [newCompanion, setNewCompanion] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companionsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d: { names: string[] }) => setCompanions(d.names));
  }, []);

  useEffect(() => {
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
  }, [weekKey]);

  function scheduleSave(next: Week) {
    setWeek(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch(`/api/weeks/${weekKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
        .then(() => showToast('Salvo ✓'))
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
    });
    setFillFlow(null);
    return id;
  }

  // entryIds: every id folded into this displayed row by mergeContiguous — the first is
  // kept (and updated), the rest are dropped, so a merged block collapses into one real
  // entry as soon as it's touched instead of leaving stale contiguous fragments behind.
  function setEntryWho(dayIdx: number, label: ShiftLabel, entryIds: string[], who: string) {
    const [primaryId, ...rest] = entryIds;
    updateDay(dayIdx, (day) => {
      if (rest.length) day.shifts[label] = day.shifts[label].filter((e) => !rest.includes(e.id));
      const entry = day.shifts[label].find((e) => e.id === primaryId);
      if (entry) entry.who = who;
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

  const monday = parseIso(weekKey);
  const isCurrentWeek = weekKey === isoDate(mondayOf(new Date()));
  const prevSundayNoite = prevWeek?.days[6]?.shifts['Noite'];

  return (
    <div className="min-h-screen pb-24">
      <header className="bg-indigo-600 text-white px-4 py-4 sticky top-0 z-10 shadow">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold leading-tight">🗓️ Escala de Acompanhamento</h1>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="Gerenciar acompanhantes"
            className="p-1 -mr-1 active:opacity-75"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M20 21a8 8 0 0 0-16 0" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="8" r="4" stroke="white" strokeWidth="2" />
              <path
                d="M18.5 5.5c-.6-.6-1.5-.6-2.1 0l-.4.4-.4-.4c-.6-.6-1.5-.6-2.1 0-.6.6-.6 1.6 0 2.2l2.5 2.4 2.5-2.4c.6-.6.6-1.6 0-2.2z"
                fill="#fb7185"
              />
            </svg>
          </button>
        </div>
        <div className="flex items-center justify-between mt-2 gap-2">
          <button
            onClick={() => goWeek(-1)}
            aria-label="Semana anterior"
            className="shrink-0 w-9 h-9 rounded-full bg-white/20 text-white text-xl font-bold flex items-center justify-center active:bg-white/35 active:scale-95 transition"
          >
            ‹
          </button>
          <p className="flex-1 text-center text-white text-sm font-medium">
            Semana de {fmtBR(monday)}{' '}
            {isCurrentWeek && <span className="ml-1 bg-white/25 px-2 py-0.5 rounded-full text-[10px] align-middle font-bold">ATUAL</span>}
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
                  {SHIFT_LABELS.map((label) => {
                    const entries = mergeContiguous(day.shifts[label]);
                    const gaps = gapsForDayShift(week.days, dayIdx, label, prevSundayNoite);
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
                                const allStops = gapStops(bounds);
                                const stops = editFlow.phase === 'start' ? allStops.slice(0, -1) : allStops.filter((s) => s > editFlow.start);
                                return (
                                  <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
                                    <span className="text-[11px] text-slate-400">{editFlow.phase === 'start' ? 'início' : 'fim'}</span>
                                    <div className="flex flex-wrap items-start gap-2">
                                      <TimePickRow
                                        color={editFlow.phase === 'start' ? 'indigo' : 'sky'}
                                        stops={stops}
                                        value={editFlow.phase === 'start' ? editFlow.start : editFlow.end}
                                        onChange={(v) => setEditFlow({ ...editFlow, [editFlow.phase]: v })}
                                      />
                                      <button
                                        type="button"
                                        disabled={editFlow.phase === 'end' && editFlow.end <= editFlow.start}
                                        onClick={() =>
                                          editFlow.phase === 'start'
                                            ? setEditFlow({ ...editFlow, phase: 'end' })
                                            : confirmEntryTime(dayIdx, label, entry.mergedIds, editFlow.start, editFlow.end)
                                        }
                                        className="text-sm font-bold bg-emerald-600 border border-emerald-600 text-white px-4 py-2 rounded-full active:bg-emerald-700 disabled:opacity-40"
                                      >
                                        {editFlow.phase === 'start' ? 'seguir →' : 'OK ✓'}
                                      </button>
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

                        {gaps.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs text-amber-600 font-medium">
                              ⚠️ Falta cobrir {gaps.map((g) => `${fmtMin(g.start)}–${fmtMin(g.end)}`).join(', ')}
                            </p>
                            {gaps.map((gap) => {
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

                              const allStops = gapStops({ start: flow.gapStart, end: flow.gapEnd });
                              const stops = flow.phase === 'start' ? allStops.slice(0, -1) : allStops.filter((s) => s > flow.start);
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
                                    />
                                    <button
                                      type="button"
                                      disabled={flow.phase === 'end' && flow.end <= flow.start}
                                      onClick={() =>
                                        flow.phase === 'start'
                                          ? setFillFlow({ ...flow, phase: 'end' })
                                          : addGapEntry(dayIdx, label, flow.who, flow.start, flow.end)
                                      }
                                      className="text-sm font-bold bg-emerald-600 border border-emerald-600 text-white px-4 py-2 rounded-full active:bg-emerald-700 disabled:opacity-40"
                                    >
                                      {flow.phase === 'start' ? 'seguir →' : 'OK ✓'}
                                    </button>
                                    <button type="button" onClick={() => setFillFlow(null)} className="text-[11px] text-rose-500 underline">
                                      cancelar
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })
        )}

        {!loading && week && (
          <button
            onClick={deleteWeek}
            className="w-full text-center text-xs text-rose-500 font-medium py-3 active:text-rose-700"
          >
            🗑️ Apagar escala desta semana
          </button>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-3 py-3 flex gap-2 max-w-md mx-auto">
        <button
          onClick={() => setSummaryOpen(true)}
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
        <div className="fixed inset-0 bg-black/40 z-30 flex items-end justify-center" onClick={() => setSettingsOpen(false)}>
          <div
            className="bg-white rounded-t-2xl w-full max-w-md p-4 pb-6 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-slate-800">👥 Acompanhantes sugeridos</h2>
              <button onClick={() => setSettingsOpen(false)} className="text-slate-400 text-xl leading-none px-1">✕</button>
            </div>
            <p className="text-xs text-slate-400 mb-3">Quem aparece como sugestão rápida ao preencher um horário.</p>

            <div className="flex flex-wrap gap-1.5 mb-3">
              {companions.map((n) => (
                <span key={n} className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full flex items-center gap-1">
                  {n}
                  <button onClick={() => removeCompanion(n)} className="text-slate-400 active:text-rose-500">✕</button>
                </span>
              ))}
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

      {summaryOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 flex items-end justify-center" onClick={() => setSummaryOpen(false)}>
          <div
            className="bg-white rounded-t-2xl w-full max-w-md p-4 pb-6 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="font-bold text-slate-800">👁️ Resumo da semana</h2>
              <button onClick={() => setSummaryOpen(false)} className="text-slate-400 text-xl leading-none px-1">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto text-base leading-relaxed text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3">
              {renderWhatsAppPreview(whatsAppText() ?? '')}
            </div>
            <button
              onClick={copyToWhatsApp}
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
