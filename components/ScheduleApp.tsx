'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Day,
  Entry,
  FREQUENT_NAMES,
  SHIFT_LABELS,
  ShiftLabel,
  Week,
  addDays,
  dayIsComplete,
  emptyWeek,
  fmtBR,
  fmtMin,
  gapsForDayShift,
  isoDate,
  mondayOf,
  parseIso,
  toMin,
  weekToWhatsApp,
  DAY_NAMES,
} from '@/lib/schedule';

function newId() {
  return Math.random().toString(36).slice(2);
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

  function setEntryWho(dayIdx: number, label: ShiftLabel, entryId: string, who: string) {
    updateDay(dayIdx, (day) => {
      const entry = day.shifts[label].find((e) => e.id === entryId);
      if (entry) entry.who = who;
    });
    setWhoPicker(null);
  }

  function confirmEntryTime(dayIdx: number, label: ShiftLabel, entryId: string, start: number, end: number) {
    updateDay(dayIdx, (day) => {
      const entry = day.shifts[label].find((e) => e.id === entryId);
      if (entry) {
        entry.start = fmtMin(start);
        entry.end = fmtMin(end);
      }
    });
    setEditFlow(null);
  }

  function removeEntry(dayIdx: number, label: ShiftLabel, entryId: string) {
    updateDay(dayIdx, (day) => {
      day.shifts[label] = day.shifts[label].filter((e) => e.id !== entryId);
    });
    if (whoPicker?.entryId === entryId) setWhoPicker(null);
    if (editFlow?.entryId === entryId) setEditFlow(null);
  }

  function copyToWhatsApp() {
    if (!week) return;
    const prevSundayNoite = prevWeek?.days[6]?.shifts['Noite'];
    navigator.clipboard.writeText(weekToWhatsApp(week, prevSundayNoite)).then(() => showToast('Copiado! Cole no WhatsApp 📲'));
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
        <div className="flex items-center justify-between mt-1">
          <button onClick={() => goWeek(-1)} className="text-indigo-100 active:text-white px-2 -ml-2 text-lg" aria-label="Semana anterior">‹</button>
          <p className="text-indigo-100 text-sm">
            Semana de {fmtBR(monday)} {isCurrentWeek && <span className="ml-1 bg-white/20 px-2 py-0.5 rounded-full text-[10px] align-middle">ATUAL</span>}
          </p>
          <button onClick={() => goWeek(1)} className="text-indigo-100 active:text-white px-2 -mr-2 text-lg" aria-label="Próxima semana">›</button>
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
                    const entries = day.shifts[label];
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
                                  className="text-xs text-slate-500 px-2 py-1 rounded-full bg-white border border-slate-200 active:bg-slate-100"
                                >
                                  {entry.start || '--:--'} – {entry.end || '--:--'}
                                </button>
                                <button
                                  onClick={() => removeEntry(dayIdx, label, entry.id)}
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
                                      onClick={() => setEntryWho(dayIdx, label, entry.id, n)}
                                      className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full active:bg-indigo-200"
                                    >
                                      {n}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {isEditingTime && (
                                <div className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap items-center gap-2">
                                  <span className="text-[11px] text-slate-400">{editFlow.phase === 'start' ? 'início' : 'fim'}</span>
                                  <StepperBadge
                                    color={editFlow.phase === 'start' ? 'indigo' : 'sky'}
                                    value={editFlow.phase === 'start' ? editFlow.start : editFlow.end}
                                    onChange={(v) => setEditFlow({ ...editFlow, [editFlow.phase]: v })}
                                  />
                                  <button
                                    type="button"
                                    disabled={editFlow.phase === 'end' && editFlow.end <= editFlow.start}
                                    onClick={() =>
                                      editFlow.phase === 'start'
                                        ? setEditFlow({ ...editFlow, phase: 'end' })
                                        : confirmEntryTime(dayIdx, label, entry.id, editFlow.start, editFlow.end)
                                    }
                                    className="text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-full active:bg-emerald-100 disabled:opacity-40"
                                  >
                                    {editFlow.phase === 'start' ? 'seguir →' : 'OK ✓'}
                                  </button>
                                  <button type="button" onClick={() => setEditFlow(null)} className="text-[11px] text-rose-500 underline">
                                    cancelar
                                  </button>
                                </div>
                              )}
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

                              return (
                                <div key={gap.start} className="flex flex-wrap items-center gap-2 bg-slate-50 rounded-lg px-2 py-1.5">
                                  <span className="font-medium text-slate-800 text-sm">{flow.who}</span>
                                  <span className="text-[11px] text-slate-400">{flow.phase === 'start' ? 'início' : 'fim'}</span>
                                  <StepperBadge
                                    color={flow.phase === 'start' ? 'indigo' : 'sky'}
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
                                    className="text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 px-2.5 py-1 rounded-full active:bg-emerald-100 disabled:opacity-40"
                                  >
                                    {flow.phase === 'start' ? 'seguir →' : 'OK ✓'}
                                  </button>
                                  <button type="button" onClick={() => setFillFlow(null)} className="text-[11px] text-rose-500 underline">
                                    cancelar
                                  </button>
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
    </div>
  );
}
