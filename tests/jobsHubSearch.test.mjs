import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Jobs Hub search includes canonical identity fields and record id', () => {
  const source = fs.readFileSync(new URL('../src/pages/JobsHub.jsx', import.meta.url), 'utf8');
  for (const field of ['canonical_name', 'aliases', 'address', 'po_numbers', 'oe_numbers', 'j.id']) assert.match(source, new RegExp(field.replace('.', '\\.')));
  assert.match(source, /\[name, aliases, addr, pos, oes, id\]/);
});
