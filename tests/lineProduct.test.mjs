// Invoicing Product column: quote on file, then brand + item type from the notes, then the
// work type, then a dash.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lineProduct, quotesByJob, deliveryRouting, brandOf } from '../src/lib/lineProduct.js';

test('brand + item type from the notes', () => {
  assert.equal(lineProduct({ note_text: 'MILGARD DEL TO BFS · BFS DEL TO JOBSITE · 1F · QTY. 44' }), 'Milgard windows ×44');
  assert.equal(lineProduct({ note_text: 'Amsco direct – 10/5 · QTY.42 · OE 79702843-01' }), 'Amsco windows ×42');
  assert.equal(lineProduct({ line_description: 'PELLA HARDWARE/PD SCREENS: (18) Window hardware & screens' }), 'Pella screens');
  assert.equal(lineProduct({ note_text: 'OE 79350696-05 · BFS TO DEL MILGARD DOORS · PO 7237299' }), 'Milgard door');
  assert.equal(lineProduct({ note_text: 'Replace (3) Obscured Andersen 3010PW glass with Gray 14 Tinted Amsco glass' }), 'Amsco glass');
  assert.equal(lineProduct({ note_text: 'Windor Investigation · the windor wont close' }), 'Windor');
  assert.equal(lineProduct({ note_text: '12080XXO sliding glass door panel · Milgard' }), 'Milgard slider');
});

test('work type alone, then a dash', () => {
  assert.equal(lineProduct({ note_text: 'Srw instaled trip charge' }), 'Screens');
  assert.equal(lineProduct({ note_text: 'Glass changed 3 vinyl man hours' }), 'Glass');
  assert.equal(lineProduct({ note_text: 'Trip charge' }), 'Trip charge');
  assert.equal(lineProduct({ note_text: 'Ajusted the frame, see pics' }), 'Service');
  assert.equal(lineProduct({ note_text: '' }), '—');
  assert.equal(lineProduct({}), '—');
});

test('the job quote on file wins and carries its quantity', () => {
  const quotes = quotesByJob([
    { job_id: 'j1', manufacturer: 'ANDERSEN WINDOWS & DOORS', openings_qty: 6, budget_usage: 'included' },
    { job_id: 'j2', manufacturer: 'Pella', budget_usage: 'draft', openings_qty: 9 },
    { job_id: 'j3', vendor: 'AMSCO', openings_qty: 4, deleted_at: '2026-10-01' },
  ]);
  assert.deepEqual(quotes.get('j1'), { brand: 'Andersen', qty: 6 });
  assert.equal(quotes.has('j2'), false);
  assert.equal(quotes.has('j3'), false);
  assert.equal(lineProduct({ job_id: 'j1', note_text: 'Glass changed' }, quotes.get('j1')), 'Andersen glass ×6');
  assert.equal(lineProduct({ job_id: 'j1', note_text: 'install' }, quotes.get('j1')), 'Andersen windows ×6');
});

test('delivery routing for the expanded panel', () => {
  assert.equal(deliveryRouting({ note_text: 'MILGARD DEL TO BFS · BFS DEL TO JOBSITE · 1F · QTY. 44' }), 'MILGARD DEL TO BFS · BFS DEL TO JOBSITE');
  assert.equal(deliveryRouting({ note_text: 'Amsco direct – 10/14 · QTY.23' }), 'Amsco direct – 10/14');
  assert.equal(deliveryRouting({ note_text: 'Glass changed' }), '');
  assert.equal(brandOf('Anderson 400 series'), 'Andersen');
});
