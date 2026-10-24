// Owner-id guard tests (base44/shared/purchasingMoneyPure.js). No SDK, no I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isPurchasingMoneyOwner, isEntityId, OWNER_IDS } from '../base44/shared/purchasingMoneyPure.js';

// Exact 24-hex record id (Base44 id format); 'j1' style ids are rejected.
const JOB = 'aaaaaaaaaaaaaaaaaaaaaaaa';

test('OWNER_IDS binds the two immutable owner auth ids, not role/email', () => {
  assert.ok(OWNER_IDS.has('6a7f0d834a5f825c724273ea'));
  assert.ok(OWNER_IDS.has('6a8229a9801b2aef9278ff47'));
  assert.equal(OWNER_IDS.size, 2);
});

test('isPurchasingMoneyOwner: owner id passes', () => {
  assert.ok(isPurchasingMoneyOwner({ id: '6a7f0d834a5f825c724273ea', role: 'admin' }));
  assert.ok(isPurchasingMoneyOwner({ id: '6a8229a9801b2aef9278ff47', role: 'admin' }));
});

test('isPurchasingMoneyOwner: another admin (wrong id) rejected — admin role is not enough', () => {
  assert.ok(!isPurchasingMoneyOwner({ id: 'other-admin-id', role: 'admin' }));
});

test('isPurchasingMoneyOwner: crew (role user) rejected', () => {
  assert.ok(!isPurchasingMoneyOwner({ id: 'crew-id', role: 'user' }));
});

test('isPurchasingMoneyOwner: unauth / null / empty rejected', () => {
  assert.ok(!isPurchasingMoneyOwner(null));
  assert.ok(!isPurchasingMoneyOwner(undefined));
  assert.ok(!isPurchasingMoneyOwner({}));
});

test('isEntityId: exact 24-hex record ids only', () => {
  assert.equal(isEntityId('a'.repeat(24)), true);
  assert.equal(isEntityId('j1'), false);
  assert.equal(isEntityId('A'.repeat(24)), false);
});
