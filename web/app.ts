export {};

const state = {
  dashboard: null,
  sessions: null,
  output: null,
  patterns: null,
  health: null
};

const statusEl = document.querySelector<HTMLElement>('#status');

document.querySelectorAll<HTMLElement>('.tab').forEach((button) => {
  button.addEventListener('click', () => switchView(button.dataset.view));
});

document.querySelector<HTMLElement>('#reload').addEventListener('click', async () => {
  statusEl.textContent = 'Reloading local Codex logs';
  await api('/api/reload', { method: 'POST' });
  await loadAll();
});

document.querySelector<HTMLInputElement>('#search').addEventListener('input', debounce(loadSessions, 250));
document.querySelector<HTMLSelectElement>('#statusFilter').addEventListener('change', loadSessions);

await loadAll();

async function loadAll() {
  const status = await api('/api/index/status');
  statusEl.textContent = `${status.sessionCount} sessions indexed from ${status.roots.length} roots`;
  state.dashboard = await api('/api/dashboard');
  state.output = await api('/api/output-tokens');
  state.patterns = await api('/api/anti-patterns');
  state.health = await api('/api/parser-coverage');
  renderDashboard();
  renderOutput();
  renderPatterns();
  renderHealth();
  await loadSessions();
}

async function loadSessions() {
  const params = new URLSearchParams();
  const search = document.querySelector<HTMLInputElement>('#search').value;
  const status = document.querySelector<HTMLSelectElement>('#statusFilter').value;
  if (search) params.set('search', search);
  if (status) params.set('status', status);
  state.sessions = await api(`/api/sessions?${params}`);
  renderSessions();
}

function switchView(view) {
  document.querySelectorAll<HTMLElement>('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === view);
  });
  document.querySelectorAll('.view').forEach((section) => {
    section.classList.toggle('active', section.id === view);
  });
}

function renderDashboard() {
  const totals = state.dashboard.totals;
  document.querySelector('#metrics').innerHTML = [
    metric('Sessions', totals.sessions),
    metric('Requests', totals.requests),
    metric('Active Days', totals.activeDays),
    metric('Workspaces', totals.workspaces),
    metric('Tokens', formatNumber(totals.tokenTotals.total)),
    metric('Cache Read', formatNumber(totals.tokenTotals.cachedInput))
  ].join('');

  document.querySelector('#recent').innerHTML = state.dashboard.recentActivity
    .map(
      (session) => `
        <article class="row">
          <strong>${escapeHtml(session.title ?? session.id)}</strong>
          <div class="meta">${escapeHtml(session.workspace ?? '(unknown workspace)')} - ${escapeHtml(session.status)}</div>
          ${pills([...session.models, ...session.tools].slice(0, 8))}
        </article>
      `
    )
    .join('');

  document.querySelector('#signals').innerHTML = [
    signalGroup('Models', state.dashboard.models),
    signalGroup('Tools', state.dashboard.tools),
    signalGroup('Edited Files', state.dashboard.editedFiles)
  ].join('');
}

function renderSessions() {
  document.querySelector('#sessionList').innerHTML = state.sessions.sessions
    .map(
      (session) => `
        <article class="row">
          <strong>${escapeHtml(session.title ?? session.id)}</strong>
          <div class="meta">${escapeHtml(session.startedAt ?? 'unknown time')} - ${escapeHtml(session.status)} - ${session.requestCount} requests</div>
          ${pills([...session.models, ...session.tools].slice(0, 10))}
          <button type="button" data-session-id="${escapeHtml(session.id)}">Open Detail</button>
        </article>
      `
    )
    .join('');

  document.querySelectorAll<HTMLElement>('[data-session-id]').forEach((button) => {
    button.addEventListener('click', () => openSession(button.dataset.sessionId));
  });
}

async function openSession(id) {
  const detail = await api(`/api/sessions/${encodeURIComponent(id)}`);
  document.querySelector('#sessionDetail').innerHTML = `
    <h2>${escapeHtml(detail.title ?? detail.id)}</h2>
    <p class="meta">${escapeHtml(detail.workspace ?? '(unknown workspace)')}</p>
    <p class="meta">${detail.messages.length} text records loaded on demand from source JSONL.</p>
    <h2>Messages</h2>
    ${detail.messages
      .slice(0, 20)
      .map(
        (message) => `
          <article class="row">
            <strong>${escapeHtml(message.role ?? 'unknown')}</strong>
            <pre>${escapeHtml(message.text)}</pre>
          </article>
        `
      )
      .join('')}
  `;
}

function renderOutput() {
  document.querySelector('#tokens').innerHTML = state.output.byModel
    .map(
      (entry) => `
        <article class="row">
          <strong>${escapeHtml(entry.model)}</strong>
          <div class="meta">input ${formatNumber(entry.tokens.input)} - output ${formatNumber(entry.tokens.output)} - reasoning ${formatNumber(entry.tokens.reasoningOutput)} - cached ${formatNumber(entry.tokens.cachedInput)} - total ${formatNumber(entry.tokens.total)}</div>
        </article>
      `
    )
    .join('');
  document.querySelector('#tokenWarnings').innerHTML = state.output.warnings
    .slice(0, 50)
    .map((warning) => `<article class="row">${escapeHtml(warning.sessionId)}: ${escapeHtml(warning.warning)}</article>`)
    .join('');
}

function renderPatterns() {
  const findings = state.patterns.findings;
  document.querySelector('#patternsList').innerHTML =
    findings.length === 0
      ? '<article class="panel row">No Codex hygiene findings in indexed sessions.</article>'
      : findings
          .map(
            (finding) => `
              <article class="row">
                <strong>${escapeHtml(finding.type)}</strong>
                <div>${escapeHtml(finding.message)}</div>
                <div class="meta">${escapeHtml(finding.sessionId)} - ${escapeHtml(finding.workspace ?? '(unknown workspace)')}</div>
              </article>
            `
          )
          .join('');
}

function renderHealth() {
  document.querySelector('#healthPanel').innerHTML = `
    <div class="metric-grid">
      ${metric('Files Seen', state.health.filesSeen)}
      ${metric('Files Parsed', state.health.filesParsed)}
      ${metric('Skipped Files', state.health.skippedFiles.length)}
      ${metric('Invalid Lines', state.health.invalidJsonLines.length)}
      ${metric('Missing Tokens', state.health.missingTokenCoverageSessions)}
      ${metric('Unsupported Types', Object.keys(state.health.unsupportedEventCounts).length)}
    </div>
    <section class="panel row">
      <h2>Log Roots</h2>
      ${state.health.roots.map((root) => `<div>${escapeHtml(root)}</div>`).join('')}
    </section>
    <section class="panel row">
      <h2>Unsupported Event Counts</h2>
      <pre>${escapeHtml(JSON.stringify(state.health.unsupportedEventCounts, null, 2))}</pre>
    </section>
    <section class="panel row">
      <h2>Skipped And Invalid Inputs</h2>
      <pre>${escapeHtml(JSON.stringify({ skippedRoots: state.health.skippedRoots, skippedFiles: state.health.skippedFiles, invalidJsonLines: state.health.invalidJsonLines }, null, 2))}</pre>
    </section>
  `;
}

async function api(path, options = undefined) {
  const response = await fetch(path, options);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

function metric(label, value) {
  return `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
}

function signalGroup(title, rows) {
  return `<section><h2>${escapeHtml(title)}</h2>${rows
    .map((row) => `<div class="row"><strong>${escapeHtml(row.name)}</strong><div class="meta">${row.count}</div></div>`)
    .join('')}</section>`;
}

function pills(values) {
  return values.map((value) => `<span class="pill">${escapeHtml(value)}</span>`).join('');
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function debounce(callback, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), wait);
  };
}
