import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAntiPatterns, buildOutputTokens } from '../core/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPublicDir = path.resolve(__dirname, '../../web');

export function createHttpServer(state, options = {}) {
  const publicDir = options.publicDir ?? defaultPublicDir;

  return http.createServer(async (request, response) => {
    try {
      await route({ request, response, state, publicDir });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });
}

async function route({ request, response, state, publicDir }) {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const apiResponse = await handleApiRequest(state, request.method, url);
  if (apiResponse) {
    sendJson(response, apiResponse.status, apiResponse.body);
    return;
  }

  await sendStatic(url.pathname, response, publicDir);
}

export async function handleApiRequest(state, method, urlLike) {
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
    const detail = await state.getSessionDetail(decodeURIComponent(sessionMatch[1]));
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

async function sendStatic(requestPath, response, publicDir) {
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
    if (error.code === 'ENOENT') {
      const fallback = await fs.readFile(path.join(publicDir, 'index.html'));
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(fallback);
      return;
    }
    throw error;
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

function contentType(filePath) {
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8';
  }
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  return 'text/html; charset=utf-8';
}
