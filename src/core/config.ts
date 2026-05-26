import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CODEX_ROOTS = [
  '~/.codex/sessions',
  '~/.codex/archived_sessions',
  '~/.codex/archived-sessions'
];

export interface LoadConfigOptions {
  configPath?: string;
  cacheDir?: string;
  roots?: string[];
}

export interface CodexProfileConfig {
  id: string;
  name: string;
  roots: string[];
  cacheDir: string;
}

export interface AppConfig {
  configPath: string;
  cacheDir: string;
  roots: string[];
  profiles: CodexProfileConfig[];
}

interface FileConfig {
  additionalRoots?: string[];
  cacheDir?: string;
  profiles?: FileProfileConfig[];
}

interface FileProfileConfig {
  id?: string;
  name?: string;
  roots?: string[];
}

export function expandHome(input: string): string;
export function expandHome(input: undefined): undefined;
export function expandHome(input: string | undefined): string | undefined {
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

export function defaultConfigPath(): string {
  return process.env.AHC_CONFIG
    ? expandHome(process.env.AHC_CONFIG)
    : path.join(os.homedir(), '.ai-harness-coach', 'config.json');
}

export function defaultCacheDir(): string {
  return process.env.AHC_CACHE_DIR
    ? expandHome(process.env.AHC_CACHE_DIR)
    : path.join(os.homedir(), '.cache', 'ai-harness-coach');
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<AppConfig> {
  const configPath = options.configPath ? expandHome(options.configPath) : defaultConfigPath();
  let fileConfig: FileConfig = {};

  try {
    const raw = await fs.readFile(configPath, 'utf8');
    fileConfig = JSON.parse(raw) as FileConfig;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read config ${configPath}: ${message}`);
    }
  }

  const additionalRoots = Array.isArray(fileConfig.additionalRoots)
    ? fileConfig.additionalRoots
    : [];
  const configuredRoots = Array.isArray(options.roots)
    ? options.roots
    : [...DEFAULT_CODEX_ROOTS, ...additionalRoots];
  const cacheDir = path.resolve(expandHome(options.cacheDir ?? fileConfig.cacheDir ?? defaultCacheDir()));
  const roots = configuredRoots.map((root) => path.resolve(expandHome(root)));
  const profiles = Array.isArray(options.roots)
    ? [profileConfig('default', 'Default Codex', roots, cacheDir)]
    : buildProfiles(fileConfig, roots, cacheDir);

  return {
    configPath,
    cacheDir,
    roots,
    profiles
  };
}

function buildProfiles(
  fileConfig: FileConfig,
  defaultRoots: string[],
  cacheDir: string
): CodexProfileConfig[] {
  if (!Array.isArray(fileConfig.profiles) || fileConfig.profiles.length === 0) {
    return [profileConfig('default', 'Default Codex', defaultRoots, cacheDir)];
  }

  const seen = new Set<string>();
  return fileConfig.profiles.map((profile, index) => {
    const id = sanitizeProfileId(profile.id ?? `profile-${index + 1}`);
    if (seen.has(id)) {
      throw new Error(`Duplicate profile id in config: ${id}`);
    }
    seen.add(id);
    const roots = Array.isArray(profile.roots) ? profile.roots : [];
    if (roots.length === 0) {
      throw new Error(`Profile ${id} must include at least one root.`);
    }
    return profileConfig(
      id,
      profile.name || id,
      roots.map((root) => path.resolve(expandHome(root))),
      cacheDir
    );
  });
}

function profileConfig(
  id: string,
  name: string,
  roots: string[],
  cacheDir: string
): CodexProfileConfig {
  return {
    id,
    name,
    roots,
    cacheDir: path.join(cacheDir, 'profiles', id)
  };
}

function sanitizeProfileId(id: string): string {
  const normalized = id.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
    throw new Error(`Invalid profile id in config: ${id}`);
  }
  return normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
