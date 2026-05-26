# Repository Guidelines

## Purpose

AI Harness Coach is a planned local-first Node.js web app for Codex CLI analytics. It should read local Codex session logs, derive metrics, and show a browser dashboard without depending on VS Code APIs.

Treat this file as the quick agent entrypoint. Prefer linking to durable sources instead of copying their details here.

## Repository Map

- `docs/prd.md` owns product goals, MVP scope, requirements, risks, and acceptance criteria.
- `docs/adr/` owns durable architecture decisions. Use numbered kebab-case filenames such as `0002-cache-layout.md`.
- `docs/adr/0001-standalone-codex-local-web-app.md` defines the planned `core`, `server`, `web`, and `fixtures` boundaries.
- `.ai/docs/repo-documentation-guide.md` owns documentation workflow, source priority, and verification rules for agents.

## How To Work Here

Ground claims in repository sources before editing. For documentation work, read `.ai/docs/repo-documentation-guide.md` first and follow its source priority. If implementation does not exist yet, describe behavior as planned or required, not current.

Keep changes narrow. Update the nearest owner document rather than creating new files unless no owner fits. For ADRs, use the next numeric prefix and a descriptive kebab-case title.

## Current State

The app has not been scaffolded. There is no `package.json`, runnable server, source tree, automated test command, or established commit history yet.

Useful inspection commands:

- `rg --files` to list project files.
- `sed -n '1,220p' docs/prd.md` to review product requirements.
- `sed -n '1,220p' docs/adr/0001-standalone-codex-local-web-app.md` to review the accepted architecture baseline.

## Validation

For Markdown-only changes, manually check referenced paths and confirm claims against the PRD, ADRs, and repo documentation guide. There is no project spellcheck, lint, build, or test command yet.

When implementation starts, add focused tests for parser fixtures, API behavior, cache privacy, and browser smoke coverage as described in `docs/prd.md`.

## Commit & Pull Request Guidance

Because there are no commits yet, use clear imperative subjects such as `Add parser diagnostics ADR`. Pull requests should include context, validation performed, linked issue if available, and screenshots for future UI changes.

## Privacy Constraints

The MVP is privacy-sensitive. Do not write to Codex session files under `~/.codex`. Do not persist raw prompt or response text by default; treat it as source data loaded only for explicit detail views.
