import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { describe, it } from 'node:test';
import { AppState } from '../src/server/app-state.js';
import { createHttpServer } from '../src/server/http-app.js';

describe('Browser shell smoke', () => {
  it('serves the standalone web UI and static assets from loopback', async () => {
    const fixture = await createFixtureWorkspace();
    const state = new AppState({
      roots: [fixture.root],
      cacheDir: fixture.cacheDir
    });
    await state.initialize();
    const server = createHttpServer(state);

    try {
      const html = await textResponse(server, '/', 'text/html');
      assert.match(html, /AI Harness Coach/);
      assert.match(html, /id="profileSelect"/);
      assert.match(html, /data-view="dashboard"/);
      assert.match(html, /data-view="sessions"/);
      assert.match(html, /data-view="output"/);
      assert.match(html, /data-view="patterns"/);
      assert.match(html, /data-view="health"/);

      const css = await textResponse(server, '/styles.css', 'text/css');
      assert.match(css, /\.metric-grid/);

      const js = await textResponse(server, '/app.js', 'text/javascript');
      assert.match(js, /\/api\/profiles/);
      assert.match(js, /\/api\/dashboard/);
      assert.match(js, /\/api\/parser-coverage/);

      const profiles = await jsonResponse(server, '/api/profiles');
      assert.equal(profiles.profiles[0].id, 'default');

      const dashboard = await jsonResponse(server, '/api/dashboard');
      assert.equal(dashboard.totals.sessions, 1);

      const fallback = await textResponse(server, '/timeline', 'text/html');
      assert.match(fallback, /<title>AI Harness Coach<\/title>/);
    } finally {
      server.close();
    }
  });
});

async function createFixtureWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-web-'));
  const root = path.join(base, 'logs');
  const cacheDir = path.join(base, 'cache');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(
    path.join(root, 'web-session.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-24T10:00:00.000Z',
        payload: { id: 'web-session', cwd: '/tmp/web-workspace', model: 'gpt-5' }
      }),
      JSON.stringify({
        type: 'user_message',
        timestamp: '2026-05-24T10:01:00.000Z',
        payload: { role: 'user', content: 'show dashboard smoke' }
      }),
      JSON.stringify({
        type: 'assistant_message',
        timestamp: '2026-05-24T10:02:00.000Z',
        payload: { role: 'assistant', content: 'done' }
      })
    ].join('\n')
  );
  return { root, cacheDir };
}

async function request(server: http.Server, url: string) {
  const request = new Readable({ read() {} }) as http.IncomingMessage;
  request.url = url;
  request.method = 'GET';
  request.headers = { host: '127.0.0.1' };
  request.push(null);
  let capturedResponse: TestResponse | undefined;

  await new Promise<void>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    }) as TestResponse;
    response.writeHead = (status: number, headers?: Record<string, string>) => {
      response.statusCode = status;
      response.headers = headers ?? {};
      return response;
    };
    response.end = (chunk?: unknown) => {
      if (chunk) {
        chunks.push(Buffer.from(chunk as string | Buffer));
      }
      Writable.prototype.end.call(response);
      return response;
    };
    response.once('finish', resolve);
    response.once('error', reject);
    response.body = () => Buffer.concat(chunks).toString('utf8');
    capturedResponse = response;
    server.emit('request', request, response);
  });

  assert.ok(capturedResponse);
  return {
    status: capturedResponse.statusCode,
    headers: capturedResponse.headers,
    body: capturedResponse.body()
  };
}

type TestResponse = Writable &
  {
    statusCode: number;
    headers: Record<string, string>;
    body: () => string;
    writeHead: (status: number, headers?: Record<string, string>) => TestResponse;
    end: (chunk?: unknown) => TestResponse;
  };

async function textResponse(server: http.Server, url: string, expectedContentType: string) {
  const response = await request(server, url);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], new RegExp(expectedContentType));
  return response.body;
}

async function jsonResponse(server: http.Server, url: string) {
  const response = await request(server, url);
  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /application\/json/);
  return JSON.parse(response.body);
}
