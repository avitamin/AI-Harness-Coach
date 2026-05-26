# Repository Documentation Guide

This guide defines the documentation workflow for AI Harness Coach. Read it before creating, changing, or reviewing project documentation in this repository.

## Source Priority

Use this priority order when documentation sources disagree:

1. Current source code, tests, package metadata, and runtime configuration in this repository.
2. Architecture decisions under `docs/adr/`.
3. Product requirements under `docs/prd.md`.
4. External source references pinned to immutable commits, especially `microsoft/AI-Engineering-Coach` links that include a commit SHA.
5. Agent-facing notes under `.ai/docs/`.

If implementation does not exist yet, document the requirement or decision as planned behavior. Do not present planned behavior as current product capability.

## Documentation Ownership

- `docs/prd.md` owns product goals, users, MVP scope, non-goals, user flows, acceptance criteria, risks, and open questions.
- `docs/adr/` owns durable architecture decisions. Use numbered ADR files with descriptive kebab-case names, for example `0001-standalone-codex-local-web-app.md`.
- `.ai/docs/repo-documentation-guide.md` owns repository-specific documentation rules for agents.
- Future `README.md` should own the public landing page, quick start, and user-facing summary once the app has runnable behavior.

Create a new document only when no existing owner clearly fits the topic. Prefer updating the nearest owner document for small changes.

## External Source References

AI Harness Coach starts from a snapshot of reusable ideas and modules in `microsoft/AI-Engineering-Coach`.

- Use commit-pinned GitHub links for source references.
- Record the upstream commit SHA when documenting snapshot decisions.
- Do not rely on local absolute paths in committed documentation except as temporary exploration notes.
- Treat copied upstream code as a snapshot unless a later ADR chooses a package, subtree, or submodule strategy.

## Indexing Policy

- When adding a new ADR, use the next available numeric prefix.
- If a future `README.md` or documentation index exists, add discoverability links for `docs/prd.md` and `docs/adr/`.
- Do not link to generated build output.

## Verification Matrix

- Markdown-only changes: check links manually; run a spellcheck command if one exists in project tooling.
- PRD changes: verify claims against existing ADRs, current implementation when present, and pinned upstream references.
- ADR changes: verify alternatives, consequences, and source references against the relevant code/docs.
- Documentation describing current implementation must be backed by files in this repository. Documentation describing intended behavior must be labeled as planned or required.

If validation tooling is unavailable because the repository has not been bootstrapped yet, report the manual checks performed and the absence of tooling.

## Style

- Use concise technical English.
- Separate decisions from open questions and risks.
- Prefer concrete paths, commands, and source links over vague descriptions.
- Keep Markdown simple: headings, short paragraphs, bullet lists, and tables where useful.
- Avoid user-facing claims such as "supported" or "available" until the behavior exists.

## Completion Criteria

Before finishing a documentation task:

1. Identify the document owner before creating a new file.
2. Verify factual claims against the highest-priority available source.
3. Use pinned links for external source references.
4. Update indexes if an index exists and should expose the new document.
5. Report changed documents, checked sources, validation run, and remaining assumptions.
