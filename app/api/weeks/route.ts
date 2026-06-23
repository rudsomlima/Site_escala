import { NextResponse } from 'next/server';
import { listWeekKeys } from '@/lib/store';

export async function GET() {
  const keys = await listWeekKeys();
  keys.sort().reverse();
  return NextResponse.json({ weeks: keys });
}
