import { NextResponse } from 'next/server';
import { getCompanions, setCompanions, getShiftRate, setShiftRate } from '@/lib/store';
import { FREQUENT_NAMES, DEFAULT_SHIFT_RATE } from '@/lib/schedule';

export async function GET() {
  const [names, shiftRate] = await Promise.all([getCompanions(), getShiftRate()]);
  return NextResponse.json({ names: names ?? FREQUENT_NAMES, shiftRate: shiftRate ?? DEFAULT_SHIFT_RATE });
}

export async function PUT(req: Request) {
  const body = await req.json();
  if (Array.isArray(body.names)) {
    const names = body.names.filter((n: unknown) => typeof n === 'string' && n.trim());
    await setCompanions(names);
  }
  if (typeof body.shiftRate === 'number' && body.shiftRate > 0) {
    await setShiftRate(body.shiftRate);
  }
  return NextResponse.json({ ok: true });
}
