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

    const reload = assertApi(await handleApiRequest(state, 'POST', '/api/reload'), 200);
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
    const cacheFile = path.join(fixture.cacheDir, 'index.json');

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
