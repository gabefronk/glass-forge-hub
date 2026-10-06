import test from 'node:test';
import assert from 'node:assert/strict';
import { jobMatchesSearch } from '../src/lib/jobSearch.js';

const job = {
  id: 'JOB-record-12345', canonical_name: 'Canyon House', aliases: ['Smith Residence'],
  address: '10 Main Street', po_numbers: ['PO-7788'], oe_numbers: ['OE-9911'],
};

test('job search retains business fields and adds exact or prefix record id', () => {
  for (const query of ['canyon', 'smith', 'main street', 'po-7788', 'oe-9911', 'job-record-12345', 'job-rec']) {
    assert.equal(jobMatchesSearch(job, query), true, query);
  }
  assert.equal(jobMatchesSearch(job, 'record-123'), false, 'job id is not a substring match');
  assert.equal(jobMatchesSearch(job, 'unrelated'), false);
});
