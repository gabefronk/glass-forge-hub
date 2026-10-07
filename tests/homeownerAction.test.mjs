import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { homeownerEditLabel, showHomeownerEdit } = await import('../src/lib/homeownerAction.js');

test('a homeowner from the job record with no phone/email still shows the Add phone action', () => {
  const person = { source: 'job', name: 'Jordan', phone: '', email: '' };
  assert.equal(showHomeownerEdit(person), true, 'edit action must be available with no phone/email');
  assert.equal(homeownerEditLabel(person), 'Add phone');
});

test('a linked homeowner shows Change and others show Edit', () => {
  assert.equal(homeownerEditLabel({ source: 'linked', name: 'A' }), 'Change');
  assert.equal(homeownerEditLabel({ source: 'suggestion', name: 'B' }), 'Edit');
  assert.equal(homeownerEditLabel({ source: 'notes', name: 'C' }), 'Edit');
  assert.equal(homeownerEditLabel(null), 'Edit');
});