import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_VERSION = 1;
const INDEX_FILE = 'index.json';

export async function readCache(cacheDir) {
  try {
    const raw = await fs.readFile(path.join(cacheDir, INDEX_FILE), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.version !== CACHE_VERSION) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeCache(cacheDir, index) {
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(
    path.join(cacheDir, INDEX_FILE),
    JSON.stringify({ version: CACHE_VERSION, ...index }, null, 2)
  );
}

export async function clearCache(cacheDir) {
  await fs.rm(cacheDir, { recursive: true, force: true });
}
