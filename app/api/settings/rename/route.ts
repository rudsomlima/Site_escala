import { NextResponse } from 'next/server';
import { getCompanions, setCompanions, getWeek, setWeek, listWeekKeys } from '@/lib/store';
import { renameWho, Week } from '@/lib/schedule';

// Renaming a companion updates the suggestions list AND every entry that already used the
// old name, across every saved week — not just the one currently open. Weeks are processed
// sequentially (one getWeek/setWeek pair at a time, not in parallel): the Blob/file store
// backends do a whole-document read-modify-write per call, so concurrent writes risk one
// clobbering another (same reasoning as scheduleSave's onSaved chaining on the client).
export async function POST(req: Request) {
  const body = await req.json();
  const oldName = typeof body.oldName === 'string' ? body.oldName.trim() : '';
  const newName = typeof body.newName === 'string' ? body.newName.trim() : '';
  if (!oldName || !newName || oldName === newName) {
    return NextResponse.json({ ok: false, error: 'invalid names' }, { status: 400 });
  }

  const companions = await getCompanions();
  if (companions) {
    const renamed = companions.map((n) => (n === oldName ? newName : n));
    await setCompanions(Array.from(new Set(renamed)));
  }

  const keys = await listWeekKeys();
  let weeksUpdated = 0;
  for (const key of keys) {
    const data = await getWeek(key);
    if (!data) continue;
    const { week, changed } = renameWho(data as Week, oldName, newName);
    if (changed) {
      await setWeek(key, week);
      weeksUpdated++;
    }
  }

  return NextResponse.json({ ok: true, weeksUpdated });
}
