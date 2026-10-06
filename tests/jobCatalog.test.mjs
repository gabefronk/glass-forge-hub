import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCompleteEntity, filterJobPickerOptions, jobMatchesSearch, matchJobTokens } from '../base44/shared/jobCatalog.js';

test('complete entity reads beyond 1,000 records and finds an old duplicate', async () => {
  const rows = Array.from({ length: 2705 }, (_, index) => ({ id: `job-${index}`, canonical_name: `Job ${index}` }));
  rows[2401].canonical_name = 'Old duplicate';
  rows[25].canonical_name = 'Old duplicate';
  const calls = [];
  const entity = { list: async (_sort, limit, skip) => { calls.push({ limit, skip }); return rows.slice(skip, skip + limit); } };

  const complete = await fetchCompleteEntity(entity);
  assert.equal(complete.length, 2705);
  assert.deepEqual(calls.map(call => call.skip), [0, 1000, 2000]);
  assert.equal(complete.filter(job => job.canonical_name === 'Old duplicate').length, 2);
  const decision = matchJobTokens(complete, ['old duplicate'], value => value.toLowerCase());
  assert.equal(decision.status, 'needs_review');
  assert.equal(decision.candidates.length, 2);
});

test('complete reads fail closed when the safety boundary ends on a full page', async () => {
  const entity = { list: async (_sort, limit) => Array.from({ length: limit }, (_, id) => ({ id })) };
  await assert.rejects(fetchCompleteEntity(entity, { pageSize: 2, maxPages: 2 }), /completeness could not be verified/);
});

test('picker search covers exact IDs, names, BFS POs, OEs and YA POs', () => {
  const jobs = [
    { id: 'job_exact_17', canonical_name: 'Summit Creek 17', aliases: ['SC 17'], po_numbers: ['BFS-8842'], oe_numbers: ['OE-991'], ya_po_numbers: ['YA-1007'] },
    { id: 'job-else', canonical_name: 'Other job', po_numbers: [], oe_numbers: [] },
  ];
  for (const query of ['job_exact_17', 'Summit Creek 17', 'BFS-8842', 'OE-991', 'YA-1007']) {
    assert.equal(jobMatchesSearch(jobs[0], query), true, query);
    assert.deepEqual(filterJobPickerOptions(jobs, query).map(job => job.id), ['job_exact_17']);
  }
  const externalYa = new Map([['job-else', ['YA-2042']]]);
  assert.deepEqual(filterJobPickerOptions(jobs, 'YA-2042', { yaPurchaseOrdersByJob: externalYa }).map(job => job.id), ['job-else']);
  assert.deepEqual(filterJobPickerOptions(jobs, 'no match', { selectedId: 'job_exact_17' }).map(job => job.id), ['job_exact_17']);
});


test('a single shared quote word never links cost inputs to a job', () => {
  const jobs = [{ id: 'job-1', canonical_name: 'Justin Hutchins AV24' }];
  const result = matchJobTokens(jobs, ['justin'], value => value.toLowerCase());
  assert.equal(result.status, 'needs_review');
  assert.equal(result.candidates[0].id, 'job-1');
  assert.equal(result.job_id, undefined);
});
