import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CODEX_ROOTS = [
  '~/.codex/sessions',
  '~/.codex/archived_sessions',
  '~/.codex/archived-sessions'
];

export function expandHome(input) {
  if (!input || typeof input !== 'string') {
    return input;
  }
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

export function defaultConfigPath() {
  return process.env.AHC_CONFIG
    ? expandHome(process.env.AHC_CONFIG)
    : path.join(os.homedir(), '.ai-harness-coach', 'config.json');
}

export function defaultCacheDir() {
  return process.env.AHC_CACHE_DIR
    ? expandHome(process.env.AHC_CACHE_DIR)
    : path.join(os.homedir(), '.cache', 'ai-harness-coach');
}

export async function loadConfig(options = {}) {
  const configPath = options.configPath ? expandHome(options.configPath) : defaultConfigPath();
  let fileConfig = {};

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    fileConfig = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to read config ${configPath}: ${error.message}`);
    }
  }

  const additionalRoots = Array.isArray(fileConfig.additionalRoots)
    ? fileConfig.additionalRoots
    : [];
  const configuredRoots = Array.isArray(options.roots)
    ? options.roots
    : [...DEFAULT_CODEX_ROOTS, ...additionalRoots];

  return {
    configPath,
    cacheDir: path.resolve(expandHome(options.cacheDir ?? fileConfig.cacheDir ?? defaultCacheDir())),
    roots: configuredRoots.map((root) => path.resolve(expandHome(root)))
  };
}
