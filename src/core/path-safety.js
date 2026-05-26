import fs from 'node:fs/promises';
import path from 'node:path';

export async function resolveTrustedRoots(roots) {
  const trustedRoots = [];
  const skippedRoots = [];

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
      skippedRoots.push({
        path: absoluteRoot,
        reason: error.code === 'ENOENT' ? 'missing' : 'unreadable',
        message: error.message
      });
    }
  }

  return { trustedRoots, skippedRoots };
}

export async function assertTrustedPath(candidatePath, trustedRoots) {
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

export function isInsideTrustedRoot(candidatePath, trustedRoots) {
  const normalizedCandidate = path.resolve(candidatePath);
  return trustedRoots.some((root) => {
    const normalizedRoot = path.resolve(root);
    const relative = path.relative(normalizedRoot, normalizedCandidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  });
}
