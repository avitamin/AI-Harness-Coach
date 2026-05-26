import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { indexCodexLogs } from '../src/core/codex-parser.js';
import {
  assertTrustedPath,
  isInsideTrustedRoot,
  resolveTrustedRoots
} from '../src/core/path-safety.js';

describe('Path safety', () => {
  it('resolves trusted roots and reports missing or non-directory roots', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-roots-'));
    const validRoot = path.join(base, 'sessions');
    const fileRoot = path.join(base, 'not-a-directory');
    const missingRoot = path.join(base, 'missing');
    await fs.mkdir(validRoot);
    await fs.writeFile(fileRoot, '');

    const resolved = await resolveTrustedRoots([validRoot, fileRoot, missingRoot]);

    assert.deepEqual(resolved.trustedRoots, [await fs.realpath(validRoot)]);
    assert.deepEqual(
      resolved.skippedRoots.map((entry) => entry.reason),
      ['not_directory', 'missing']
    );
  });

  it('rejects sibling-prefix paths and symlinks escaping trusted roots', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-paths-'));
    const trustedRoot = path.join(base, 'codex');
    const siblingRoot = path.join(base, 'codex-other');
    await fs.mkdir(trustedRoot);
    await fs.mkdir(siblingRoot);
    const outsideFile = path.join(siblingRoot, 'session.jsonl');
    const symlinkFile = path.join(trustedRoot, 'escaped.jsonl');
    await fs.writeFile(outsideFile, '{}\n');
    await fs.symlink(outsideFile, symlinkFile);

    const trustedRoots = [await fs.realpath(trustedRoot)];

    assert.equal(isInsideTrustedRoot(outsideFile, trustedRoots), false);
    await assert.rejects(assertTrustedPath(outsideFile, trustedRoots), /outside trusted roots/);
    await assert.rejects(assertTrustedPath(symlinkFile, trustedRoots), /outside trusted roots/);
  });

  it('skips configured roots outside the trusted root set', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'ahc-index-paths-'));
    const trustedRoot = path.join(base, 'trusted');
    const outsideRoot = path.join(base, 'outside');
    await fs.mkdir(trustedRoot);
    await fs.mkdir(outsideRoot);
    await fs.writeFile(
      path.join(outsideRoot, 'outside.jsonl'),
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-05-21T10:00:00.000Z',
        payload: { id: 'outside-session' }
      })
    );

    const trustedRoots = [await fs.realpath(trustedRoot)];
    const index = await indexCodexLogs({ roots: [outsideRoot], trustedRoots });

    assert.equal(index.sessions.length, 0);
    assert.equal(index.diagnostics.filesSeen, 0);
    assert.deepEqual(index.diagnostics.skippedFiles, [
      { path: outsideRoot, reason: 'outside_trusted_roots' }
    ]);
  });
});
