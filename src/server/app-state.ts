import { clearCache, readCache, writeCache } from '../core/cache.js';
import { loadConfig, type AppConfig, type LoadConfigOptions } from '../core/config.js';
import { buildDashboard, filterSessions, type SessionQuery } from '../core/analytics.js';
import { indexCodexLogs, readSessionDetail } from '../core/codex-parser.js';
import { resolveTrustedRoots } from '../core/path-safety.js';
import type { CodexIndex, SessionDetail, SkippedPathDiagnostic } from '../core/types.js';

export class AppState {
  options: LoadConfigOptions;
  config: AppConfig | null;
  trustedRoots: string[];
  rootDiagnostics: SkippedPathDiagnostic[];
  index: CodexIndex | null;
  reloading: Promise<CodexIndex> | null;

  constructor(options: LoadConfigOptions = {}) {
    this.options = options;
    this.config = null;
    this.trustedRoots = [];
    this.rootDiagnostics = [];
    this.index = null;
    this.reloading = null;
  }

  async initialize(): Promise<void> {
    this.config = await loadConfig({
      configPath: this.options.configPath,
      cacheDir: this.options.cacheDir,
      roots: this.options.roots
    });
    const resolved = await resolveTrustedRoots(this.config.roots);
    this.trustedRoots = resolved.trustedRoots;
    this.rootDiagnostics = resolved.skippedRoots;
    this.index = await readCache(this.config.cacheDir);
    if (!this.index) {
      await this.reload();
    }
  }

  async reload(): Promise<CodexIndex> {
    if (this.reloading) {
      return this.reloading;
    }

    this.reloading = (async () => {
      if (!this.config) {
        throw new Error('AppState has not been initialized.');
      }
      const index = await indexCodexLogs({
        roots: this.trustedRoots,
        trustedRoots: this.trustedRoots
      });
      index.diagnostics.skippedRoots = this.rootDiagnostics;
      await writeCache(this.config.cacheDir, {
        indexedAt: index.indexedAt,
        sessions: index.sessions,
        diagnostics: index.diagnostics
      });
      this.index = index;
      this.reloading = null;
      return index;
    })();

    return this.reloading;
  }

  getStatus() {
    return {
      ready: Boolean(this.index),
      reloading: Boolean(this.reloading),
      indexedAt: this.index?.indexedAt ?? null,
      sessionCount: this.index?.sessions?.length ?? 0,
      cacheDir: this.config?.cacheDir ?? null,
      roots: this.trustedRoots,
      skippedRoots: this.rootDiagnostics
    };
  }

  getDashboard() {
    return buildDashboard(this.index?.sessions ?? []);
  }

  getSessions(query: SessionQuery = {}) {
    const sessions = filterSessions(this.index?.sessions ?? [], query);
    const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 200));
    const offset = Math.max(0, Number(query.offset ?? 0));
    return {
      total: sessions.length,
      offset,
      limit,
      sessions: sessions.slice(offset, offset + limit)
    };
  }

  async getSessionDetail(id: string): Promise<SessionDetail | null> {
    const session = this.index?.sessions?.find((candidate) => candidate.id === id);
    if (!session) {
      return null;
    }
    return readSessionDetail(session, this.trustedRoots);
  }

  getParserCoverage() {
    return this.index?.diagnostics ?? null;
  }

  async clearCache(): Promise<void> {
    if (!this.config) {
      throw new Error('AppState has not been initialized.');
    }
    await clearCache(this.config.cacheDir);
    this.index = null;
  }
}
