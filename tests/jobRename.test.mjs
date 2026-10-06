import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { renamePatch, planMatchesJob } = await import('../src/lib/jobNames.js');

test('renaming keeps the old name as an alias, deduped, and refuses blanks', () => {
  const job = { canonical_name: 'skyridge 214', aliases: ['Skyridge Lot 214', 'skyridge 214'] };
  assert.deepEqual(renamePatch(job, '  Skyridge   214 Warranty '), { canonical_name: 'Skyridge 214 Warranty', aliases: ['skyridge 214', 'Skyridge Lot 214'] });
  assert.throws(() => renamePatch(job, '   '), /name/);
  assert.ok(planMatchesJob({ job_name: 'SKYRIDGE 214' }, { canonical_name: 'Skyridge 214 Warranty', aliases: ['skyridge 214'] }));
  assert.ok(!planMatchesJob({ job_name: 'Other' }, { canonical_name: 'Skyridge 214 Warranty', aliases: [] }));
});
