import test from 'node:test';
import assert from 'node:assert/strict';
import {
  etaEventBody, etaEventTitle, etaCalendarKeys, etaCalendarId, linkEventIds, planEtaCalendars,
  isWillCall, normalizeDeliveryMethod, isEtaCalendarChoice,
} from '../shared/etaCalendarEvent.js';
import { CREW_CALENDARS, extractExplicitJobId, matchEventToJob } from '../shared/jobCalendarCore.js';

const job = { id: '6ad643b00d03283fdedd55d5', canonical_name: 'Hidden Hallow Lot 509', builder: 'Cadence', address: '2978 Cambrian Lane, Eagle Mountain, UT 84005' };
const args = { date: '2026-11-03', etaKey: 'order:6ae557ae4f8cc68bd0f81da3', ref: '10-4407.26', vendor: 'AMSCO' };

test('ETA event title is the job name exactly, like the Jobs tab visits (no "ETA - " prefix)', () => {
  const ev = etaEventBody(job, args);
  assert.equal(ev.summary, 'Hidden Hallow Lot 509');
  assert.equal(ev.summary, job.canonical_name);
  assert.doesNotMatch(ev.summary, /^eta\b/i);
  assert.equal(etaEventTitle({ canonical_name: 'CAMPBELL ADDITION' }), 'CAMPBELL ADDITION');
  assert.equal(etaEventTitle(null), 'Glass job');
});

test('ETA event puts the job site in the location, all-day on the ETA', () => {
  const ev = etaEventBody(job, args);
  assert.equal(ev.location, '2978 Cambrian Lane, Eagle Mountain, UT 84005');
  assert.deepEqual(ev.start, { date: '2026-11-03' });
  assert.deepEqual(ev.end, { date: '2026-11-04' });
  assert.doesNotMatch(ev.description, /^Site:/m, 'the address is not said twice');
  assert.equal(etaEventBody({ ...job, address: '' }, args).location, '');
});

test('a will-call order says so first in the body; a delivered or unknown one does not', () => {
  const wc = etaEventBody(job, { ...args, deliveryMethod: 'will_call' });
  assert.equal(wc.description.split('\n')[0], 'Will call: pick up at Amsco');
  assert.equal(etaEventBody(job, { ...args, deliveryMethod: 'will-call' }).description.split('\n')[0], 'Will call: pick up at Amsco');
  for (const deliveryMethod of ['delivery', '', undefined]) {
    assert.doesNotMatch(etaEventBody(job, { ...args, deliveryMethod }).description, /will call/i);
  }
  const body = etaEventBody(job, args).description;
  assert.match(body, /^Supplier: Amsco$/m);
  assert.match(body, /^Reference: 10-4407\.26$/m);
  assert.match(body, /This event moves with the ETA\.$/);
});

test('the event still ties to its job by explicit identity (hubJobId and the Hub job link agree)', () => {
  const ev = etaEventBody(job, args);
  assert.equal(ev.extendedProperties.private.appSource, 'glassforge');
  assert.equal(ev.extendedProperties.private.hubJobId, job.id);
  assert.match(ev.description, new RegExp(`^Hub job: https://gfglassforge\\.com/jobs/${job.id}$`, 'm'));
  assert.equal(extractExplicitJobId(ev).jobId, job.id);
  assert.equal(matchEventToJob(ev, job).match, true);
  assert.equal(matchEventToJob(ev, { ...job, id: '6ae36c2ec74dcdbc0904f302' }).match, false);
});

test('delivery method values', () => {
  assert.equal(normalizeDeliveryMethod('will-call'), 'will_call');
  assert.equal(normalizeDeliveryMethod('Will Call'), 'will_call');
  assert.equal(normalizeDeliveryMethod('pickup'), 'will_call');
  assert.equal(normalizeDeliveryMethod('delivery'), 'delivery');
  assert.equal(normalizeDeliveryMethod(''), '');
  assert.equal(normalizeDeliveryMethod('drone'), null);
  assert.equal(isWillCall('will_call'), true);
  assert.equal(isWillCall('delivery'), false);
});

test('calendar choice: Israel, Milan or both, using the Jobs tab crew calendars', () => {
  assert.deepEqual(etaCalendarKeys('israel'), ['israel']);
  assert.deepEqual(etaCalendarKeys('milan'), ['milan']);
  assert.deepEqual(etaCalendarKeys('both'), ['israel', 'milan']);
  assert.deepEqual(etaCalendarKeys(undefined), ['israel']);
  assert.equal(etaCalendarId('israel'), 'iryedra@gmail.com');
  assert.equal(etaCalendarId('milan'), CREW_CALENDARS.milan);
  assert.equal(etaCalendarId('nobody'), null);
  assert.equal(isEtaCalendarChoice('both'), true);
  assert.equal(isEtaCalendarChoice('everyone'), false);
});

test('older link rows hold one id on Israel\'s calendar; new rows hold one per calendar', () => {
  assert.deepEqual(linkEventIds({ google_event_id: 'c754' }), { israel: 'c754' });
  assert.deepEqual(linkEventIds({ google_event_id: 'm1', google_event_ids: { milan: 'm1' } }), { milan: 'm1' });
  assert.deepEqual(linkEventIds({ google_event_ids: { israel: 'i1', milan: 'm1', other: 'x' } }), { israel: 'i1', milan: 'm1' });
  assert.deepEqual(linkEventIds(null), {});
});

test('switching calendars moves the event: kept calendars upsert, dropped ones lose it', () => {
  assert.deepEqual(planEtaCalendars('milan', { israel: 'i1' }), { keep: ['milan'], remove: ['israel'] });
  assert.deepEqual(planEtaCalendars('both', { israel: 'i1' }), { keep: ['israel', 'milan'], remove: [] });
  assert.deepEqual(planEtaCalendars('israel', { israel: 'i1', milan: 'm1' }), { keep: ['israel'], remove: ['milan'] });
  assert.deepEqual(planEtaCalendars('israel', {}), { keep: ['israel'], remove: [] });
});
