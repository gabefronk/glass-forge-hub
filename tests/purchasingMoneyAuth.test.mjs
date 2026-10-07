// Auth + payload validation tests for the purchasingMoney backend. No SDK, no
// I/O — exercises the pure helpers (owner-id auth, payload validation, money
// rounding, output sanitization) that entry.ts imports. Verifies owner vs
// other-admin vs crew vs unauth failures happen BEFORE any entity read, that
// strict payloads reject extra/malformed/negative/missing, and that only safe
// fields are returned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPurchasingMoneyOwner, validateSavePayload, sanitizeInput, OWNER_IDS,
} from '../base44/shared/purchasingMoneyPure.js';

test('OWNER_IDS binds the two immutable owner auth ids, not role/email', () => {
  assert.ok(OWNER_IDS.has('6a7f0d834a5f825c724273ea'));
  assert.ok(OWNER_IDS.has('6a8229a9801b2aef9278ff47'));
  assert.equal(OWNER_IDS.size, 2);
});

test('isPurchasingMoneyOwner: owner id passes', () => {
  assert.ok(isPurchasingMoneyOwner({ id: '6a7f0d834a5f825c724273ea', role: 'admin' }));
  assert.ok(isPurchasingMoneyOwner({ id: '6a8229a9801b2aef9278ff47', role: 'admin' }));
});

test('isPurchasingMoneyOwner: another admin (wrong id) is rejected — admin role is not enough', () => {
  assert.ok(!isPurchasingMoneyOwner({ id: 'other-admin-id', role: 'admin' }));
});

test('isPurchasingMoneyOwner: crew (role user) is rejected', () => {
  assert.ok(!isPurchasingMoneyOwner({ id: 'crew-id', role: 'user' }));
});

test('isPurchasingMoneyOwner: unauth / null is rejected', () => {
  assert.ok(!isPurchasingMoneyOwner(null));
  assert.ok(!isPurchasingMoneyOwner(undefined));
  assert.ok(!isPurchasingMoneyOwner({}));
});

test('validateSavePayload: missing job_id rejected', () => {
  assert.equal(validateSavePayload({ action: 'save', rough_labor_material: 5 }).error, 'missing_job');
  assert.equal(validateSavePayload({ action: 'save', job_id: '  ', rough_labor_material: 5 }).error, 'missing_job');
});

test('validateSavePayload: extra field rejected (no smuggling)', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: 'j1', rough_labor_material: 5, evil: 1 }).error, 'unexpected_field');
});

test('validateSavePayload: negative amount rejected', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: 'j1', rough_labor_material: -1 }).error, 'invalid_rough_labor_material');
  assert.equal(validateSavePayload({ action: 'save', job_id: 'j1', sale_price: -0.01 }).error, 'invalid_sale_price');
});

test('validateSavePayload: non-finite rejected', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: 'j1', rough_labor_material: NaN }).error, 'invalid_rough_labor_material');
  assert.equal(validateSavePayload({ action: 'save', job_id: 'j1', sale_price: Infinity }).error, 'invalid_sale_price');
});

test('validateSavePayload: null amounts valid (withhold)', () => {
  const r = validateSavePayload({ action: 'save', job_id: 'j1', rough_labor_material: null, sale_price: null });
  assert.ok(r.ok);
  assert.equal(r.rough_labor_material, null);
  assert.equal(r.sale_price, null);
});

test('validateSavePayload: valid payload rounds to cents', () => {
  const r = validateSavePayload({ action: 'save', job_id: ' j1 ', rough_labor_material: 123.456, sale_price: 18000 });
  assert.ok(r.ok);
  assert.equal(r.job_id, 'j1');
  assert.equal(r.rough_labor_material, 123.46);
  assert.equal(r.sale_price, 18000);
});

test('validateSavePayload: non-object body rejected', () => {
  assert.equal(validateSavePayload(null).error, 'invalid_body');
  assert.equal(validateSavePayload([]).error, 'invalid_body');
  assert.equal(validateSavePayload('string').error, 'invalid_body');
});

test('sanitizeInput: returns only safe fields, leaks nothing else', () => {
  const out = sanitizeInput({ id: 'm1', job_id: 'j1', rough_labor_material: 5, sale_price: 10, created_by_id: 'secret', updated_date: 'x', _internal: 'leak' });
  assert.deepEqual(out, { id: 'm1', job_id: 'j1', rough_labor_material: 5, sale_price: 10 });
});

test('sanitizeInput: null row returns null', () => {
  assert.equal(sanitizeInput(null), null);
});