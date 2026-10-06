import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveJobLink } from '../base44/shared/jobLinkResolver.js';

const jobs = [
  { id: 'job-1', canonical_name: 'Smith Residence', aliases: ['Smith Home'], po_numbers: ['YA-100'], oe_numbers: ['OE 7'], address: '1 Main' },
  { id: 'job-2', canonical_name: 'Jones Residence', aliases: ['Shared'], po_numbers: [], oe_numbers: [] },
  { id: 'job-3', canonical_name: 'Other', aliases: ['Shared'], po_numbers: [], oe_numbers: [] },
];

test('Probuild project link wins over other evidence', () => assert.deepEqual(resolveJobLink({ project_id: 'p1', po_number: 'YA-100' }, jobs, [{ project_id: 'p1', job_id: 'job-2' }]), { job_id: 'job-2', source: 'probuild_project' }));
test('exact PO and OE resolve jobs', () => {
  assert.equal(resolveJobLink({ po_number: 'ya 100' }, jobs).job_id, 'job-1');
  assert.equal(resolveJobLink({ oe_number: 'oe-7' }, jobs).job_id, 'job-1');
});
test('a single exact normalized name or alias resolves', () => assert.equal(resolveJobLink({ job_name: ' SMITH-home ' }, jobs).job_id, 'job-1'));
test('ambiguous exact names remain unlinked', () => assert.deepEqual(resolveJobLink({ job_name: 'shared' }, jobs), { job_id: '', source: null, ambiguous: true }));
test('an existing job id is untouched', () => assert.deepEqual(resolveJobLink({ job_id: 'job-old', job_name: 'Smith Residence' }, jobs), { job_id: 'job-old', source: null, unchanged: true }));
