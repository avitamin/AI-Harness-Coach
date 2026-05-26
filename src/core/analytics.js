export function buildDashboard(sessions) {
  const activeDays = new Set();
  const workspaces = new Map();
  const models = new Map();
  const tools = new Map();
  const editedFiles = new Map();
  const tokenTotals = { input: 0, output: 0, cachedInput: 0, reasoningOutput: 0, total: 0 };

  for (const session of sessions) {
    if (session.startedAt) {
      activeDays.add(session.startedAt.slice(0, 10));
    }
    increment(workspaces, session.workspace ?? '(unknown)');
    for (const model of session.models) {
      increment(models, model);
    }
    for (const tool of session.tools) {
      increment(tools, tool);
    }
    for (const file of session.editedFiles) {
      increment(editedFiles, file);
    }
    tokenTotals.input += session.tokenTotals.input;
    tokenTotals.output += session.tokenTotals.output;
    tokenTotals.cachedInput += session.tokenTotals.cachedInput;
    tokenTotals.reasoningOutput += session.tokenTotals.reasoningOutput;
    tokenTotals.total += session.tokenTotals.total;
  }

  return {
    totals: {
      sessions: sessions.length,
      requests: sessions.reduce((sum, session) => sum + session.requestCount, 0),
      activeDays: activeDays.size,
      workspaces: workspaces.size,
      tokenTotals
    },
    workspaces: topEntries(workspaces, 10),
    models: topEntries(models, 10),
    tools: topEntries(tools, 10),
    editedFiles: topEntries(editedFiles, 20),
    recentActivity: sessions.slice(0, 20).map(summarySession)
  };
}

export function filterSessions(sessions, query) {
  const search = String(query.search ?? '').trim().toLowerCase();
  const workspace = String(query.workspace ?? '').trim();
  const model = String(query.model ?? '').trim();
  const status = String(query.status ?? '').trim();
  const from = query.from ? new Date(String(query.from)) : null;
  const to = query.to ? new Date(String(query.to)) : null;

  return sessions.filter((session) => {
    const startedAt = session.startedAt ? new Date(session.startedAt) : null;
    if (from && (!startedAt || startedAt < from)) {
      return false;
    }
    if (to && (!startedAt || startedAt > to)) {
      return false;
    }
    if (workspace && session.workspace !== workspace) {
      return false;
    }
    if (model && !session.models.includes(model)) {
      return false;
    }
    if (status && session.status !== status) {
      return false;
    }
    if (search) {
      const haystack = [
        session.id,
        session.title,
        session.workspace,
        ...session.models,
        ...session.tools,
        ...session.editedFiles
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(search)) {
        return false;
      }
    }
    return true;
  });
}

export function buildOutputTokens(sessions) {
  const byModel = new Map();
  const warnings = [];

  for (const session of sessions) {
    if (!session.hasTokenData) {
      warnings.push({ sessionId: session.id, warning: 'missing_token_data' });
    }
    for (const model of session.models.length ? session.models : ['(unknown)']) {
      const current = byModel.get(model) ?? {
        input: 0,
        output: 0,
        cachedInput: 0,
        reasoningOutput: 0,
        total: 0
      };
      current.input += session.tokenTotals.input;
      current.output += session.tokenTotals.output;
      current.cachedInput += session.tokenTotals.cachedInput;
      current.reasoningOutput += session.tokenTotals.reasoningOutput;
      current.total += session.tokenTotals.total;
      byModel.set(model, current);
    }
  }

  return {
    byModel: [...byModel.entries()].map(([model, tokens]) => ({ model, tokens })),
    editedFileCounts: sessions.map((session) => ({
      sessionId: session.id,
      count: session.editedFiles.length
    })),
    codeBlockSummaries: sessions.map((session) => ({
      sessionId: session.id,
      editedFiles: session.editedFiles
    })),
    warnings
  };
}

export function buildAntiPatterns(sessions) {
  return sessions
    .flatMap((session) => {
      const findings = [];
      if (session.durationMs && session.durationMs > 1000 * 60 * 60 * 2) {
        findings.push(finding(session, 'long_session', 'Session ran longer than two hours.'));
      }
      if (['partial', 'incomplete'].includes(session.status)) {
        findings.push(finding(session, 'incomplete_session', 'Session appears incomplete or partially parsed.'));
      }
      if (session.editedFiles.length > 0 && !hasValidationTool(session)) {
        findings.push(finding(session, 'weak_validation_signal', 'Edited files without an obvious test or validation tool call.'));
      }
      if (session.unsupportedEvents > 0) {
        findings.push(finding(session, 'parser_drift_signal', 'Session contains unsupported event types.'));
      }
      return findings;
    })
    .slice(0, 100);
}

export function summarySession(session) {
  return {
    id: session.id,
    title: session.title,
    workspace: session.workspace,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMs: session.durationMs,
    status: session.status,
    requestCount: session.requestCount,
    assistantMessageCount: session.assistantMessageCount,
    models: session.models,
    reasoningEfforts: session.reasoningEfforts,
    tokenTotals: session.tokenTotals,
    hasTokenData: session.hasTokenData,
    aborted: session.aborted,
    tools: session.tools,
    editedFiles: session.editedFiles,
    unsupportedEvents: session.unsupportedEvents,
    source: {
      mtime: session.source.mtime,
      size: session.source.size,
      lineCount: session.source.lineCount
    }
  };
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function topEntries(map, limit) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function finding(session, type, message) {
  return {
    sessionId: session.id,
    type,
    message,
    workspace: session.workspace,
    startedAt: session.startedAt
  };
}

function hasValidationTool(session) {
  const text = [...session.tools, ...session.editedFiles].join(' ').toLowerCase();
  return /(test|lint|pint|phpstan|playwright|vitest|jest|karma|go test|pytest)/.test(text);
}
