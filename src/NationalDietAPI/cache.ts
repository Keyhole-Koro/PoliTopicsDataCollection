import { promises as fs } from 'node:fs';
import path from 'node:path';

const CACHE_ENV_VAR = 'ND_API_HTTP_CACHE_DIR';
const CACHE_BYPASS_ENV_VAR = 'ND_API_HTTP_BYPASS_CACHE';

function getCachePath(url: string): { dir: string; file: string } | null {
  const dir = process.env[CACHE_ENV_VAR];
  if (!dir) {
    return null;
  }
  const safeName = Buffer.from(url).toString('base64url');
  return { dir, file: path.join(dir, `${safeName}.json`) };
}

function shouldBypassCache(): boolean {
  if (process.env[CACHE_BYPASS_ENV_VAR] === '1') {
    delete process.env[CACHE_BYPASS_ENV_VAR];
    return true;
  }
  return false;
}

export async function readCachedPayload(url: string): Promise<unknown | null> {
  if (shouldBypassCache()) {
    console.log(`[NDAPI Cache] bypassed for ${url}`);
    return null;
  }
  const cache = getCachePath(url);
  if (!cache) return null;
  try {
    const raw = await fs.readFile(cache.file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.url === url) {
      console.log(`[NDAPI Cache] hit for ${url}`);
      return parsed.payload;
    }
  } catch {
    return null;
  }
  return null;
}

export async function writeCachedPayload(url: string, payload: unknown): Promise<void> {
  const cache = getCachePath(url);
  if (!cache) return;
  try {
    await fs.mkdir(cache.dir, { recursive: true });
    await fs.writeFile(cache.file, JSON.stringify({ url, payload }), 'utf8');
  } catch {
    // ignore cache write failures
  }
}
