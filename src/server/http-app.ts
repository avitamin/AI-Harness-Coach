import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildAntiPatterns, buildOutputTokens } from '../core/analytics.js';
import type { AppState } from './app-state.js';

const defaultPublicDir = path.resolve(process.cwd(), 'web');

interface HttpServerOptions {
  publicDir?: string;
}

interface ApiResponse {
  status: number;
  body: unknown;
}

export function createHttpServer(state: AppState, options: HttpServerOptions = {}) {
  const publicDir = options.publicDir ?? defaultPublicDir;

  return http.createServer(async (request, response) => {
    try {
      await route({ request, response, state, publicDir });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });
}

async function route({
  request,
  response,
  state,
  publicDir
}: {
  request: http.IncomingMessage;
  response: http.ServerResponse;
  state: AppState;
  publicDir: string;
}): Promise<void> {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const apiResponse = await handleApiRequest(state, request.method, url);
  if (apiResponse) {
    sendJson(response, apiResponse.status, apiResponse.body);
    return;
  }

  await sendStatic(url.pathname, response, publicDir);
}

export async function handleApiRequest(
  state: AppState,
  method: string | undefined,
  urlLike: string | URL
): Promise<ApiResponse | null> {
  const url = urlLike instanceof URL ? urlLike : new URL(urlLike, 'http://localhost');
  if (url.pathname === '/api/health' && method === 'GET') {
    return { status: 200, body: { ok: true, service: 'ai-harness-coach' } };
  }

  if (url.pathname === '/api/index/status' && method === 'GET') {
    return { status: 200, body: state.getStatus() };
  }

  if (url.pathname === '/api/reload' && method === 'POST') {
    const index = await state.reload();
    return {
      status: 200,
      body: {
        indexedAt: index.indexedAt,
        sessionCount: index.sessions.length,
        diagnostics: index.diagnostics
      }
    };
  }

  if (url.pathname === '/api/cache/clear' && method === 'POST') {
    await state.clearCache();
    return { status: 200, body: { cleared: true } };
  }

  if (url.pathname === '/api/dashboard' && method === 'GET') {
    return { status: 200, body: state.getDashboard() };
  }

  if (url.pathname === '/api/sessions' && method === 'GET') {
    return { status: 200, body: state.getSessions(Object.fromEntries(url.searchParams)) };
  }

  const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionMatch && method === 'GET') {
    const sessionId = sessionMatch[1];
    const detail = await state.getSessionDetail(decodeURIComponent(sessionId));
    if (!detail) {
      return { status: 404, body: { error: 'Session not found' } };
    }
    return { status: 200, body: detail };
  }

  if (url.pathname === '/api/parser-coverage' && method === 'GET') {
    return { status: 200, body: state.getParserCoverage() };
  }

  if (url.pathname === '/api/output-tokens' && method === 'GET') {
    return { status: 200, body: buildOutputTokens(state.index?.sessions ?? []) };
  }

  if (url.pathname === '/api/anti-patterns' && method === 'GET') {
    return { status: 200, body: { findings: buildAntiPatterns(state.index?.sessions ?? []) } };
  }

  return null;
}

async function sendStatic(
  requestPath: string,
  response: http.ServerResponse,
  publicDir: string
): Promise<void> {
  const safePath = requestPath === '/' ? '/index.html' : requestPath;
  const candidate = path.resolve(publicDir, `.${safePath}`);
  if (!candidate.startsWith(publicDir)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const content = await fs.readFile(candidate);
    response.writeHead(200, { 'content-type': contentType(candidate) });
    response.end(content);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      const fallback = await fs.readFile(path.join(publicDir, 'index.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fallback);
      return;
    }
    throw error;
  }
}

function sendJson(response: http.ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function contentType(filePath: string): string {
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  return 'text/html; charset=utf-8';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
