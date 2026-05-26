# Repository Guidelines

## Purpose

AI Harness Coach is a local-first Node.js web app for Codex CLI analytics. It reads local Codex session logs, derives metrics, and shows a browser dashboard without depending on VS Code APIs.

Treat this file as the quick agent entrypoint. Prefer linking to durable sources instead of copying their details here.

## Repository Map

- `docs/prd.md` owns product goals, MVP scope, requirements, risks, and acceptance criteria.
- `docs/adr/` owns durable architecture decisions. Use numbered kebab-case filenames such as `0002-cache-layout.md`.
- `docs/adr/0001-standalone-codex-local-web-app.md` defines the `core`, `server`, `web`, and `fixtures` boundaries.
- `docs/adr/0002-codex-log-profiles.md` defines named Codex log profile behavior.
- `.ai/docs/repo-documentation-guide.md` owns documentation workflow, source priority, and verification rules for agents.

## How To Work Here

Ground claims in repository sources before editing. For documentation work, read `.ai/docs/repo-documentation-guide.md` first and follow its source priority. If implementation does not exist yet, describe behavior as planned or required, not current.

Keep changes narrow. Update the nearest owner document rather than creating new files unless no owner fits. For ADRs, use the next numeric prefix and a descriptive kebab-case title.

## Current State

The app has a Node.js/TypeScript scaffold with a local server, browser UI, parser/analytics core, fixtures, and automated tests.

Useful inspection commands:

- `rg --files` to list project files.
- `sed -n '1,220p' package.json` to review scripts.
- `sed -n '1,220p' docs/prd.md` to review product requirements.
- `sed -n '1,220p' docs/adr/0001-standalone-codex-local-web-app.md` to review the accepted architecture baseline.
- `sed -n '1,220p' docs/adr/0002-codex-log-profiles.md` to review profile switching decisions.

## Validation

For Markdown-only changes, manually check referenced paths and confirm claims against the PRD, ADRs, code, tests, and repo documentation guide.

For code changes, prefer focused tests first, then run:

```bash
npm test
```

Use `npm run typecheck`, `npm run test:unit`, or `npm run test:e2e` when a narrower validation pass is enough during iteration.

## Commit & Pull Request Guidance

Because there are no commits yet, use clear imperative subjects such as `Add parser diagnostics ADR`. Pull requests should include context, validation performed, linked issue if available, and screenshots for future UI changes.

## Privacy Constraints

The MVP is privacy-sensitive. Do not write to Codex session files under `~/.codex`. Do not persist raw prompt or response text by default; treat it as source data loaded only for explicit detail views.
