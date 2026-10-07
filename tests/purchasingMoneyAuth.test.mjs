// Pure helper tests for the purchasingMoney backend: owner-id auth, strict
// payload validation (no coercion, no overflow, omitted preserves), and
// output sanitization. No SDK, no I/O. The injectable handler behavior tests
// (auth-before-read, fail-closed reads, exact writes, readback) live in
// purchasingMoneyEndpoint.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPurchasingMoneyOwner, validateSavePayload, validateListBody, sanitizeInput, OWNER_IDS,
} from '../base44/shared/purchasingMoneyPure.js';
import { parseStoredRow } from '../base44/shared/purchasingMoneyPure.js';

// Exact 24-hex record id (Base44 id format); 'j1' style ids are rejected.
const JOB = 'aaaaaaaaaaaaaaaaaaaaaaaa';

test('validateSavePayload: malformed job id rejected (exact ids only)', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: 'j1', sale_price: 1 }).error, 'invalid_job_id');
  assert.equal(validateSavePayload({ action: 'save', job_id: 'AAAAAAAAAAAAAAAAAAAAAAAA', sale_price: 1 }).error, 'invalid_job_id');
});

test('validateSavePayload: amount above MAX_MONEY rejected', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, sale_price: 1e13 }).error, 'invalid_sale_price');
});

test('parseStoredRow: exact ids, null-default amounts, malformed amounts flagged', () => {
  assert.deepEqual(parseStoredRow({ id: JOB, job_id: JOB }), { ok: true, row: { id: JOB, job_id: JOB, rough_labor_material: null, sale_price: null } });
  assert.equal(parseStoredRow({ id: 'm1', job_id: JOB }).reason, 'invalid_identity');
  assert.equal(parseStoredRow({ id: JOB, job_id: JOB, sale_price: '5' }).reason, 'invalid_amount');
  assert.equal(parseStoredRow({ id: JOB, job_id: JOB, sale_price: Infinity }).reason, 'invalid_amount');
});

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

test('validateSavePayload: missing job_id rejected', () => {
  assert.equal(validateSavePayload({ action: 'save', rough_labor_material: 5 }).error, 'missing_job');
  assert.equal(validateSavePayload({ action: 'save', job_id: '  ', rough_labor_material: 5 }).error, 'missing_job');
});

test('validateSavePayload: extra field rejected (no smuggling)', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: 5, evil: 1 }).error, 'unexpected_field');
});

test('validateSavePayload: negative amount rejected', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: -1 }).error, 'invalid_rough_labor_material');
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, sale_price: -0.01 }).error, 'invalid_sale_price');
});

test('validateSavePayload: NaN / Infinity rejected (no coercion)', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: NaN }).error, 'invalid_rough_labor_material');
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, sale_price: Infinity }).error, 'invalid_sale_price');
});

test('validateSavePayload: undefined and empty string rejected (no coercion)', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: undefined }).error, 'invalid_rough_labor_material');
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, sale_price: '' }).error, 'invalid_sale_price');
});

test('validateSavePayload: numeric string rejected (no coercion)', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: '5' }).error, 'invalid_rough_labor_material');
});

test('validateSavePayload: 1e308 overflow rejected AFTER rounding', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: 1e308 }).error, 'invalid_rough_labor_material');
});

test('validateSavePayload: null amounts valid (withhold)', () => {
  const r = validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: null, sale_price: null });
  assert.ok(r.ok);
  assert.equal(r.rough_labor_material, null);
  assert.equal(r.sale_price, null);
});

test('validateSavePayload: valid payload rounds to cents', () => {
  const r = validateSavePayload({ action: 'save', job_id: ` ${JOB} `, rough_labor_material: 123.456, sale_price: 18000 });
  assert.ok(r.ok);
  assert.equal(r.job_id, JOB);
  assert.equal(r.rough_labor_material, 123.46);
  assert.equal(r.sale_price, 18000);
});

test('validateSavePayload: omitted key preserves existing (hasRough/hasSale flags)', () => {
  const r = validateSavePayload({ action: 'save', job_id: JOB, rough_labor_material: 5 });
  assert.ok(r.ok);
  assert.equal(r.hasRough, true);
  assert.equal(r.hasSale, false);
  assert.equal(r.rough_labor_material, 5);
  assert.equal(r.sale_price, undefined);
});

test('validateSavePayload: both keys omitted → no_fields', () => {
  assert.equal(validateSavePayload({ action: 'save', job_id: JOB }).error, 'no_fields');
});

test('validateSavePayload: non-object body rejected', () => {
  assert.equal(validateSavePayload(null).error, 'invalid_body');
  assert.equal(validateSavePayload([]).error, 'invalid_body');
  assert.equal(validateSavePayload('string').error, 'invalid_body');
});

test('validateListBody: only action key allowed', () => {
  assert.ok(validateListBody({ action: 'list' }).ok);
  assert.equal(validateListBody({ action: 'list', extra: 1 }).error, 'unexpected_field');
  assert.equal(validateListBody(null).error, 'invalid_body');
});

test('sanitizeInput: returns only safe fields, leaks nothing else', () => {
  const out = sanitizeInput({ id: 'm1', job_id: JOB, rough_labor_material: 5, sale_price: 10, created_by_id: 'secret', updated_date: 'x', _internal: 'leak' });
  assert.deepEqual(out, { id: 'm1', job_id: JOB, rough_labor_material: 5, sale_price: 10 });
});

test('sanitizeInput: null row returns null', () => {
  assert.equal(sanitizeInput(null), null);
});