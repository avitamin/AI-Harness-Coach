import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { AppState } from '../src/server/app-state.js';
import { createHttpServer } from '../src/server/http-app.js';

test.describe('Browser e2e scenarios', () => {
  test('covers dashboard, sessions, output, anti-patterns, data health, reload, and detail flows', async ({
    page
  }) => {
    const fixture = await createE2eFixtureWorkspace();
    const state = new AppState({
      roots: [fixture.root],
      cacheDir: fixture.cacheDir
    });
    await state.initialize();
    const server = createHttpServer(state);
    await listen(server);

    try {
      const baseUrl = serverUrl(server);
      await page.goto(baseUrl);
      await expect(page.locator('#status')).toContainText('3 sessions indexed from 1 roots');
      await expect(page.locator('#metrics')).toContainText('Sessions');

      await expect(page.locator('#dashboard')).toContainText(/3\s*Sessions/);
      await expect(page.locator('#dashboard')).toContainText(/3\s*Requests/);
      await expect(page.locator('#dashboard')).toContainText(/155\s*Tokens/);
      await expect(page.locator('#recent')).toContainText('e2e-complete');
      await expect(page.locator('#signals')).toContainText('gpt-5');
      await expect(page.locator('#signals')).toContainText('exec_command');
      await expect(page.locator('#signals')).toContainText('src/dashboard.ts');

      await page.locator('[data-view="sessions"]').click();
      await expect(page.locator('#sessions')).toContainText('e2e-complete');
      await expect(page.locator('#sessions')).toContainText('e2e-weak');
      await expect(page.locator('#sessions')).toContainText('e2e-partial');

      await page.locator('#search').fill('weak-signal');
      await expect(page.locator('#sessionList')).toContainText('e2e-weak');
      await expect(page.locator('#sessionList')).not.toContainText('e2e-complete');

      await page.locator('#search').fill('');
      await page.locator('#statusFilter').selectOption('partial');
      await expect(page.locator('#sessionList')).toContainText('e2e-partial');
      await expect(page.locator('#sessionList')).not.toContainText('e2e-weak');

      await page.locator('#statusFilter').selectOption('');
      await expect(page.locator('#sessionList')).toContainText('e2e-complete');
      await page.locator('[data-session-id="e2e-complete"]').click();
      await expect(page.locator('#sessionDetail')).toContainText('Private detail text loaded only from source');
      await expect(page.locator('#sessionDetail')).toContainText(/2 text records loaded on demand/);

      await page.locator('[data-view="output"]').click();
      await expect(page.locator('#output')).toContainText('Token Usage By Model');
      await expect(page.locator('#output')).toContainText('gpt-5');
      await expect(page.locator('#output')).toContainText('total 155');
      await expect(page.locator('#output')).toContainText('missing_token_data');

      await page.locator('[data-view="patterns"]').click();
      await expect(page.locator('#patterns')).toContainText('weak_validation_signal');
      await expect(page.locator('#patterns')).toContainText('incomplete_session');
      await expect(page.locator('#patterns')).toContainText('parser_drift_signal');

      await page.locator('[data-view="health"]').click();
      await expect(page.locator('#health')).toContainText(/3\s*Files Seen/);
      await expect(page.locator('#health')).toContainText(/3\s*Files Parsed/);
      await expect(page.locator('#health')).toContainText(/1\s*Invalid Lines/);
      await expect(page.locator('#health')).toContainText('future_event');
      await expect(page.locator('#health')).toContainText(fixture.root);

      await fs.writeFile(
        path.join(fixture.root, 'e2e-reloaded.jsonl'),
        codexLines([
          meta('e2e-reloaded', '2026-05-26T08:00:00.000Z', '/tmp/reloaded', 'gpt-5.1'),
          message('user_message', '2026-05-26T08:01:00.000Z', 'user', 'Reloaded browser scenario'),
          message('assistant_message', '2026-05-26T08:02:00.000Z', 'assistant', 'Reloaded done')
        ])
      );
      await page.locator('#reload').click();
      await expect(page.locator('#status')).toContainText('4 sessions indexed from 1 roots');
      await expect(page.locator('#recent')).toContainText('e2e-reloaded');
    } finally {
      server.close();
    }
  });
});

async function createE2eFixtureWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-e2e-'));
  const root = path.join(base, 'logs');
  const cacheDir = path.join(base, 'cache');
  await fs.mkdir(root, { recursive: true });

  await fs.writeFile(
    path.join(root, 'e2e-complete.jsonl'),
    codexLines([
      meta('e2e-complete', '2026-05-25T10:00:00.000Z', '/tmp/e2e-dashboard', 'gpt-5'),
      message('user_message', '2026-05-25T10:01:00.000Z', 'user', 'Need e2e dashboard coverage'),
      message(
        'assistant_message',
        '2026-05-25T10:02:00.000Z',
        'assistant',
        'Private detail text loaded only from source'
      ),
      {
        type: 'token_count',
        timestamp: '2026-05-25T10:03:00.000Z',
        usage: {
          input_tokens: 100,
          output_tokens: 40,
          cached_input_tokens: 15,
          total_tokens: 155
        }
      },
      {
        type: 'response_item',
        timestamp: '2026-05-25T10:04:00.000Z',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({ cmd: 'npm test', path: 'src/dashboard.ts' })
        }
      }
    ])
  );

  await fs.writeFile(
    path.join(root, 'e2e-weak.jsonl'),
    codexLines([
      meta('e2e-weak', '2026-05-24T10:00:00.000Z', '/tmp/e2e-patterns', 'gpt-5-mini'),
      message('user_message', '2026-05-24T10:01:00.000Z', 'user', 'Weakly validated edit'),
      message('assistant_message', '2026-05-24T10:02:00.000Z', 'assistant', 'Patched file'),
      {
        type: 'assistant_message',
        timestamp: '2026-05-24T10:03:00.000Z',
        payload: {
          role: 'assistant',
          content: '*** Begin Patch\n*** Update File: src/weak-signal.ts\n+export const value = 1;\n*** End Patch'
        }
      }
    ])
  );

  await fs.writeFile(
    path.join(root, 'e2e-partial.jsonl'),
    [
      codexLines([
        meta('e2e-partial', '2026-05-23T10:00:00.000Z', '/tmp/e2e-health', 'gpt-5-mini'),
        message('user_message', '2026-05-23T10:01:00.000Z', 'user', 'Unsupported future event'),
        {
          type: 'future_event',
          timestamp: '2026-05-23T10:02:00.000Z',
          payload: { kind: 'parser drift' }
        }
      ]),
      'not json'
    ].join('\n')
  );

  return { base, root, cacheDir };
}

function meta(id: string, timestamp: string, cwd: string, model: string) {
  return {
    type: 'session_meta',
    timestamp,
    payload: { id, cwd, model }
  };
}

function message(type: string, timestamp: string, role: string, content: string) {
  return {
    type,
    timestamp,
    payload: { role, content }
  };
}

function codexLines(records: Record<string, unknown>[]) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}

function serverUrl(server: http.Server): string {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}
