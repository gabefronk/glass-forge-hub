// Rebuild the research-queue deployment entry from its tested shared modules.
// Does not deploy, authenticate, or change entities.
//
// Why: a published function that imports a shared .mjs module does not load, so
// research-queue ships as one self-contained file. esbuild inlines every relative
// import of base44/shared/researchQueueEntry.ts and leaves the npm: SDK import alone.
// Tests: tests/researchQueueFastPath.test.mjs (and the shared module tests).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = new URL('../', import.meta.url);
export const RESEARCH_QUEUE_HEADER = '// Generated from tested shared queue modules. Owner-review drafts only.\n// Rebuild with: node scripts/build-research-queue-entry.mjs (do not edit by hand).\n';

export async function buildResearchQueueEntry() {
  const out = await build({
    entryPoints: [fileURLToPath(new URL('base44/shared/researchQueueEntry.ts', root))],
    bundle: true, format: 'esm', platform: 'neutral', external: ['npm:*'], write: false, logLevel: 'warning',
  });
  const code = out.outputFiles[0].text;
  if (/^\s*import\s[^\n]*from\s+["']\.{1,2}\//m.test(code)) throw new Error('Bundle still has a relative import.');
  return RESEARCH_QUEUE_HEADER + code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fs.writeFileSync(new URL('base44/functions/research-queue/entry.ts', root), await buildResearchQueueEntry());
  console.log('Rebuilt base44/functions/research-queue/entry.ts from tested shared modules; not deployed.');
}
