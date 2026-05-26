import fs from 'node:fs/promises';
import path from 'node:path';
import type { SkippedPathDiagnostic } from './types.js';

export async function resolveTrustedRoots(
  roots: string[]
): Promise<{ trustedRoots: string[]; skippedRoots: SkippedPathDiagnostic[] }> {
  const trustedRoots: string[] = [];
  const skippedRoots: SkippedPathDiagnostic[] = [];

  for (const root of roots) {
    const absoluteRoot = path.resolve(root);
    try {
      const stat = await fs.stat(absoluteRoot);
      if (!stat.isDirectory()) {
        skippedRoots.push({ path: absoluteRoot, reason: 'not_directory' });
        continue;
      }
      trustedRoots.push(await fs.realpath(absoluteRoot));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skippedRoots.push({
        path: absoluteRoot,
        reason: isNodeError(error) && error.code === 'ENOENT' ? 'missing' : 'unreadable',
        message
      });
    }
  }

  return { trustedRoots, skippedRoots };
}

export async function assertTrustedPath(candidatePath: string, trustedRoots: string[]): Promise<string> {
  const resolved = path.resolve(candidatePath);
  let realPath;

  try {
    realPath = await fs.realpath(resolved);
  } catch (error) {
    throw new Error(`Path is not readable: ${resolved}`);
  }

  if (!isInsideTrustedRoot(realPath, trustedRoots)) {
    throw new Error(`Path is outside trusted roots: ${resolved}`);
  }

  return realPath;
}

export function isInsideTrustedRoot(candidatePath: string, trustedRoots: string[]): boolean {
  const normalizedCandidate = path.resolve(candidatePath);
  return trustedRoots.some((root) => {
    const normalizedRoot = path.resolve(root);
    const relative = path.relative(normalizedRoot, normalizedCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
