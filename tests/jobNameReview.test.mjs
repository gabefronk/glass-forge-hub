import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentCenterOwner } from '../src/lib/agentCenterAccess.js';

const { formatJobDisplayName, buildNameReviewRows, buildDuplicateReviewPairs, jobMatchesSearch } = await import('../src/lib/jobNameReview.js');

test('formats names deterministically while preserving identifiers and acronyms', () => {
  assert.equal(formatJobDisplayName('  alex stoker res--install  '), 'Alex Stoker Res - Install');
  assert.equal(formatJobDisplayName('home sweet home - lot 7 - bfs po 22'), 'Home Sweet Home - Lot 7 - BFS PO 22');
  assert.equal(formatJobDisplayName('OE 17 / YA PO 8'), 'OE 17 / YA PO 8');
  assert.equal(formatJobDisplayName('McDonald Res - install'), 'McDonald Res - Install');
});

test('blank, ambiguous, and colliding names are never proposed for application', () => {
  assert.equal(formatJobDisplayName(' -- '), '');
  const rows = buildNameReviewRows([
    { id: 'a', canonical_name: '' },
    { id: 'b', canonical_name: 'alex stoker res - install' },
    { id: 'c', canonical_name: 'Alex Stoker Res - Install' },
  ]);
  assert.equal(rows[0].ambiguous, true);
  assert.equal(rows[1].ambiguous, true);
  assert.deepEqual(rows[1].collisionIds, ['c']);
});

test('duplicate review needs two evidence types and respects not-duplicate decisions', () => {
  const a = { id: 'a', canonical_name: 'Home Sweet Home - Lot 2', builder: 'Home Sweet Home', address: '2 Oak Dr' };
  const b = { id: 'b', canonical_name: 'home sweet home lot 2', builder: 'Home Sweet Home', address: '2 Oak Dr' };
  const anotherLot = { id: 'c', canonical_name: 'Home Sweet Home - Lot 3', builder: 'Home Sweet Home', address: '3 Oak Dr' };
  assert.deepEqual(buildDuplicateReviewPairs([a, b, anotherLot]).map((p) => [p.a.id, p.b.id, p.evidence]), [['a', 'b', ['normalized name', 'address', 'customer']]]);
  assert.equal(buildDuplicateReviewPairs([{ ...a, duplicate_exclusions: ['b'] }, b]).length, 0);
});

test('search includes name, aliases, internal ID, BFS PO, OE, and YA PO', () => {
  const job = { id: 'job-42', canonical_name: 'Main Name', aliases: ['Old Name'], po_numbers: ['BFS-8'], oe_numbers: ['OE-9'], ya_po_numbers: ['YA-10'] };
  for (const query of ['main', 'old', 'job-42', 'bfs-8', 'oe-9', 'ya-10']) assert.equal(jobMatchesSearch(job, query), true, query);
  assert.equal(jobMatchesSearch(job, 'missing'), false);
});

test('data review access remains limited to configured admin owners', () => {
  assert.equal(isAgentCenterOwner({ role: 'admin', email: 'gabefronk@gmail.com' }), true);
  assert.equal(isAgentCenterOwner({ role: 'user', email: 'gabefronk@gmail.com' }), false);
  assert.equal(isAgentCenterOwner({ role: 'admin', email: 'crew@example.com' }), false);
});
