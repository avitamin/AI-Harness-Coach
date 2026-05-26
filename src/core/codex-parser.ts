import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { assertTrustedPath, isInsideTrustedRoot } from './path-safety.js';
import type {
  CodexIndex,
  CodexSession,
  IndexDiagnostics,
  MutableCodexSession,
  SessionDetail,
  SessionEvent,
  SessionMessage,
  SessionStatus
} from './types.js';

const SUPPORTED_TYPES = new Set([
  'session_meta',
  'user_message',
  'assistant_message',
  'message',
  'token_count',
  'turn_context',
  'event_msg',
  'response_item',
  'function_call',
  'tool_call'
]);

export async function indexCodexLogs({
  roots,
  trustedRoots
}: {
  roots: string[];
  trustedRoots: string[];
}): Promise<CodexIndex> {
  const files: string[] = [];
  const diagnostics: IndexDiagnostics = {
    roots,
    filesSeen: 0,
    filesParsed: 0,
    skippedFiles: [],
    invalidJsonLines: [],
    unsupportedEventCounts: {},
    missingTokenCoverageSessions: 0,
    warnings: []
  };

  for (const root of roots) {
    if (!isInsideTrustedRoot(root, trustedRoots)) {
      diagnostics.skippedFiles.push({ path: root, reason: 'outside_trusted_roots' });
      continue;
    }
    await collectJsonlFiles(root, trustedRoots, files, diagnostics);
  }

  const sessions: CodexSession[] = [];

  for (const filePath of files) {
    diagnostics.filesSeen += 1;
    try {
      const session = await parseCodexSessionFile(filePath, trustedRoots, diagnostics);
      diagnostics.filesParsed += 1;
      sessions.push(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.skippedFiles.push({
        path: filePath,
        reason: 'parse_failed',
        message
      });
    }
  }

  diagnostics.missingTokenCoverageSessions = sessions.filter(
    (session) => !session.hasTokenData
  ).length;

  return {
    indexedAt: new Date().toISOString(),
    sessions: sessions.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))),
    diagnostics
  };
}

export async function readSessionDetail(
  session: CodexSession,
  trustedRoots: string[]
): Promise<SessionDetail> {
  await assertTrustedPath(session.source.path, trustedRoots);
  const messages: SessionMessage[] = [];
  const events: SessionEvent[] = [];
  let lineNumber = 0;

  const input = fsSync.createReadStream(session.source.path, { encoding: 'utf8' });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }

    try {
      const record = JSON.parse(line) as CodexRecord;
      const normalized = normalizeRecord(record);
      events.push({
        line: lineNumber,
        type: normalized.type,
        timestamp: normalized.timestamp,
        summary: summarizeRecord(record)
      });

      const text = extractText(record);
      if (text) {
        messages.push({
          line: lineNumber,
          role: extractRole(record),
          timestamp: normalized.timestamp,
          text
        });
      }
    } catch {
      events.push({ line: lineNumber, type: 'invalid_json', summary: 'Invalid JSON line' });
    }
  }

  return { ...session, detailLoadedAt: new Date().toISOString(), messages, events };
}

async function collectJsonlFiles(
  root: string,
  trustedRoots: string[],
  files: string[],
  diagnostics: IndexDiagnostics
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    diagnostics.skippedFiles.push({
      path: root,
      reason: 'unreadable_directory',
      message
    });
    return;
  }

  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (!isInsideTrustedRoot(candidate, trustedRoots)) {
      diagnostics.skippedFiles.push({ path: candidate, reason: 'outside_trusted_roots' });
      continue;
    }

    if (entry.isDirectory()) {
      await collectJsonlFiles(candidate, trustedRoots, files, diagnostics);
      continue;
    }

    if (entry.isFile() && candidate.endsWith('.jsonl')) {
      files.push(candidate);
    }
  }
}

async function parseCodexSessionFile(
  filePath: string,
  trustedRoots: string[],
  diagnostics: IndexDiagnostics
): Promise<CodexSession> {
  const realPath = await assertTrustedPath(filePath, trustedRoots);
  const stat = await fs.stat(realPath);
  const session = createEmptySession(realPath, stat);
  let lineNumber = 0;

  const input = fsSync.createReadStream(realPath, { encoding: 'utf8' });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of reader) {
    lineNumber += 1;
    if (!line.trim()) {
      continue;
    }

    let record: CodexRecord;
    try {
      record = JSON.parse(line) as CodexRecord;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.invalidJsonLines.push({
        path: realPath,
        line: lineNumber,
        message
      });
      session.parseWarnings.push({ line: lineNumber, reason: 'invalid_json' });
      continue;
    }

    applyRecord(session, record);
    const type = normalizeRecord(record).type;
    if (!SUPPORTED_TYPES.has(type)) {
      diagnostics.unsupportedEventCounts[type] =
        (diagnostics.unsupportedEventCounts[type] ?? 0) + 1;
    }
  }

  session.status = inferStatus(session);
  session.durationMs =
    session.startedAt && session.endedAt
      ? new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
      : null;
  session.source.lineCount = lineNumber;

  return finalizeSession(session);
}

type CodexRecord = Record<string, any>;

function createEmptySession(
  filePath: string,
  stat: { mtime: Date; size: number }
): MutableCodexSession {
  const fallbackId = path.basename(filePath, '.jsonl');
  return {
    id: fallbackId,
    title: fallbackId,
    workspace: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    status: 'unknown',
    requestCount: 0,
    assistantMessageCount: 0,
    models: new Set(),
    reasoningEfforts: new Set(),
    tokenTotals: {
      input: 0,
      output: 0,
      cachedInput: 0,
      reasoningOutput: 0,
      total: 0
    },
    hasTokenData: false,
    aborted: false,
    tools: new Set(),
    editedFiles: new Set(),
    parseWarnings: [],
    unsupportedEvents: 0,
    messageFingerprints: new Set(),
    source: {
      path: filePath,
      mtime: stat.mtime.toISOString(),
      size: stat.size,
      lineCount: 0
    }
  };
}

function finalizeSession(session: MutableCodexSession): CodexSession {
  return {
    ...session,
    models: [...session.models].sort(),
    reasoningEfforts: [...session.reasoningEfforts].sort(),
    tools: [...session.tools].sort(),
    editedFiles: [...session.editedFiles].sort()
  };
}

function applyRecord(session: MutableCodexSession, record: CodexRecord): void {
  const normalized = normalizeRecord(record);
  if (normalized.timestamp) {
    session.startedAt = earlierDate(session.startedAt, normalized.timestamp);
    session.endedAt = laterDate(session.endedAt, normalized.timestamp);
  }

  if (!SUPPORTED_TYPES.has(normalized.type)) {
    session.unsupportedEvents += 1;
  }

  const sessionId = findFirstString(record, ['session_id', 'sessionId', 'id'], [
    'payload',
    'message'
  ]);
  if (normalized.type === 'session_meta' && sessionId) {
    session.id = sessionId;
  }

  const workspace = findFirstString(record, ['cwd', 'workspace', 'workspace_path'], [
    'payload',
    'metadata'
  ]);
  if (workspace && !session.workspace) {
    session.workspace = workspace;
  }

  const model = findFirstString(record, ['model', 'model_slug'], ['payload', 'message']);
  if (model) {
    session.models.add(model);
  }

  const reasoningEffort = findFirstString(record, ['reasoning_effort', 'effort'], [
    'payload',
    'metadata'
  ]);
  if (reasoningEffort) {
    session.reasoningEfforts.add(reasoningEffort);
  }

  if (isAbortRecord(record, normalized.type)) {
    session.aborted = true;
  }

  const role = extractRole(record);
  if (role === 'user' || role === 'assistant') {
    const fingerprint = messageFingerprint(record, role);
    if (!fingerprint || !session.messageFingerprints.has(fingerprint)) {
      if (fingerprint) {
        session.messageFingerprints.add(fingerprint);
      }
      if (role === 'user') {
        session.requestCount += 1;
      }
      if (role === 'assistant') {
        session.assistantMessageCount += 1;
      }
    }
  }

  applyTokenRecord(session, record);
  collectTools(session, record);
  collectEditedFiles(session, record);

  const text = extractText(record);
  if (text && !session.title && role === 'user') {
    session.title = text.slice(0, 80);
  }
}

function normalizeRecord(record: CodexRecord): { type: string; timestamp: string | null } {
  return {
    type:
      record.type ??
      record.event ??
      record.kind ??
      record.name ??
      record.item?.type ??
      record.payload?.type ??
      'unknown',
    timestamp:
      record.timestamp ??
      record.time ??
      record.created_at ??
      record.createdAt ??
      record.payload?.timestamp ??
      record.payload?.created_at ??
      null
  };
}

function applyTokenRecord(session: MutableCodexSession, record: CodexRecord): void {
  const usage =
    record.usage ??
    record.token_count ??
    record.payload?.usage ??
    record.payload?.token_count ??
    record.payload?.info?.total_token_usage ??
    record.payload?.info?.last_token_usage;
  const input = numberFromKeys(usage, ['input_tokens', 'prompt_tokens', 'input', 'prompt']);
  const output = numberFromKeys(usage, ['output_tokens', 'completion_tokens', 'output', 'completion']);
  const cachedInput = numberFromKeys(usage, [
    'cached_input_tokens',
    'cache_read_input_tokens',
    'cached_tokens'
  ]);
  const reasoningOutput = numberFromKeys(usage, ['reasoning_output_tokens']);
  const total = numberFromKeys(usage, ['total_tokens', 'total']);

  if (input || output || cachedInput || total) {
    session.hasTokenData = true;
    if (record.payload?.info?.total_token_usage) {
      session.tokenTotals.input = Math.max(session.tokenTotals.input, input);
      session.tokenTotals.output = Math.max(session.tokenTotals.output, output);
      session.tokenTotals.cachedInput = Math.max(session.tokenTotals.cachedInput, cachedInput);
      session.tokenTotals.reasoningOutput = Math.max(
        session.tokenTotals.reasoningOutput,
        reasoningOutput
      );
      session.tokenTotals.total = Math.max(session.tokenTotals.total, total || input + output);
    } else {
      session.tokenTotals.input += input;
      session.tokenTotals.output += output;
      session.tokenTotals.cachedInput += cachedInput;
      session.tokenTotals.reasoningOutput += reasoningOutput;
      session.tokenTotals.total += total || input + output;
    }
  }
}

function collectTools(session: MutableCodexSession, record: CodexRecord): void {
  const stack: unknown[] = [record];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    const currentRecord = current as CodexRecord;

    const maybeTool =
      currentRecord.tool ??
      currentRecord.tool_name ??
      currentRecord.name ??
      currentRecord.call?.name ??
      currentRecord.function?.name;
    const type = currentRecord.type ?? currentRecord.kind;
    if (
      maybeTool &&
      typeof maybeTool === 'string' &&
      (String(type).includes('tool') ||
        String(type).includes('function') ||
        currentRecord.arguments ||
        currentRecord.input)
    ) {
      session.tools.add(maybeTool);
    }

    for (const value of Object.values(currentRecord)) {
      if (Array.isArray(value)) {
        stack.push(...value);
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
}

function collectEditedFiles(session: MutableCodexSession, record: CodexRecord): void {
  for (const text of collectStrings(record)) {
    for (const match of text.matchAll(/(?:Update File|Add File|Delete File):\s*([^\n"']+)/g)) {
      const filePath = cleanPatchPath(match[1]);
      if (filePath) {
        session.editedFiles.add(filePath);
      }
    }

    const parsed = parsePossibleJson(text);
    if (parsed) {
      for (const value of findStringsByKey(
        parsed,
        new Set(['path', 'file', 'file_path', 'relativePath'])
      )) {
        if (looksLikeEditablePath(value)) {
          session.editedFiles.add(value);
        }
      }
    }
  }

  const paths = findStringsByKey(record, new Set(['path', 'file', 'file_path', 'relativePath']));
  for (const value of paths) {
    if (looksLikeEditablePath(value)) {
      session.editedFiles.add(value);
    }
  }
}

function extractRole(record: CodexRecord): string | null {
  return (
    record.role ??
    record.message?.role ??
    record.payload?.role ??
    record.payload?.message?.role ??
    (record.type === 'user_message' ? 'user' : null) ??
    (record.type === 'assistant_message' ? 'assistant' : null)
  );
}

function extractText(record: CodexRecord): string | null {
  const value =
    record.text ??
    record.content ??
    record.message?.content ??
    record.payload?.text ??
    record.payload?.content ??
    record.payload?.message?.content;

  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === 'string' ? part : part?.text ?? part?.content ?? ''))
      .filter(Boolean)
      .join('\n');
  }
  return null;
}

function summarizeRecord(record: CodexRecord): string {
  const text = extractText(record);
  if (text) {
    return text.slice(0, 160);
  }
  const tool = findFirstString(record, ['tool', 'tool_name', 'name'], ['payload', 'function']);
  if (tool) {
    return `Tool: ${tool}`;
  }
  return normalizeRecord(record).type;
}

function inferStatus(session: MutableCodexSession): SessionStatus {
  if (session.aborted) {
    return 'aborted';
  }
  if (session.parseWarnings.length > 0) {
    return 'partial';
  }
  if (session.requestCount > 0 && session.assistantMessageCount === 0) {
    return 'incomplete';
  }
  if (session.startedAt && !session.endedAt) {
    return 'incomplete';
  }
  return 'complete';
}

function isAbortRecord(record: CodexRecord, type: string): boolean {
  const values = [
    type,
    record.status,
    record.reason,
    record.payload?.status,
    record.payload?.reason,
    record.payload?.type
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  return values.some((value) =>
    ['aborted', 'abort', 'cancelled', 'canceled', 'interrupted'].some((marker) =>
      value.includes(marker)
    )
  );
}

function messageFingerprint(record: CodexRecord, role: string): string | null {
  const text = extractText(record);
  const timestamp = normalizeRecord(record).timestamp;
  if (!text && !timestamp) {
    return null;
  }
  return `${role}:${timestamp ?? ''}:${text ?? ''}`;
}

function earlierDate(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return new Date(candidate) < new Date(current) ? candidate : current;
}

function laterDate(current: string | null, candidate: string | null): string | null {
  if (!candidate) {
    return current;
  }
  if (!current) {
    return candidate;
  }
  return new Date(candidate) > new Date(current) ? candidate : current;
}

function numberFromKeys(source: unknown, keys: string[]): number {
  if (!source || typeof source !== 'object') {
    return 0;
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function findFirstString(
  record: CodexRecord | undefined,
  keys: string[],
  nestedKeys: string[] = []
): string | null {
  for (const key of keys) {
    if (typeof record?.[key] === 'string') {
      return record[key];
    }
  }
  for (const nested of nestedKeys) {
    const value = record?.[nested];
    if (value && typeof value === 'object') {
      const found = findFirstString(value, keys, []);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function findStringsByKey(record: unknown, wantedKeys: Set<string>): string[] {
  const results: string[] = [];
  const stack: unknown[] = [record];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (wantedKeys.has(key) && typeof value === 'string') {
        results.push(value);
      }
      if (Array.isArray(value)) {
        stack.push(...value);
      } else if (value && typeof value === 'object') {
        stack.push(value);
      }
    }
  }
  return results;
}

function looksLikeEditablePath(value: string): boolean {
  return /\.(js|jsx|ts|tsx|json|md|css|html|py|go|php|rb|rs|java|kt|yml|yaml)$/i.test(value);
}

function cleanPatchPath(value: string): string | null {
  const candidate = value.split(/\\n|\n|@@/)[0].trim();
  if (!candidate || candidate.length > 240 || /\s/.test(candidate)) {
    return null;
  }
  return candidate;
}

function collectStrings(record: unknown): string[] {
  const results: string[] = [];
  const stack: unknown[] = [record];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === 'string') {
      results.push(current);
      continue;
    }
    if (!current || typeof current !== 'object') {
      continue;
    }
    for (const value of Object.values(current)) {
      if (Array.isArray(value)) {
        stack.push(...value);
      } else if (value && typeof value === 'object') {
        stack.push(value);
      } else if (typeof value === 'string') {
        results.push(value);
      }
    }
  }
  return results;
}

function parsePossibleJson(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}
