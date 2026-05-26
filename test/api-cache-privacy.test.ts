import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { readCache, writeCache } from '../src/core/cache.js';
import { loadConfig } from '../src/core/config.js';
import { AppState } from '../src/server/app-state.js';
import { handleApiRequest } from '../src/server/http-app.js';
import { resolveLoopbackHost } from '../src/server/loopback.js';

describe('API, cache, and privacy behavior', () => {
  it('serves core API endpoints with filters and on-demand detail reads', async () => {
    const fixture = await createFixtureWorkspace();
    const state = await createFixtureState(fixture);

    assertApi(await handleApiRequest(state, 'GET', '/api/health'), 200);

    const reload = assertApi(await handleApiRequest(state, 'POST', '/api/reload?profile=default'), 200);
    assert.equal(reload.sessionCount, 3);

    const status = assertApi(await handleApiRequest(state, 'GET', '/api/index/status'), 200);
    assert.equal(status.ready, true);
    assert.equal(status.sessionCount, 3);

    const dashboard = assertApi(await handleApiRequest(state, 'GET', '/api/dashboard'), 200);
    assert.equal(dashboard.totals.sessions, 3);
    assert.equal(dashboard.totals.tokenTotals.total, 111);

    const filtered = assertApi(
      await handleApiRequest(
        state,
        'GET',
        '/api/sessions?workspace=/tmp/work-api&model=gpt-5&status=complete&from=2026-05-20&to=2026-05-21'
      ),
      200
    );
    assert.equal(filtered.total, 1);
    assert.equal(filtered.sessions[0].id, 'api-complete');

    const searched = assertApi(
      await handleApiRequest(state, 'GET', '/api/sessions?search=incomplete&limit=1&offset=0'),
      200
    );
    assert.equal(searched.total, 1);
    assert.equal(searched.limit, 1);
    assert.equal(searched.sessions[0].id, 'api-incomplete');

    const detail = assertApi(
      await handleApiRequest(state, 'GET', '/api/sessions/api-complete'),
      200
    );
    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].text, 'API detail text should stay out of cache');

    const coverage = assertApi(await handleApiRequest(state, 'GET', '/api/parser-coverage'), 200);
    assert.equal(coverage.invalidJsonLines.length, 1);
    assert.equal(coverage.unsupportedEventCounts.future_event, 1);
    assert.equal(coverage.missingTokenCoverageSessions, 2);

    const output = assertApi(await handleApiRequest(state, 'GET', '/api/output-tokens'), 200);
    assert.equal(output.byModel.find((entry) => entry.model === 'gpt-5').tokens.total, 111);

    const patterns = assertApi(await handleApiRequest(state, 'GET', '/api/anti-patterns'), 200);
    assert.equal(patterns.findings.some((finding) => finding.type === 'incomplete_session'), true);

    const missing = await handleApiRequest(state, 'GET', '/api/sessions/missing');
    assert.equal(missing.status, 404);
  });

  it('clears derived cache and does not persist raw prompt or response text', async () => {
    const fixture = await createFixtureWorkspace();
    const state = await createFixtureState(fixture);
    const cacheFile = defaultProfileCacheFile(fixture.cacheDir);

    const cachedBeforeDetail = await fs.readFile(cacheFile, 'utf8');
    assert.equal(cachedBeforeDetail.includes('API detail text should stay out of cache'), false);

    assertApi(await handleApiRequest(state, 'GET', '/api/sessions/api-complete'), 200);
    const cachedAfterDetail = await fs.readFile(cacheFile, 'utf8');
    assert.equal(cachedAfterDetail.includes('API detail text should stay out of cache'), false);

    assertApi(await handleApiRequest(state, 'POST', '/api/cache/clear'), 200);
    await assert.rejects(fs.stat(cacheFile), /ENOENT/);
    assert.equal(state.getStatus().ready, false);
  });

  it('loads a valid derived cache without reindexing source logs', async () => {
    const fixture = await createFixtureWorkspace();
    const initialState = await createFixtureState(fixture);
    assert.equal(initialState.getStatus().sessionCount, 3);

    await fs.rm(fixture.root, { recursive: true, force: true });
    const cachedState = new AppState({
      roots: [fixture.root],
      cacheDir: fixture.cacheDir
    });
    await cachedState.initialize();

    assert.equal(cachedState.getStatus().ready, true);
    assert.equal(cachedState.getStatus().sessionCount, 3);
    assert.equal(cachedState.getParserCoverage().filesParsed, 3);
    assert.deepEqual(cachedState.getStatus().skippedRoots.map((entry) => entry.reason), ['missing']);
  });

  it('invalidates stale cache versions', async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-cache-version-'));
    await writeCache(cacheDir, {
      indexedAt: '2026-05-20T00:00:00.000Z',
      sessions: [],
      diagnostics: {}
    });
    const cacheFile = path.join(cacheDir, 'index.json');
    const raw = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    raw.version = -1;
    await fs.writeFile(cacheFile, JSON.stringify(raw));

    assert.equal(await readCache(cacheDir), null);
  });

  it('loads additional read-only roots from config and rejects non-loopback hosts', async () => {
    const fixture = await createFixtureWorkspace();
    const configPath = path.join(fixture.base, 'config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ additionalRoots: [fixture.root], cacheDir: fixture.cacheDir })
    );

    const config = await loadConfig({ configPath });
    assert.equal(config.roots.includes(fixture.root), true);
    assert.equal(resolveLoopbackHost('127.0.0.1'), '127.0.0.1');
    assert.equal(resolveLoopbackHost('localhost'), 'localhost');
    assert.throws(() => resolveLoopbackHost('0.0.0.0'), /non-loopback/);
  });

  it('loads configured profiles, isolates caches, and routes API requests by profile', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-profiles-'));
    const workRoot = path.join(base, 'work-logs');
    const personalRoot = path.join(base, 'personal-logs');
    const cacheDir = path.join(base, 'cache');
    const configPath = path.join(base, 'config.json');
    await fs.mkdir(workRoot, { recursive: true });
    await fs.mkdir(personalRoot, { recursive: true });
    await writeSession(workRoot, 'work-session', '/tmp/work-profile', 'gpt-5');
    await writeSession(personalRoot, 'personal-session', '/tmp/personal-profile', 'gpt-5-mini');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profiles: [
          { id: 'work', name: 'Work Codex', roots: [workRoot] },
          { id: 'personal', name: 'Personal Codex', roots: [personalRoot] }
        ],
        cacheDir
      })
    );

    const config = await loadConfig({ configPath });
    assert.deepEqual(
      config.profiles.map((profile) => profile.id),
      ['work', 'personal']
    );
    assert.deepEqual(config.roots, [workRoot]);
    assert.equal(config.profiles[0].cacheDir, path.join(cacheDir, 'profiles', 'work'));

    const state = new AppState({ configPath });
    await state.initialize();

    const profiles = assertApi(await handleApiRequest(state, 'GET', '/api/profiles'), 200);
    assert.equal(profiles.activeProfileId, 'work');
    assert.deepEqual(
      profiles.profiles.map((profile) => [profile.id, profile.sessionCount]),
      [
        ['work', 1],
        ['personal', 1]
      ]
    );

    const workDashboard = assertApi(
      await handleApiRequest(state, 'GET', '/api/dashboard?profile=work'),
      200
    );
    const personalDashboard = assertApi(
      await handleApiRequest(state, 'GET', '/api/dashboard?profile=personal'),
      200
    );
    assert.equal(workDashboard.recentActivity[0].id, 'work-session');
    assert.equal(personalDashboard.recentActivity[0].id, 'personal-session');

    const personalDetail = assertApi(
      await handleApiRequest(state, 'GET', '/api/sessions/personal-session?profile=personal'),
      200
    );
    assert.equal(personalDetail.workspace, '/tmp/personal-profile');

    const unknown = await handleApiRequest(state, 'GET', '/api/dashboard?profile=missing');
    assert.equal(unknown.status, 404);

    await fs.stat(path.join(cacheDir, 'profiles', 'work', 'index.json'));
    await fs.stat(path.join(cacheDir, 'profiles', 'personal', 'index.json'));
  });

  it('keeps startup alive when a profile cannot write its derived cache', async () => {
    const fixture = await createFixtureWorkspace();
    const cacheFilePath = path.join(fixture.base, 'cache-as-file');
    await fs.writeFile(cacheFilePath, 'not a directory');
    const state = new AppState({
      roots: [fixture.root],
      cacheDir: cacheFilePath
    });

    await state.initialize();

    const profiles = state.getProfiles();
    assert.equal(profiles.profiles[0].id, 'default');
    assert.equal(profiles.profiles[0].ready, false);
    assert.match(profiles.profiles[0].error, /ENOTDIR/);
  });

  it('reports reload-all partial failures through per-profile errors', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-reload-all-'));
    const okRoot = path.join(base, 'ok-logs');
    const brokenRoot = path.join(base, 'broken-logs');
    const cacheDir = path.join(base, 'cache');
    const configPath = path.join(base, 'config.json');
    await fs.mkdir(okRoot, { recursive: true });
    await fs.mkdir(brokenRoot, { recursive: true });
    await fs.mkdir(path.join(cacheDir, 'profiles'), { recursive: true });
    await fs.writeFile(path.join(cacheDir, 'profiles', 'broken'), 'not a directory');
    await writeSession(okRoot, 'ok-session', '/tmp/ok-profile', 'gpt-5');
    await writeSession(brokenRoot, 'broken-session', '/tmp/broken-profile', 'gpt-5-mini');
    await fs.writeFile(
      configPath,
      JSON.stringify({
        profiles: [
          { id: 'ok', name: 'OK Codex', roots: [okRoot] },
          { id: 'broken', name: 'Broken Codex', roots: [brokenRoot] }
        ],
        cacheDir
      })
    );

    const state = new AppState({ configPath });
    await state.initialize();

    const reload = assertApi(await handleApiRequest(state, 'POST', '/api/reload'), 200);
    assert.equal(reload.profileCount, 1);
    assert.equal(
      reload.profiles.find((profile) => profile.id === 'ok').error,
      null
    );
    assert.match(
      reload.profiles.find((profile) => profile.id === 'broken').error,
      /EEXIST|ENOTDIR/
    );
  });

  it('does not modify source Codex JSONL files during reload or detail reads', async () => {
    const fixture = await createFixtureWorkspace();
    const sourceFile = path.join(fixture.root, 'api-complete.jsonl');
    const before = await fs.stat(sourceFile);
    const state = await createFixtureState(fixture);

    await state.reload();
    await handleApiRequest(state, 'GET', '/api/sessions/api-complete');

    const after = await fs.stat(sourceFile);
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  });
});

function assertApi(response, status) {
  assert.equal(response.status, status);
  return response.body;
}

async function createFixtureState(fixture) {
  const state = new AppState({
    roots: [fixture.root],
    cacheDir: fixture.cacheDir
  });
  await state.initialize();
  return state;
}

function defaultProfileCacheFile(cacheDir) {
  return path.join(cacheDir, 'profiles', 'default', 'index.json');
}

async function writeSession(root, id, workspace, model) {
  await fs.writeFile(
    path.join(root, `${id}.jsonl`),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-24T10:00:00.000Z',
        payload: { id, cwd: workspace, model }
      }),
      JSON.stringify({
        type: 'user_message',
        timestamp: '2026-05-24T10:01:00.000Z',
        payload: { role: 'user', content: `hello from ${id}` }
      }),
      JSON.stringify({
        type: 'assistant_message',
        timestamp: '2026-05-24T10:02:00.000Z',
        payload: { role: 'assistant', content: `done ${id}` }
      })
    ].join('\n')
  );
}

async function createFixtureWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-api-'));
  const root = path.join(base, 'logs');
  const cacheDir = path.join(base, 'cache');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'api-complete.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-20T10:00:00.000Z',
        payload: { id: 'api-complete', cwd: '/tmp/work-api', model: 'gpt-5' }
      }),
      JSON.stringify({
        type: 'user_message',
        timestamp: '2026-05-20T10:01:00.000Z',
        payload: { role: 'user', content: 'API detail text should stay out of cache' }
      }),
      JSON.stringify({
        type: 'assistant_message',
        timestamp: '2026-05-20T10:02:00.000Z',
        payload: { role: 'assistant', content: 'Only load this response on demand' }
      }),
      JSON.stringify({
        type: 'token_count',
        timestamp: '2026-05-20T10:03:00.000Z',
        usage: { input_tokens: 70, output_tokens: 41, total_tokens: 111 }
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-05-20T10:04:00.000Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test', path: 'src/core/analytics.js' })
        }
      })
    ].join('\n')
  );
  await fs.writeFile(
    path.join(root, 'api-incomplete.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-22T10:00:00.000Z',
        payload: { id: 'api-incomplete', cwd: '/tmp/work-api', model: 'gpt-5-mini' }
      }),
      JSON.stringify({
        type: 'user_message',
        timestamp: '2026-05-22T10:01:00.000Z',
        payload: { role: 'user', content: 'no assistant response' }
      }),
      JSON.stringify({
        type: 'future_event',
        timestamp: '2026-05-22T10:02:00.000Z',
        payload: { ok: true }
      })
    ].join('\n')
  );
  await fs.writeFile(
    path.join(root, 'api-invalid.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-23T10:00:00.000Z',
        payload: { id: 'api-invalid', cwd: '/tmp/work-other', model: 'gpt-5-mini' }
      }),
      'not json'
    ].join('\n')
  );
  return { base, root, cacheDir };
}
