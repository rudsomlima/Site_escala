import { promises as fs } from 'fs';
import path from 'path';

const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
// @vercel/blob auto-resolves credentials from either BLOB_READ_WRITE_TOKEN (classic) or
// VERCEL_OIDC_TOKEN + BLOB_STORE_ID (newer OIDC-based store connection) — no explicit token
// needs to be read or passed here either way.
const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN || !!process.env.BLOB_STORE_ID;

const FILE = path.join(process.cwd(), '.data', 'weeks.json');
const BLOB_PATHNAME = 'escala/weeks.json';

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

// Blob storage holds the whole store as a single JSON object, same shape as the local
// file fallback — there's no query/index support, so every read/write moves the full
// document. Fine at this app's scale (a handful of weeks).
async function readBlobStore(): Promise<Record<string, any>> {
  const { head } = await import('@vercel/blob');
  try {
    const meta = await head(BLOB_PATHNAME);
    const res = await fetch(meta.url, { cache: 'no-store' });
    return await res.json();
  } catch {
    return {};
  }
}

async function writeBlobStore(obj: Record<string, any>) {
  const { put } = await import('@vercel/blob');
  await put(BLOB_PATHNAME, JSON.stringify(obj), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
  });
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
  const store = hasBlob ? await readBlobStore() : await readFileStore();
  return store[key] ?? null;
}

export async function setWeek(key: string, value: any): Promise<void> {
  if (hasKV) {
    const r = await redis();
    await r.set(key, value);
    await r.sadd('weeks:index', key);
    return;
  }
  const store = hasBlob ? await readBlobStore() : await readFileStore();
  store[key] = value;
  const index: string[] = store.__index ?? [];
  if (!index.includes(key)) index.push(key);
  store.__index = index;
  if (hasBlob) await writeBlobStore(store);
  else await writeFileStore(store);
}

export async function listWeekKeys(): Promise<string[]> {
  if (hasKV) {
    const r = await redis();
    return (await r.smembers('weeks:index')) as string[];
  }
  const store = hasBlob ? await readBlobStore() : await readFileStore();
  return store.__index ?? [];
}

const COMPANIONS_KEY = 'settings:companions';

export async function getCompanions(): Promise<string[] | null> {
  if (hasKV) {
    const r = await redis();
    return ((await r.get(COMPANIONS_KEY)) as string[]) ?? null;
  }
  const store = hasBlob ? await readBlobStore() : await readFileStore();
  return store[COMPANIONS_KEY] ?? null;
}

export async function setCompanions(names: string[]): Promise<void> {
  if (hasKV) {
    const r = await redis();
    await r.set(COMPANIONS_KEY, names);
    return;
  }
  const store = hasBlob ? await readBlobStore() : await readFileStore();
  store[COMPANIONS_KEY] = names;
  if (hasBlob) await writeBlobStore(store);
  else await writeFileStore(store);
}

export const isUsingKV = hasKV;
export const isUsingBlob = hasBlob;
