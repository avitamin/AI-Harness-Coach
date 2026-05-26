import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodexIndex } from './types.js';

const CACHE_VERSION = 1;
const INDEX_FILE = 'index.json';

export async function readCache(cacheDir: string): Promise<CodexIndex | null> {
  try {
    const raw = await fs.readFile(path.join(cacheDir, INDEX_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION) {
      return null;
    }
    return parsed as CodexIndex;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeCache(cacheDir: string, index: object): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, INDEX_FILE),
    JSON.stringify({ version: CACHE_VERSION, ...index }, null, 2)
  );
}

export async function clearCache(cacheDir: string): Promise<void> {
  await fs.rm(cacheDir, { recursive: true, force: true });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
