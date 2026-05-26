# ADR 0002: Codex Log Profiles

## Status

Accepted

## Context

AI Harness Coach needs to analyze more than one local Codex log source set without
requiring separate server instances. The app already has a local-only server,
derived cache, source-pointer model, and browser UI. Profile support must keep
that privacy posture: Codex JSONL files remain read-only inputs, raw prompt and
response text is not persisted by default, and the server does not need a
multi-user authentication model.

The first profile use case is switching between small numbers of local Codex log
sets, such as personal and work logs.

## Decision

Add named Codex log profiles owned by the AI Harness Coach config file.

Profile defaults:

- Profiles are configured as `profiles: [{ id, name, roots }]`.
- If `profiles` is absent, the app synthesizes a backward-compatible `default`
  profile from default Codex roots plus `additionalRoots`.
- Each profile has an automatically derived cache namespace under the configured
  cache directory.
- The server indexes all configured profiles at startup for the expected 2-5
  profile scale.
- If one profile cannot be indexed or cached, the server still starts and exposes
  that profile with degraded status and diagnostics.
- The active profile is browser-local state stored in `localStorage`.

API defaults:

- `GET /api/profiles` lists configured profiles and their status.
- Existing profile-aware endpoints accept `profile=<id>`.
- Omitting `profile` uses the default profile.
- `POST /api/reload?profile=<id>` reloads one profile.
- `POST /api/reload` reloads all profiles.

## Alternatives Considered

### Server-Global Active Profile

Rejected. A server-global switch would make different browser tabs fight over
one active profile and would make requests less explicit.

### Browser Profile CRUD

Rejected for v1. Editing profiles from the UI would require writing the local
config file and expanding the validation and recovery surface. Manual JSON config
is enough for the first profile switching workflow.

### Merged Multi-Profile Index

Rejected. A single merged index would reduce state objects, but it increases the
risk of mixing diagnostics, source-detail reads, and cache behavior across
profiles.

### Codex CLI Config Profile Integration

Rejected for v1. The feature is about selecting AI Harness Coach log source
sets, not controlling Codex CLI runtime profiles.

## Consequences

Positive:

- Profile switching is explicit and easy to debug through query parameters.
- Cache and diagnostics remain isolated per profile.
- Existing single-profile users keep working through the synthesized `default`
  profile.
- The UI can switch profiles without mutating server-global state.

Negative:

- Startup reads every configured profile, which can be expensive for large log
  sets.
- Config remains manual JSON in v1.
- Most API calls now need profile-aware tests to avoid accidental default-profile
  coupling.
