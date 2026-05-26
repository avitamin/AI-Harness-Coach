# AI Harness Coach

AI Harness Coach is a local-first Node.js dashboard for Codex CLI analytics. It reads local Codex JSONL session logs, builds derived metrics, and serves a browser UI on loopback without VS Code APIs.

## Quick Start

```bash
npm run dev
```

Then open `http://127.0.0.1:4317`.

The server binds only to loopback hosts. It uses `127.0.0.1` by default. Override with `PORT` when needed:

```bash
PORT=4320 npm run dev
```

## What It Reads

Default Codex roots:

- `~/.codex/sessions`
- `~/.codex/archived_sessions`
- `~/.codex/archived-sessions`

Named log profiles can be added in `~/.ai-harness-coach/config.json`:

```json
{
  "profiles": [
    {
      "id": "default",
      "name": "Default Codex",
      "roots": [
        "~/.codex/sessions",
        "~/.codex/archived_sessions",
        "~/.codex/archived-sessions"
      ]
    },
    {
      "id": "work",
      "name": "Work Codex",
      "roots": ["/path/to/work/codex/jsonl/root"]
    }
  ]
}
```

The browser profile selector stores the active profile id in `localStorage`.
Each profile uses an isolated derived cache under the configured cache directory.

For backward compatibility, optional additional roots can still be added without
profiles:

```json
{
  "additionalRoots": ["/path/to/extra/codex/jsonl/root"]
}
```

## Privacy

- Source Codex JSONL files are read-only inputs.
- The derived cache stores metrics, parser diagnostics, and source pointers.
- Raw prompt and response text is not stored in the derived cache.
- Session detail text is loaded on demand from the original JSONL source.
- No telemetry is sent.

The default cache directory is `~/.cache/ai-harness-coach`. Override with `AHC_CACHE_DIR`.

## API

- `GET /api/health`
- `GET /api/profiles`
- `GET /api/index/status`
- `POST /api/reload`
- `POST /api/cache/clear`
- `GET /api/dashboard`
- `GET /api/sessions`
- `GET /api/sessions/:id`
- `GET /api/parser-coverage`
- `GET /api/output-tokens`
- `GET /api/anti-patterns`

Profile-aware endpoints accept `profile=<id>` as a query parameter. Without it,
they use the default profile. `POST /api/reload?profile=<id>` reloads one
profile; `POST /api/reload` reloads all profiles. Reload-all responses include
the number of successfully reloaded profiles and the full profile list; callers
should inspect each profile's `error` field to detect partial failures.

`GET /api/sessions` also supports `search`, `from`, `to`, `workspace`, `model`,
`status`, `limit`, and `offset` query parameters.

## Validation

```bash
npm test
```

The browser e2e suite uses Playwright. On a fresh machine, install the Chromium
browser binary once:

```bash
npx playwright install chromium
```

Run suites separately when needed:

```bash
npm run test:unit
npm run test:e2e
```
