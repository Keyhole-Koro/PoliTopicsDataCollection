import { mkdirSync, readFileSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import type { RawMeetingData } from '@NationalDietAPI/Raw';

let cacheFilePath = process.env.NATIONAL_DIET_CACHE_FILE;
let cacheEnabled = Boolean(cacheFilePath);
let responseCache: Map<string, RawMeetingData> | undefined = cacheEnabled ? new Map() : undefined;
let cacheLoaded = false;

function cloneResponse<T>(data: T): T {
  const structuredCloneFn = (globalThis as { structuredClone?: <U>(value: U) => U }).structuredClone;
  if (typeof structuredCloneFn === 'function') {
    return structuredCloneFn(data);
  }
  return JSON.parse(JSON.stringify(data)) as T;
}

export function refreshCacheConfig(): void {
  const latestPath = process.env.NATIONAL_DIET_CACHE_FILE;
  if (latestPath === cacheFilePath) {
    return;
  }
  cacheFilePath = latestPath;
  cacheEnabled = Boolean(cacheFilePath);
  responseCache = cacheEnabled ? new Map() : undefined;
  cacheLoaded = false;
}

export function clearCache(): void {
  refreshCacheConfig();
  if (!cacheEnabled || !responseCache) {
    return;
  }
  responseCache.clear();
  cacheLoaded = false;
  if (cacheFilePath && existsSync(cacheFilePath)) {
    try {
      unlinkSync(cacheFilePath);
    } catch (error) {
      console.warn('Failed to delete National Diet API cache file:', error);
    }
  }
}

function loadCacheFromDisk(): void {
  refreshCacheConfig();
  if (!cacheEnabled || cacheLoaded || !cacheFilePath || !responseCache) {
    cacheLoaded = true;
    return;
  }
  cacheLoaded = true;
  if (!existsSync(cacheFilePath)) {
    return;
  }
  try {
    const raw = readFileSync(cacheFilePath, 'utf8');
    if (!raw) {
      return;
    }
    const data = JSON.parse(raw) as Record<string, RawMeetingData>;
    for (const [key, value] of Object.entries(data)) {
      responseCache.set(key, value);
    }
  } catch (error) {
    console.warn('Failed to load National Diet API cache file:', error);
  }
}

function persistCacheToDisk(): void {
  refreshCacheConfig();
  if (!cacheEnabled || !cacheFilePath || !responseCache) {
    return;
  }
  try {
    const dir = path.dirname(cacheFilePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const serialized = JSON.stringify(Object.fromEntries(responseCache), null, 2);
    writeFileSync(cacheFilePath, serialized, 'utf8');
  } catch (error) {
    console.warn('Failed to persist National Diet API cache file:', error);
  }
}

export function getCachedResponse(url: string): RawMeetingData | undefined {
  if (!cacheEnabled) {
    return undefined;
  }
  loadCacheFromDisk();
  const cached = responseCache?.get(url);
  return cached ? cloneResponse(cached) : undefined;
}

export function storeCachedResponse(url: string, data: RawMeetingData): void {
  if (!cacheEnabled || !responseCache) {
    return;
  }
  responseCache.set(url, cloneResponse(data));
  persistCacheToDisk();
}
