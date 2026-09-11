/**
 * Prepare a Vinext static export for GitHub Pages.
 *
 * Invocation: set NEXT_PUBLIC_BASE_PATH to the repository path (for example,
 * `/hexagon-display`), run the production build, then run this script from the
 * repository root. It recreates `dist/pages`, flattening Vinext's prefixed
 * `_next` directory into the artifact root expected by GitHub Pages. Existing
 * `dist/pages` content is overwritten. The script validates the prefix and
 * required export files, but it does not publish or contact GitHub.
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH;
if (!basePath || !/^\/[A-Za-z0-9._-]+$/.test(basePath)) {
  throw new Error(
    'NEXT_PUBLIC_BASE_PATH must be one repository path such as /hexagon-display.',
  );
}

const repositoryDirectory = basePath.slice(1);
const clientDirectory = path.resolve('dist/client');
const pagesDirectory = path.resolve('dist/pages');
const prefixedDirectory = path.join(clientDirectory, repositoryDirectory);

await rm(pagesDirectory, { recursive: true, force: true });
await mkdir(pagesDirectory, { recursive: true });

const entries = await readdir(clientDirectory, { withFileTypes: true });
for (const entry of entries) {
  if (entry.name === repositoryDirectory || entry.name === '.vite') continue;
  await cp(
    path.join(clientDirectory, entry.name),
    path.join(pagesDirectory, entry.name),
    { recursive: entry.isDirectory() },
  );
}

await cp(
  path.join(prefixedDirectory, '_next'),
  path.join(pagesDirectory, '_next'),
  { recursive: true },
);
