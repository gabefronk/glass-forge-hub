import test from 'node:test';
import assert from 'node:assert/strict';
import { withDerivedJobLinks } from '../base44/functions/ownedCalendar/handler.js';

test('fills job_id from FeeLine link only when the event has none', () => {
  const links = new Map([['g1', 'jobA'], ['g2', 'jobB']]);
  const out = withDerivedJobLinks([
    { id: 1, google_event_id: 'g1' },
    { id: 2, google_event_id: 'g2', job_id: 'jobOwn' },
    { id: 3, google_event_id: 'g3' },
    { id: 4 },
  ], links);
  assert.deepEqual(out[0], { id: 1, google_event_id: 'g1', job_id: 'jobA', job_link_derived: true });
  assert.equal(out[1].job_id, 'jobOwn');
  assert.equal(out[1].job_link_derived, undefined);
  assert.equal(out[2].job_id, undefined);
  assert.equal(out[3].job_id, undefined);
});
