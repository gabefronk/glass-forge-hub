import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { jobMatchesSearch } from '../src/lib/jobSearch.js';

test('Jobs Hub delegates search to the shared identity matcher', () => {
  const source = fs.readFileSync(new URL('../src/pages/JobsHub.jsx', import.meta.url), 'utf8');
  assert.match(source, /jobMatchesSearch\(j, q\)/);
  const job = { id: 'job-409', canonical_name: 'Test Name', aliases: ['Alias'], address: '123 Main', po_numbers: ['PO-10'], oe_numbers: ['OE-20'] };
  for (const query of ['job-409', 'test name', 'alias', '123 main', 'PO-10', 'OE-20']) assert.equal(jobMatchesSearch(job, query), true, query);
  assert.equal(jobMatchesSearch(job, 'unrelated'), false);
});
