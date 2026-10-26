import test from 'node:test';
import assert from 'node:assert/strict';
import { extractExplicitService, parseServiceBilling } from '../base44/shared/billingCore.js';

const price = (note) => {
  const ext = extractExplicitService(note);
  return { ext, service: parseServiceBilling(note, ext.man_hours, ext.trip_charges) };
};

test('"trip charg" shorthand is one $75 trip', () => {
  const { ext, service } = price('Sash changed glass beoken glass cleand trip charg ');
  assert.equal(ext.trip_charges, 1);
  assert.equal(ext.needs_review, false);
  assert.equal(service.total, 75);
  assert.equal(service.source, 'Explicit trip charge');
});

test('"Trip charg + 1 wood man hour" bills the trip and the hour', () => {
  const { ext, service } = price('Changed the shoe on the door. Trip charg + 1 wood man hour');
  assert.deepEqual([ext.man_hours, ext.trip_charges], [1, 1]);
  assert.equal(service.total, 225);
});

test('"Trip charg+ 1 vinyl man hour" and "trip charg 2 vinyl man hours"', () => {
  assert.equal(price('Door screens instaled. Trip charg+ 1 vinyl man hour').service.total, 175);
  assert.equal(price('Glass chaged trip charg 2 vinyl man hours').service.total, 275);
  assert.equal(price('Door panel order the wrong handing trip charg 1composite man hour').service.total, 200);
});

test('chrg / chg shorthand and the full words still count', () => {
  assert.equal(price('Screen installed, trip chrg').ext.trip_charges, 1);
  assert.equal(price('Screen installed, trip chg').ext.trip_charges, 1);
  assert.equal(price('2 trip charges').ext.trip_charges, 2);
  assert.equal(price('trip charge').ext.trip_charges, 1);
});

test('"trp charge" counts as a trip', () => {
  const { ext, service } = price('the super told me i hade to make apoinment trp charge');
  assert.equal(ext.trip_charges, 1);
  assert.equal(service.total, 75);
});

test('".5 composite man hours" reads as half an hour', () => {
  const { ext, service } = price('Caps replaced on the window trip charge .5 composite man hours');
  assert.deepEqual([ext.man_hours, ext.trip_charges, ext.needs_review], [0.5, 1, false]);
  assert.equal(service.labor, 62.5);
  assert.equal(service.total, 137.5);
  assert.equal(price('1.5 vinyl man hours').ext.man_hours, 1.5);
  assert.equal(price('0.5 vinyl man hours').ext.man_hours, 0.5);
});

test('"trip charged" and words like "stripping" are not trip charges', () => {
  assert.equal(price('customer was already trip charged last week').ext.trip_charges, null);
  assert.equal(price('weatherstripping replaced').ext.trip_charges, null);
});
