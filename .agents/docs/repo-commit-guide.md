# Repo Commit Guide

This guide defines repository-specific commit preparation rules for AI Harness Coach.

## Source Priority

Fact: `AGENTS.md` is the quick agent entrypoint and says to ground work in repository sources.

Use this priority order when commit rules or scope signals disagree:

1. Explicit user request in the current conversation.
2. This repo commit guide.
3. `AGENTS.md`.
4. Current source code, tests, package metadata, runtime configuration, and documentation in this repository.
5. Current branch name and git status.
6. Recent commit history, once commits exist.

Conservative default: The actual diff being committed controls the final commit subject. Do not describe files or behavior that are not staged for the commit.

## Commit Message Format

Fact: `AGENTS.md` says there are no commits yet and gives examples of clear imperative subjects such as:

```text
Add parser diagnostics ADR
```

Use short imperative subjects without a trailing period:

```text
Verb concise object
```

Examples:

```text
Implement Codex analytics MVP
Add parser diagnostics ADR
Document local dashboard startup
Fix parser coverage reporting
```

Conservative default: Prefer specific verbs such as `Add`, `Implement`, `Update`, `Document`, `Fix`, `Remove`, or `Refactor`. Keep the subject focused on the staged diff.

## Issue Key Rules

Fact: Current repository documentation does not require an issue key in commit subjects.

Conservative default: Do not add an issue key unless the user explicitly provides one or future repository documentation requires one for the current work.

## Branch Policy

Fact: The current branch is `main`, and the repository currently has no commits.

Fact: No repository document currently defines protected branches, required branch naming, or issue-key branch matching.

Conservative default: Direct commits to `main` are allowed for the initial repository bootstrap. For later work, prefer a topic branch if the user requests one or if repository policy is added.

## Staging Policy

Fact: The repository currently contains untracked bootstrap files and no commit history.

Stage only files that were reviewed and belong to the requested commit scope. Do not stage generated or local-only files such as `node_modules/`, `.cache/`, `.playwright-cli/`, or `.local/`.

Conservative default: If unrelated changes are present, keep them out of the commit unless the user explicitly asks to include them and they have been reviewed.

## Validation Policy

Fact: `package.json` defines these scripts:

```text
npm run dev
npm start
npm test
```

Fact: `README.md` lists `npm test` as the project validation command.

For code, test, parser, API, cache, or UI changes, run:

```bash
npm test
git diff --check
```

For Markdown-only changes, run:

```bash
git diff --check
```

Conservative default: For UI-facing changes, include a browser smoke check when practical and report whether it was run.

## Missing Facts And Defaults

Fact: There is no commit history yet, so message format is derived from `AGENTS.md`, not from historical subjects.

Fact: There is no documented issue-key requirement, release process, PR template, changelog policy, or protected-branch policy.

Conservative default: Keep commits narrow, use imperative subjects, run the relevant validation commands above, and report any validation that could not be run.
