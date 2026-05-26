export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonObject | JsonValue[] | string | number | boolean | null;

export interface TokenTotals {
  input: number;
  output: number;
  cachedInput: number;
  reasoningOutput: number;
  total: number;
}

export interface SessionSource {
  path: string;
  mtime: string;
  size: number;
  lineCount: number;
}

export type SessionStatus = 'unknown' | 'complete' | 'partial' | 'incomplete' | 'aborted';

export interface ParseWarning {
  line: number;
  reason: string;
}

export interface CodexSession {
  id: string;
  title: string;
  workspace: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: SessionStatus;
  requestCount: number;
  assistantMessageCount: number;
  models: string[];
  reasoningEfforts: string[];
  tokenTotals: TokenTotals;
  hasTokenData: boolean;
  aborted: boolean;
  tools: string[];
  editedFiles: string[];
  parseWarnings: ParseWarning[];
  unsupportedEvents: number;
  source: SessionSource;
}

export interface MutableCodexSession extends Omit<CodexSession, 'models' | 'reasoningEfforts' | 'tools' | 'editedFiles'> {
  models: Set<string>;
  reasoningEfforts: Set<string>;
  tools: Set<string>;
  editedFiles: Set<string>;
  messageFingerprints: Set<string>;
}

export interface SkippedPathDiagnostic {
  path: string;
  reason: string;
  message?: string;
}

export interface InvalidJsonLineDiagnostic {
  path: string;
  line: number;
  message: string;
}

export interface IndexDiagnostics {
  roots: string[];
  filesSeen: number;
  filesParsed: number;
  skippedFiles: SkippedPathDiagnostic[];
  invalidJsonLines: InvalidJsonLineDiagnostic[];
  unsupportedEventCounts: Record<string, number>;
  missingTokenCoverageSessions: number;
  warnings: string[];
  skippedRoots?: SkippedPathDiagnostic[];
}

export interface CodexIndex {
  indexedAt: string;
  sessions: CodexSession[];
  diagnostics: IndexDiagnostics;
  version?: number;
}

export interface SessionMessage {
  line: number;
  role: string | null;
  timestamp: string | null;
  text: string;
}

export interface SessionEvent {
  line: number;
  type: string;
  timestamp?: string | null;
  summary: string;
}

export interface SessionDetail extends CodexSession {
  detailLoadedAt: string;
  messages: SessionMessage[];
  events: SessionEvent[];
}
