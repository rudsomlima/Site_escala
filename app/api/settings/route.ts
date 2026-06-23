import { NextResponse } from 'next/server';
import { getCompanions, setCompanions } from '@/lib/store';
import { FREQUENT_NAMES } from '@/lib/schedule';

export async function GET() {
  const names = await getCompanions();
  return NextResponse.json({ names: names ?? FREQUENT_NAMES });
}

export async function PUT(req: Request) {
  const body = await req.json();
  const names = Array.isArray(body.names) ? body.names.filter((n: unknown) => typeof n === 'string' && n.trim()) : [];
  await setCompanions(names);
  return NextResponse.json({ ok: true });
}
