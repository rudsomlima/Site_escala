import { promises as fs } from 'fs';
import path from 'path';

const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

const FILE = path.join(process.cwd(), '.data', 'weeks.json');

async function readFileStore(): Promise<Record<string, any>> {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function writeFileStore(obj: Record<string, any>) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(obj, null, 2));
}

async function redis() {
  const { Redis } = await import('@upstash/redis');
  return Redis.fromEnv();
}

export async function getWeek(key: string): Promise<any | null> {
  if (hasKV) {
    const r = await redis();
    return (await r.get(key)) ?? null;
  }
  const store = await readFileStore();
  return store[key] ?? null;
}

export async function setWeek(key: string, value: any): Promise<void> {
  if (hasKV) {
    const r = await redis();
    await r.set(key, value);
    await r.sadd('weeks:index', key);
    return;
  }
  const store = await readFileStore();
  store[key] = value;
  const index: string[] = store.__index ?? [];
  if (!index.includes(key)) index.push(key);
  store.__index = index;
  await writeFileStore(store);
}

export async function listWeekKeys(): Promise<string[]> {
  if (hasKV) {
    const r = await redis();
    return (await r.smembers('weeks:index')) as string[];
  }
  const store = await readFileStore();
  return store.__index ?? [];
}

const COMPANIONS_KEY = 'settings:companions';

export async function getCompanions(): Promise<string[] | null> {
  if (hasKV) {
    const r = await redis();
    return ((await r.get(COMPANIONS_KEY)) as string[]) ?? null;
  }
  const store = await readFileStore();
  return store[COMPANIONS_KEY] ?? null;
}

export async function setCompanions(names: string[]): Promise<void> {
  if (hasKV) {
    const r = await redis();
    await r.set(COMPANIONS_KEY, names);
    return;
  }
  const store = await readFileStore();
  store[COMPANIONS_KEY] = names;
  await writeFileStore(store);
}

export const isUsingKV = hasKV;
