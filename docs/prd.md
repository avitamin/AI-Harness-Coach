# AI Harness Coach PRD

## Summary

AI Harness Coach is a standalone local web app for Codex CLI usage analytics. It reads Codex session logs from the user's machine, normalizes them into an analytics model, and shows a browser dashboard without depending on VS Code extension APIs.

The MVP is local-first, single-user, and Codex-only. It starts from a snapshot of reusable ideas and core modules in `microsoft/AI-Engineering-Coach` at commit [`9007bed3130b4c0784efe6f2990e2f3c03d13e3a`](https://github.com/microsoft/AI-Engineering-Coach/tree/9007bed3130b4c0784efe6f2990e2f3c03d13e3a).

## Goals

- Show how often the user uses Codex CLI across local sessions.
- Let the user switch between named local Codex log profiles.
- Show active workspaces, models, token totals, tools, edited files, and recent activity.
- Identify long, aborted, incomplete, or weakly validated Codex sessions where the available data supports that analysis.
- Explain parser/data coverage clearly, including missing token data, unsupported event types, unreadable files, invalid JSON lines, and skipped paths.
- Preserve a privacy posture of local analysis, read-only source logs, no telemetry, and no raw prompt/response text persisted by default.

## Non-Goals

- No VS Code extension shell, activity bar, webview message transport, or VS Code memento storage.
- No multi-harness comparison in the MVP.
- No Copilot language-model-assisted features.
- No Learning Center, achievements, share cards, image gallery, or full rule editor.
- No remote/team mode, authentication system, or multi-user deployment.
- No writes to Codex session files.

## Users And Use Cases

Primary user: a developer using Codex CLI locally who wants a private view of their AI-assisted engineering practice.

Core use cases:

- Open a local dashboard and see total sessions, requests, active days, active workspaces, model usage, token totals, top tools, edited files, and recent activity.
- Switch between named Codex log profiles for different local log root sets.
- Inspect a timeline/session list with search and filters.
- Open a session detail view that reads raw prompt/response text on demand from the original JSONL source.
- Review generated code/output summaries and token coverage.
- Review basic anti-pattern findings that are meaningful for Codex data.
- Check Data Health to understand which logs were read, skipped, partially parsed, or missing token coverage.

## MVP Requirements

### Runtime

- Run as a Node.js local server with a browser UI.
- Bind only to loopback/localhost.
- Do not require login for the single-user MVP.
- Provide a development run command and a packaged start command in later implementation work.

### Ingestion

- Discover default Codex roots:
  - `~/.codex/sessions`
  - `~/.codex/archived_sessions`
  - `~/.codex/archived-sessions`
- Support named read-only log profiles from a config file.
- Keep `additionalRoots` as a backward-compatible default-profile config path.
- Validate every file path against configured trusted roots and reject traversal.
- Stream Codex JSONL files rather than reading large files fully into memory.
- Normalize parsed logs into session/request records compatible with the analytics core.
- Keep source pointers for on-demand session detail reads.

Relevant upstream references:

- Codex parser: [`src/core/parser-codex.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/core/parser-codex.ts)
- Session types: [`src/core/types/session-types.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/core/types/session-types.ts)
- Parser fixtures/tests: [`src/core/parser-codex.test.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/core/parser-codex.test.ts), [`src/core/parser-codex-extra.test.ts`](https://github.com/microsoft/AI-Engineering-Coach/blob/9007bed3130b4c0784efe6f2990e2f3c03d13e3a/src/core/parser-codex-extra.test.ts)

### Cache And Privacy

- Store derived metrics, indexes, parser diagnostics, and source pointers by default.
- Isolate derived cache data per profile under the configured cache directory.
- Do not persist full raw prompt/response text by default.
- Load raw text only for explicit session detail views.
- Provide a clear-cache action.
- Do not send telemetry or logs to external services.

### API

The first slice should expose at least:

- `GET /api/health`
- `GET /api/profiles`
- `GET /api/index/status`
- `POST /api/reload`
- `GET /api/dashboard`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/parser-coverage`

Profile-aware API endpoints should accept `profile=<id>` and fall back to the default profile when the query parameter is omitted. `POST /api/reload?profile=<id>` reloads one profile; `POST /api/reload` reloads all profiles.

Filters should support date range, workspace, model, and session status. Harness filtering is not required for the MVP because all parsed sessions are Codex.

### UI

Build a fresh browser UI rather than porting the VS Code webview shell directly.

MVP pages:

- Dashboard: sessions, requests, active days, workspaces, models, token totals, edited files, top tools, and recent activity.
- Profile selector: browser-local selection of the active Codex log profile.
- Timeline/Sessions: timeline, paged session list, search, filters, and detail drawer.
- Output/Tokens: code block summaries, edited-file counts, token usage by model, cache-read totals, and coverage warnings.
- Anti-Patterns: Codex-meaningful session hygiene, review/validation, tool use, and context-management findings.
- Data Health: log roots, last index time, skipped files, parse warnings, unsupported event counts, and missing token coverage.

## First Vertical Slice

The first implementation slice is successful when:

- The server starts locally and indexes real `~/.codex` logs.
- Configured profiles are indexed at startup, and profile switching updates dashboard/session data.
- The dashboard shows real sessions, workspaces, models, tokens, tools, and edited files.
- The sessions view can open a detail view from source JSONL on demand.
- Parser coverage reports unsupported event counts and skipped/invalid files.
- Source Codex log files are not modified.

## Risks And Unknowns

- Codex JSONL shape may drift. Unknown event types must be counted and shown in Data Health rather than silently ignored.
- Existing upstream orchestration is multi-harness and VS Code/Xcode oriented; it should not be copied as-is.
- Existing upstream cache stores under a Copilot analytics name and reloads full text from VS Code-specific source pointers; the MVP needs a Codex-specific cache and source-pointer model.
- Some analytics and rules assume IDE-specific fields such as referenced files, custom instructions, screenshots, or VS Code/Copilot behavior.
- Fresh UI reduces VS Code coupling but increases initial UI build work.
- Token coverage depends on Codex `token_count` records and may be partial or unavailable for some sessions.
- Indexing every configured profile at startup improves switch latency but increases startup I/O for large profile sets.

## Open Questions

- Exact parser diagnostic taxonomy for unsupported records.
- Whether model filter and session-status filter should be query parameters only or also represented in persisted UI state.
- Which anti-pattern detectors are enabled in MVP and which are marked unsupported.

## Acceptance And Validation

- Parser fixture tests cover active, archived, invalid, large, aborted, tool-call, reasoning-effort, model-switching, duplicate-message, and token-count sessions.
- API tests cover health, reload, sessions list/detail, filters, token coverage, and parser coverage.
- Profile tests cover config parsing, profile routing, per-profile cache isolation, degraded profile startup, and browser-local profile selection.
- Cache tests prove version invalidation, clear-cache behavior, per-profile isolation, and no raw-text persistence by default.
- Privacy tests prove the app does not modify files under `~/.codex`.
- Browser smoke tests cover Dashboard, Timeline/Sessions, Output/Tokens, Anti-Patterns, and Data Health.
