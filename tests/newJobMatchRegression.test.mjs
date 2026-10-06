// Focused regression tests for the create-job-flow duplicate matching:
//   1. normAddress preserves meaningful street names ("Smart Way") while
//      safely stripping true suffixes ("Lane").
//   2. findMatchWarnings catches exact name, exact PO, and same-address
//      duplicates; different lots/communities stay separate.
//   3. Repeated visits for the same customer + address resolve to the same
//      STRONG match across calls (no duplicate job created).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normAddress, findJobMatches, eligibleJobs } from '../base44/shared/jobMatchGuard.js';
import { findMatchWarnings } from '../src/lib/newJob.js';

const job = (id, canonical_name, address, po_numbers = []) => ({ id, canonical_name, address, po_numbers });

test('normAddress preserves "way" as part of a street name, strips true suffixes', () => {
  // "Smart Way" is the street name; "Lane" is a suffix. Both forms keep "way".
  assert.equal(normAddress('7178 Smart Way Lane, Eagle Mountain, UT'), '7178 smart way');
  assert.equal(normAddress('7178 Smart Way Lane Eagle Mountain'), '7178 smart way eagle mountain');
  assert.equal(normAddress('7178 Smart Way'), '7178 smart way');
  // True suffixes are still stripped.
  assert.equal(normAddress('123 Main Street.'), '123 main');
  assert.equal(normAddress('123 Ave'), '123');
  // Short / empty → no address.
  assert.equal(normAddress('Apt 5'), '');
  assert.equal(normAddress(''), '');
});

test('STRONG: same address (with preserved "way") + same name', () => {
  const existing = [job('j1', 'Hidden Hollow 329', '7178 Smart Way Lane')];
  const w = findMatchWarnings(existing, { canonical_name: 'Hidden Hollow 329', address: '7178 Smart Way Ln', po_number: '' });
  assert.equal(w.strong.length, 1);
  assert.equal(w.strong[0].id, 'j1');
});

test('exact name search finds the duplicate even without an address', () => {
  const existing = [job('j1', 'Shelby Homes - 215 Skyridge', '')];
  const w = findMatchWarnings(existing, { canonical_name: 'Shelby Homes - 215 Skyridge', address: '', po_number: '' });
  // Same name, one address blank → WEAK (not STRONG), but still surfaces.
  assert.equal(w.weak.length, 1);
  assert.equal(w.weak[0].id, 'j1');
});

test('exact PO number search finds the duplicate', () => {
  const existing = [job('j1', 'Some Job', '', ['PO-7196067'])];
  const w = findMatchWarnings(existing, { canonical_name: 'Different Name', address: '999 Other Rd', po_number: 'po-7196067' });
  assert.equal(w.strong.length, 1);
  assert.equal(w.strong[0].id, 'j1');
});

test('different lots at the same street do not STRONG-match (different address)', () => {
  const existing = [job('j1', 'Shelby Homes - 215 Skyridge', '215 Skyridge Dr')];
  const w = findMatchWarnings(existing, { canonical_name: 'Shelby Homes - 217 Skyridge', address: '217 Skyridge Dr', po_number: '' });
  assert.equal(w.strong.length, 0);
  assert.equal(w.medium.length, 0);
});

test('repeated visits: same customer + address resolves to the same STRONG match across calls', () => {
  const existing = [job('j1', 'Pulte Home - 2154 Jordanelle Ridge', '2154 Jordanelle Ridge Dr')];
  // First visit
  const w1 = findMatchWarnings(existing, { canonical_name: 'Pulte Home - 2154 Jordanelle Ridge', address: '2154 Jordanelle Ridge Drive', po_number: '' });
  // Second visit (slightly different name spelling, same address)
  const w2 = findMatchWarnings(existing, { canonical_name: 'Pulte Homes - 2154 Jordanelle Ridge Dr', address: '2154 Jordanelle Ridge Dr', po_number: '' });
  // Both resolve to the same job — no duplicate would be created.
  assert.equal(w1.strong.length, 1);
  assert.equal(w2.strong.length, 1);
  assert.equal(w1.strong[0].id, 'j1');
  assert.equal(w2.strong[0].id, 'j1');
});

test('eligibleJobs drops is_sample and merged_into', () => {
  const jobs = [job('a', 'A', ''), { ...job('b', 'B', ''), is_sample: true }, { ...job('c', 'C', ''), merged_into: 'a' }];
  assert.equal(eligibleJobs(jobs).length, 1);
});