import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildDashboard, filterSessions } from '../src/core/analytics.js';
import { indexCodexLogs, readSessionDetail } from '../src/core/codex-parser.js';
import { resolveTrustedRoots } from '../src/core/path-safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(__dirname, 'fixtures', 'codex');

describe('Codex parser', () => {
  it('streams JSONL sessions into derived analytics without raw message cache', async () => {
    const { trustedRoots } = await resolveTrustedRoots([fixtureRoot]);
    const index = await indexCodexLogs({ roots: trustedRoots, trustedRoots });

    assert.equal(index.sessions.length, 2);
    assert.equal(index.diagnostics.filesParsed, 2);
    assert.equal(index.diagnostics.invalidJsonLines.length, 1);
    assert.equal(index.diagnostics.unsupportedEventCounts.mystery_new_event, 1);

    const session = index.sessions.find((candidate) => candidate.id === 'session-basic');
    assert.equal(session.workspace, '/work/repo');
    assert.deepEqual(session.models, ['gpt-5']);
    assert.equal(session.tokenTotals.total, 310);
    assert.equal(session.tokenTotals.reasoningOutput, 10);
    assert.equal(session.tools.includes('apply_patch'), true);
    assert.equal(session.editedFiles.includes('src/app.js'), true);
    assert.equal(JSON.stringify(session).includes('Implement a small fix'), false);
  });

  it('loads raw text only for an explicit detail request', async () => {
    const { trustedRoots } = await resolveTrustedRoots([fixtureRoot]);
    const index = await indexCodexLogs({ roots: trustedRoots, trustedRoots });
    const session = index.sessions.find((candidate) => candidate.id === 'session-basic');
    const detail = await readSessionDetail(session, trustedRoots);

    assert.equal(detail.messages.length, 2);
    assert.equal(detail.messages[0].text, 'Implement a small fix');
  });

  it('covers archived, large, aborted, reasoning, model-switch, and duplicate-message sessions', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-parser-'));
    const archivedRoot = path.join(root, 'archived', '2026', '05');
    await fs.mkdir(archivedRoot, { recursive: true });
    const repeatedLines = Array.from({ length: 150 }, (_, index) =>
      JSON.stringify({
        type: 'event_msg',
        timestamp: `2026-05-22T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        payload: { type: 'progress', index }
      })
    );
    await fs.writeFile(
      path.join(archivedRoot, 'advanced.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-05-22T10:00:00.000Z',
          payload: { id: 'advanced-session', cwd: '/work/advanced', model: 'gpt-5.3-codex' }
        }),
        JSON.stringify({
          type: 'turn_context',
          timestamp: '2026-05-22T10:00:01.000Z',
          payload: { model: 'gpt-5.4', reasoning_effort: 'high' }
        }),
        JSON.stringify({
          type: 'user_message',
          timestamp: '2026-05-22T10:01:00.000Z',
          payload: { role: 'user', content: 'same request' }
        }),
        JSON.stringify({
          type: 'user_message',
          timestamp: '2026-05-22T10:01:00.000Z',
          payload: { role: 'user', content: 'same request' }
        }),
        JSON.stringify({
          type: 'assistant_message',
          timestamp: '2026-05-22T10:02:00.000Z',
          payload: { role: 'assistant', content: 'working' }
        }),
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-05-22T10:03:00.000Z',
          payload: {
            type: 'function_call',
            name: 'exec_command',
            arguments: JSON.stringify({ cmd: 'npm test', path: 'src/server/index.js' })
          }
        }),
        ...repeatedLines,
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-05-22T10:59:00.000Z',
          payload: { type: 'aborted', reason: 'user_cancelled' }
        })
      ].join('\n')
    );

    const { trustedRoots } = await resolveTrustedRoots([root]);
    const index = await indexCodexLogs({ roots: trustedRoots, trustedRoots });
    const session = index.sessions.find((candidate) => candidate.id === 'advanced-session');

    assert.equal(index.diagnostics.filesParsed, 1);
    assert.equal(session.source.lineCount, 157);
    assert.equal(session.status, 'aborted');
    assert.equal(session.aborted, true);
    assert.deepEqual(session.models, ['gpt-5.3-codex', 'gpt-5.4']);
    assert.deepEqual(session.reasoningEfforts, ['high']);
    assert.equal(session.requestCount, 1);
    assert.equal(session.tools.includes('exec_command'), true);
    assert.equal(session.editedFiles.includes('src/server/index.js'), true);
  });
});

describe('Analytics', () => {
  it('builds dashboard totals and filters sessions', async () => {
    const { trustedRoots } = await resolveTrustedRoots([fixtureRoot]);
    const index = await indexCodexLogs({ roots: trustedRoots, trustedRoots });
    const dashboard = buildDashboard(index.sessions);
    const filtered = filterSessions(index.sessions, { model: 'gpt-5', status: 'complete' });

    assert.equal(dashboard.totals.sessions, 2);
    assert.equal(dashboard.totals.requests, 2);
    assert.equal(dashboard.totals.tokenTotals.total, 310);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'session-basic');
  });
});
