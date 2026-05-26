import { clearCache, readCache, writeCache } from '../core/cache.js';
import { loadConfig } from '../core/config.js';
import { buildDashboard, filterSessions } from '../core/analytics.js';
import { indexCodexLogs, readSessionDetail } from '../core/codex-parser.js';
import { resolveTrustedRoots } from '../core/path-safety.js';

export class AppState {
  constructor(options = {}) {
    this.options = options;
    this.config = null;
    this.trustedRoots = [];
    this.rootDiagnostics = [];
    this.index = null;
    this.reloading = null;
  }

  async initialize() {
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

  async reload() {
    if (this.reloading) {
      return this.reloading;
    }

    this.reloading = (async () => {
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

  getSessions(query = {}) {
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

  async getSessionDetail(id) {
    const session = this.index?.sessions?.find((candidate) => candidate.id === id);
    if (!session) {
      return null;
    }
    return readSessionDetail(session, this.trustedRoots);
  }

  getParserCoverage() {
    return this.index?.diagnostics ?? null;
  }

  async clearCache() {
    await clearCache(this.config.cacheDir);
    this.index = null;
  }
}
