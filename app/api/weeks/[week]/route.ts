import { NextRequest, NextResponse } from 'next/server';
import { getWeek, setWeek } from '@/lib/store';
import { emptyWeek, seedWeek, SEED_WEEK_KEY } from '@/lib/schedule';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { week: key } = await params;
  const existing = await getWeek(key);
  if (existing) return NextResponse.json(existing);
  const fresh = key === SEED_WEEK_KEY ? seedWeek(key) : emptyWeek(key);
  return NextResponse.json(fresh);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ week: string }> }) {
  const { week: key } = await params;
  const body = await req.json();
  await setWeek(key, body);
  return NextResponse.json({ ok: true });
}
