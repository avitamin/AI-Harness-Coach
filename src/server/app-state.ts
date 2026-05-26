import { clearCache, readCache, writeCache } from '../core/cache.js';
import {
  loadConfig,
  type AppConfig,
  type CodexProfileConfig,
  type LoadConfigOptions
} from '../core/config.js';
import {
  buildAntiPatterns,
  buildDashboard,
  buildOutputTokens,
  filterSessions,
  type SessionQuery
} from '../core/analytics.js';
import { indexCodexLogs, readSessionDetail } from '../core/codex-parser.js';
import { resolveTrustedRoots } from '../core/path-safety.js';
import type { CodexIndex, SessionDetail, SkippedPathDiagnostic } from '../core/types.js';

interface ProfileState {
  profile: CodexProfileConfig;
  trustedRoots: string[];
  rootDiagnostics: SkippedPathDiagnostic[];
  index: CodexIndex | null;
  reloading: Promise<CodexIndex> | null;
  error: string | null;
}

export class AppState {
  options: LoadConfigOptions;
  config: AppConfig | null;
  trustedRoots: string[];
  rootDiagnostics: SkippedPathDiagnostic[];
  index: CodexIndex | null;
  reloading: Promise<CodexIndex> | null;
  profiles: Map<string, ProfileState>;
  defaultProfileId: string;

  constructor(options: LoadConfigOptions = {}) {
    this.options = options;
    this.config = null;
    this.trustedRoots = [];
    this.rootDiagnostics = [];
    this.index = null;
    this.reloading = null;
    this.profiles = new Map();
    this.defaultProfileId = 'default';
  }

  async initialize(): Promise<void> {
    const config = await loadConfig({
      configPath: this.options.configPath,
      cacheDir: this.options.cacheDir,
      roots: this.options.roots
    });
    this.config = config;
    this.defaultProfileId = config.profiles.some((profile) => profile.id === 'default')
      ? 'default'
      : config.profiles[0].id;
    await Promise.all(config.profiles.map((profile) => this.initializeProfile(profile)));
    this.syncLegacyFields(this.getProfile());
  }

  async reload(profileId?: string): Promise<CodexIndex> {
    const profile = this.getProfile(profileId);
    if (profile.reloading) {
      return profile.reloading;
    }

    profile.reloading = (async () => {
      try {
        const index = await indexCodexLogs({
          roots: profile.trustedRoots,
          trustedRoots: profile.trustedRoots
        });
        index.diagnostics.skippedRoots = profile.rootDiagnostics;
        await writeCache(profile.profile.cacheDir, {
          indexedAt: index.indexedAt,
          sessions: index.sessions,
          diagnostics: index.diagnostics
        });
        profile.index = index;
        profile.error = null;
        profile.reloading = null;
        if (profile.profile.id === this.defaultProfileId) {
          this.syncLegacyFields(profile);
        }
        return index;
      } catch (error) {
        profile.error = error instanceof Error ? error.message : String(error);
        profile.reloading = null;
        throw error;
      }
    })();

    return profile.reloading;
  }

  async reloadAll(): Promise<CodexIndex[]> {
    const results = await Promise.allSettled(
      [...this.profiles.keys()].map((profileId) => this.reload(profileId))
    );
    return results
      .filter((result): result is PromiseFulfilledResult<CodexIndex> => result.status === 'fulfilled')
      .map((result) => result.value);
  }

  getProfiles() {
    return {
      activeProfileId: this.defaultProfileId,
      profiles: [...this.profiles.values()].map((profile) => ({
        id: profile.profile.id,
        name: profile.profile.name,
        ready: Boolean(profile.index),
        reloading: Boolean(profile.reloading),
        indexedAt: profile.index?.indexedAt ?? null,
        sessionCount: profile.index?.sessions?.length ?? 0,
        roots: profile.trustedRoots,
        skippedRoots: profile.rootDiagnostics,
        error: profile.error
      }))
    };
  }

  getStatus(profileId?: string) {
    const profile = this.getProfile(profileId);
    return {
      profileId: profile.profile.id,
      profileName: profile.profile.name,
      ready: Boolean(profile.index),
      reloading: Boolean(profile.reloading),
      indexedAt: profile.index?.indexedAt ?? null,
      sessionCount: profile.index?.sessions?.length ?? 0,
      cacheDir: profile.profile.cacheDir,
      roots: profile.trustedRoots,
      skippedRoots: profile.rootDiagnostics,
      error: profile.error
    };
  }

  getDashboard(profileId?: string) {
    return buildDashboard(this.getProfile(profileId).index?.sessions ?? []);
  }

  getSessions(query: SessionQuery = {}, profileId?: string) {
    const sessions = filterSessions(this.getProfile(profileId).index?.sessions ?? [], query);
    const limit = Math.max(1, Math.min(Number(query.limit ?? 50), 200));
    const offset = Math.max(0, Number(query.offset ?? 0));
    return {
      total: sessions.length,
      offset,
      limit,
      sessions: sessions.slice(offset, offset + limit)
    };
  }

  async getSessionDetail(id: string, profileId?: string): Promise<SessionDetail | null> {
    const profile = this.getProfile(profileId);
    const session = profile.index?.sessions?.find((candidate) => candidate.id === id);
    if (!session) {
      return null;
    }
    return readSessionDetail(session, profile.trustedRoots);
  }

  getParserCoverage(profileId?: string) {
    const profile = this.getProfile(profileId);
    if (!profile.index?.diagnostics) {
      return {
        roots: profile.trustedRoots,
        filesSeen: 0,
        filesParsed: 0,
        skippedFiles: [],
        invalidJsonLines: [],
        unsupportedEventCounts: {},
        missingTokenCoverageSessions: 0,
        warnings: profile.error ? [profile.error] : [],
        skippedRoots: profile.rootDiagnostics
      };
    }
    return profile.index.diagnostics;
  }

  getOutputTokens(profileId?: string) {
    return buildOutputTokens(this.getProfile(profileId).index?.sessions ?? []);
  }

  getAntiPatterns(profileId?: string) {
    return buildAntiPatterns(this.getProfile(profileId).index?.sessions ?? []);
  }

  async clearCache(profileId?: string): Promise<void> {
    const profile = this.getProfile(profileId);
    await clearCache(profile.profile.cacheDir);
    profile.index = null;
    if (profile.profile.id === this.defaultProfileId) {
      this.syncLegacyFields(profile);
    }
  }

  private async initializeProfile(profileConfig: CodexProfileConfig): Promise<void> {
    const profile: ProfileState = {
      profile: profileConfig,
      trustedRoots: [],
      rootDiagnostics: [],
      index: null,
      reloading: null,
      error: null
    };
    this.profiles.set(profileConfig.id, profile);

    try {
      const resolved = await resolveTrustedRoots(profileConfig.roots);
      profile.trustedRoots = resolved.trustedRoots;
      profile.rootDiagnostics = resolved.skippedRoots;
      profile.index = await readCache(profile.profile.cacheDir);
      if (!profile.index) {
        await this.reload(profile.profile.id);
      }
    } catch (error) {
      profile.error = error instanceof Error ? error.message : String(error);
    }
  }

  private getProfile(profileId?: string): ProfileState {
    const id = profileId || this.defaultProfileId;
    const profile = this.profiles.get(id);
    if (!profile) {
      throw new UnknownProfileError(id);
    }
    return profile;
  }

  private syncLegacyFields(profile: ProfileState): void {
    this.trustedRoots = profile.trustedRoots;
    this.rootDiagnostics = profile.rootDiagnostics;
    this.index = profile.index;
    this.reloading = profile.reloading;
  }
}

export class UnknownProfileError extends Error {
  constructor(profileId: string) {
    super(`Unknown profile: ${profileId}`);
    this.name = 'UnknownProfileError';
  }
}
