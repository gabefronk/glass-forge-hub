import test from 'node:test';
import assert from 'node:assert/strict';
import { uniqueLegacyNames } from '../src/lib/jobLegacyNames.js';

test('duplicate names and aliases never connect another job by legacy name', () => {
  const jobs = [
    { id: 'a', canonical_name: 'Smith Residence', aliases: ['Smith'] },
    { id: 'b', canonical_name: 'Jones Residence', aliases: ['Smith'] },
    { id: 'c', canonical_name: 'Unique Job', aliases: [] },
  ];
  assert.deepEqual(uniqueLegacyNames(jobs, ['a']), ['smith residence']);
  assert.deepEqual(uniqueLegacyNames(jobs, ['b']), ['jones residence']);
  const names = uniqueLegacyNames(jobs, ['a']);
  assert.equal(names.includes('smith'), false);
  assert.equal(names.includes('smith residence'), true);
});

test('duplicate Jobs records in one presentation group retain legacy name', () => {
  const jobs = [{ id: 'a', canonical_name: 'Same Job' }, { id: 'a2', canonical_name: 'Same Job' }];
  assert.deepEqual(uniqueLegacyNames(jobs, ['a', 'a2']), ['same job']);
});
