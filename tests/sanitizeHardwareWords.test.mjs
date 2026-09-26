import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { sanitizeText } = await import('../src/lib/jobsSanitize.js');

test('window hardware words are not mistaken for money', () => {
  const report = 'Changed out the balance springs that was getting stuck an put the new one in checked opps in all the windows';
  assert.equal(sanitizeText(report), report);
  assert.equal(sanitizeText('Replaced 2 balance shoes, sash tilts fine'), 'Replaced 2 balance shoes, sash tilts fine');
});

test('money uses of balance are still hidden', () => {
  assert.equal(sanitizeText('Door installed, balance due at completion'), 'Door installed');
  assert.equal(sanitizeText('Remaining balance on the job'), '');
  assert.equal(sanitizeText('Screens delivered\nBalance $450'), 'Screens delivered');
});
