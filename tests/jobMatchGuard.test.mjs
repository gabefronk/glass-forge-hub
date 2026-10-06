import test from 'node:test';
import assert from 'node:assert/strict';
import { normAddress, normName, scoreJobMatch, findJobMatches, eligibleJobs } from '../base44/shared/jobMatchGuard.js';

const job = (canonical_name, address, po_numbers = []) => ({ id: canonical_name, canonical_name, address, po_numbers });

test('normAddress strips suffix words, comma, punctuation; <=5 chars is empty', () => {
  // "Way" is part of the street name (Smart Way), so it is preserved in both
  // forms; only "Lane" (a true suffix) is stripped. The comma form drops the
  // city, leaving the street portion including "way".
  assert.equal(normAddress('7178 Smart Way Lane, Eagle Mountain, UT'), '7178 smart way');
  assert.equal(normAddress('7178 Smart Way Lane Eagle Mountain'), '7178 smart way eagle mountain');
  assert.equal(normAddress('123 Main Street.'), '123 main');
  assert.equal(normAddress('Apt 5'), '');
  assert.equal(normAddress(''), '');
  assert.equal(normAddress('123 Ave'), '123');
});

test('normName strips ready: prefix and stop words', () => {
  assert.equal(normName('hidden hollow 329 glass'), 'hidden hollow 329');
  assert.equal(normName('ready: hidden hollow 329 glass pickup'), 'hidden hollow 329');
  assert.equal(normName('hidden hollow - bldg i unit 329'), 'hidden hollow i 329');
  assert.equal(normName('YA - 19 Ashlar Cove'), '19 ashlar cove');
  assert.equal(normName('done: pickup windows'), '');
});

test('the three spec cases all match each other (MEDIUM)', () => {
  const c1 = job('hidden hollow 329 glass', '');
  const c2 = job('ready: hidden hollow 329 glass pickup', '7178 Smart Way Lane Eagle Mountain');
  const c3 = job('hidden hollow - bldg i unit 329', '', ['YA-0003']);
  const pairs = [[c1, c2], [c1, c3], [c2, c3], [c2, c1], [c3, c1], [c3, c2]];
  for (const [a, b] of pairs) {
    const tier = scoreJobMatch(a, b);
    assert.ok(tier === 'MEDIUM' || tier === 'STRONG', `${a.canonical_name} vs ${b.canonical_name} -> ${tier}`);
  }
});

test('STRONG: same address + same name, and shared PO', () => {
  assert.equal(scoreJobMatch(job('Hidden Hollow 329', '7178 Smart Way Lane'), job('hidden hollow 329 glass', '7178 Smart Way Ln')), 'STRONG');
  assert.equal(scoreJobMatch(job('Some Job', '', ['YA-0003']), job('Other Job', '', ['ya-0003'])), 'STRONG');
});

test('both addresses present and different never match', () => {
  assert.equal(scoreJobMatch(job('Hidden Hollow 329', '7178 Smart Way'), job('Hidden Hollow 329', '999 Other Rd')), null);
});

test('WEAK: same name, one address blank, no shared number', () => {
  assert.equal(scoreJobMatch(job('Hidden Hollow', ''), job('hidden hollow glass', '7178 Smart Way')), 'WEAK');
});

test('eligibleJobs drops is_sample and merged_into', () => {
  const jobs = [job('A', ''), { ...job('B', ''), is_sample: true }, { ...job('C', ''), merged_into: 'x' }];
  assert.equal(eligibleJobs(jobs).length, 1);
});