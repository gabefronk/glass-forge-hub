import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { pickSuper, superChoices } = await import('../src/lib/jobWorkspace.js');

const view = { job: { id: 'j1', builder: 'Durkin' }, linked: [], suggestions: [], builder_contacts: [
  { key: 'b', name: 'Barry', phone: '(435) 714-3045', role: 'project_manager', title: 'PM' },
  { key: 'a', name: 'Arnie Kaio', phone: '(801) 750-5118', role: 'project_manager', title: 'PM' },
  { key: 'h', name: 'Some Owner', phone: '555', role: 'homeowner' },
] };

test('two PMs are offered as choices, not guessed as the super', () => {
  assert.equal(pickSuper({ saved: null, view, events: [] }), null);
  assert.deepEqual(superChoices(view).map((c) => c.name), ['Arnie Kaio', 'Barry']);
});

test('a single builder super fills the slot as a builder suggestion', () => {
  const v = { ...view, builder_contacts: [...view.builder_contacts, { key: 's', name: 'Sam Super', phone: '111', role: 'superintendent' }] };
  const p = pickSuper({ saved: null, view: v, events: [] });
  assert.equal(p.name, 'Sam Super');
  assert.equal(p.source, 'builder');
  assert.equal(superChoices(v)[0].name, 'Sam Super');
});

test('a saved super always wins', () => {
  assert.equal(pickSuper({ saved: { name: 'Saved Guy', phone: '222' }, view, events: [] }).source, 'linked');
});
