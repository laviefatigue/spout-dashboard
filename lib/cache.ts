import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const CACHE_DIR = path.join(process.cwd(), '.cache');

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

function cacheKey(key: string): string {
  const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
  return hash + '.json';
}

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch {
    // already exists
  }
}

export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const filePath = path.join(CACHE_DIR, cacheKey(key));
    const raw = await fs.readFile(filePath, 'utf-8');
    const entry: CacheEntry<T> = JSON.parse(raw);
    const age = (Date.now() - entry.timestamp) / 1000;
    if (age > entry.ttl) {
      // Expired — delete async, return null
      fs.unlink(filePath).catch(() => {});
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function setCache<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  try {
    await ensureCacheDir();
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds,
    };
    const filePath = path.join(CACHE_DIR, cacheKey(key));
    await fs.writeFile(filePath, JSON.stringify(entry), 'utf-8');
  } catch (err) {
    console.error('[Cache] Write error:', err);
  }
}

export async function clearCache(keyPrefix: string): Promise<void> {
  try {
    const files = await fs.readdir(CACHE_DIR);
    await Promise.all(
      files.map(f => fs.unlink(path.join(CACHE_DIR, f)).catch(() => {}))
    );
  } catch {
    // cache dir may not exist
  }
}
