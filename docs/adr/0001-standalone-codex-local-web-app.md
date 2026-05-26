# ADR 0001: Standalone Codex Local Web App

## Status

Accepted

## Context

AI Harness Coach needs to become a standalone local web app for Codex CLI analytics. The source investigation found that `microsoft/AI-Engineering-Coach` is currently a VS Code extension, but it already contains reusable Codex ingestion and analytics concepts.

Relevant upstream snapshot:

- Repository: [`microsoft/AI-Engineering-Coach`](https://github.com/microsoft/AI-Engineering-Coach/tree/9007bed3130b4c0784efe6f2990e2f3c03d13e3a)
- Commit: `9007bed3130b4c0784efe6f2990e2f3c03d13e3a`
- Codex parser: [`src/core/parser-codex.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/core/parser-codex.ts)
- Analyzer facade: [`src/core/analyzer.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/core/analyzer.ts)
- VS Code panel boundary: [`src/webview/panel.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/webview/panel.ts)

The upstream extension entry point, panel manager, webview transport, VS Code memento storage, and current parser orchestration are not suitable as the standalone app boundary. The standalone app needs explicit `core`, `server`, and `web` boundaries.

## Decision

Build AI Harness Coach as a Node.js local server plus fresh browser UI.

Architecture defaults:

- `core`: snapshot and adapt Codex parser, normalized session/request types, analytics, detectors, rules, DSL, path validation, and focused tests from the upstream commit.
- `server`: local HTTP API, config loading, Codex indexing orchestration, progress/status tracking, derived cache lifecycle, source-pointer handling, and safe session-detail reads.
- `web`: fresh browser UI for the MVP pages; reuse analytics behavior and visual ideas where useful, but do not copy VS Code webview transport or shell.
- `fixtures`: Codex JSONL fixtures for parser and API coverage.

MVP scope:

- Codex CLI only.
- Local single-user mode only.
- Loopback/localhost binding only.
- No authentication in the MVP.
- No telemetry.

Data policy:

- Store derived cache data only: metrics, indexes, diagnostics, and source pointers.
- Do not persist full raw prompt/response text by default.
- Read raw text from source JSONL only for explicit session detail views.
- Never write to Codex session files.

Parser policy:

- Unknown or unsupported Codex JSONL records should not fail indexing by default.
- Unknown/unsupported records, invalid lines, unreadable files, and skipped paths must be counted and exposed in Data Health.
- File paths must be validated against configured trusted roots and path traversal must be rejected.

## Alternatives Considered

### Thin VS Code Fork

Rejected. It would keep VS Code panel lifecycle, `acquireVsCodeApi` message passing, extension memento storage, and activity-bar assumptions in the standalone product.

### Git Submodule Or Subtree For Upstream Core

Rejected for the MVP. A snapshot fork is simpler and makes local product ownership clear. A future ADR may introduce a shared package if ongoing upstream sync becomes valuable.

### Electron App

Rejected for the MVP. Electron could provide a native shell, but it increases packaging and security surface before the core ingestion/product risks are resolved.

### Full Raw-Text Disk Cache

Rejected. It improves detail-view speed but conflicts with the chosen privacy posture. The MVP should prove useful analytics without persisting full prompt/response text by default.

### Direct Webview UI Reuse

Rejected. Reusing the webview wholesale would speed up initial rendering but carries VS Code CSS variables, message transport, and extension-specific UX assumptions into the new app.

## Consequences

Positive:

- Clear product boundary independent of VS Code.
- Lower privacy risk from derived-cache-only storage.
- Faster first backend slice because Codex parser and analytics concepts can be snapshotted.
- Data Health becomes a first-class mechanism for parser drift and incomplete data.

Negative:

- Fresh UI requires more initial work than copying the webview shell.
- Snapshot fork means upstream improvements are not automatic.
- Codex source-pointer and cache models must be designed instead of reusing the upstream VS Code-oriented cache as-is.
- Some upstream analyzers/rules need filtering or adaptation because they assume IDE-specific fields.

## Follow-Up Work

- Define cache directory, cache schema, and cache versioning.
- Define config file path and schema for additional read-only roots.
- Define parser diagnostics taxonomy and Data Health API shape.
- Select the MVP anti-pattern detectors and mark unsupported detectors explicitly.
- Add privacy tests proving source logs under `~/.codex` are never modified.
