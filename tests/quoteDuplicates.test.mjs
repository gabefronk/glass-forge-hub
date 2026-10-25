// Spotting a second copy of the same quote on one job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateOf, replacedByQuote } from '../src/lib/quoteDuplicates.js';

const a = { id: 'a', job_id: 'j', quote_number: '3517590', vendor: 'AMSCO', source_sha256: 'x' };
const b = { id: 'b', job_id: 'j', quote_number: '3517590', vendor: 'AMSCO WINDOWS', source_sha256: 'y' };
const money = { id: 'm', job_id: 'j', quote_number: null, title: 'job money (no vendor quote)' };

test('same quote number from the same supplier (AMSCO = AMSCO WINDOWS) is a duplicate', () => {
  assert.equal(duplicateOf(a, [a, b]).id, 'b');
  assert.equal(duplicateOf(b, [a, b]).id, 'a');
});

test('the same uploaded file twice is a duplicate even without a quote number', () => {
  const c = { id: 'c', job_id: 'j', source_sha256: 'z' }, d = { id: 'd', job_id: 'j', source_sha256: 'z' };
  assert.equal(duplicateOf(c, [c, d]).id, 'd');
});

test('different jobs, different quote numbers, other suppliers and removed copies are not duplicates', () => {
  assert.equal(duplicateOf(a, [a, { ...b, job_id: 'k' }]), null);
  assert.equal(duplicateOf(a, [a, { ...b, quote_number: '1' }]), null);
  assert.equal(duplicateOf(a, [a, { ...b, vendor: 'Pella', manufacturer: 'Pella' }]), null);
  assert.equal(duplicateOf(a, [a, { ...b, deleted_at: '2026-10-24' }]), null);
});

test('a job-money placeholder is replaced once a real vendor quote is on the job', () => {
  assert.equal(replacedByQuote(money, [money, a]), true);
  assert.equal(replacedByQuote(money, [money]), false);
  assert.equal(replacedByQuote(a, [money, a]), false);
});
