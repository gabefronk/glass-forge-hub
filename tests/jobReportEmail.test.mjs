import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReportEntry, composeJobReport, REPORT_SAFE, REPORT_OPT_IN, REPORT_PRIVATE } from '../src/lib/jobReportEmail.js';

const visit = { kind: 'visit', date: '2026-10-20', when: '2026-10-20T08:00', ev: { crew: 'Ragen' }, reports: [{ text: 'Set 12 windows, flashed openings.', photos: ['p1', 'p2'] }] };
const report = { kind: 'report', date: '2026-10-21', when: '2026-10-21T15:00', report: { text: 'Trim started.', photos: ['p3'] } };
const plainNote = { kind: 'note', date: '2026-10-21', when: '2026-10-21T16:00', note: { id: 'n1', body: 'HO wants blinds measured next visit.', interaction_type: 'note', attachments: [] } };
const instinctText = { kind: 'note', date: '2026-10-22', when: '2026-10-22T09:00', note: { id: 'n2', body: 'Instinct (customer texts, 10/22, Ragen Work Phone): OWT 424 still has a window...', interaction_type: 'text', attachments: [] } };
const holdNote = { kind: 'note', date: '2026-10-22', when: '2026-10-22T10:00', note: { id: 'n3', body: 'HSH account on payment hold - do not schedule.', interaction_type: 'note', attachments: [] } };
const emailNote = { kind: 'note', date: '2026-10-22', when: '2026-10-22T11:00', note: { id: 'n4', body: 'Re: invoice question', interaction_type: 'email', attachments: [] } };

test('classification: visits/reports safe, plain notes opt-in, internal notes private', () => {
  assert.equal(classifyReportEntry(visit), REPORT_SAFE);
  assert.equal(classifyReportEntry(report), REPORT_SAFE);
  assert.equal(classifyReportEntry(plainNote), REPORT_OPT_IN);
  assert.equal(classifyReportEntry(instinctText), REPORT_PRIVATE, 'Instinct customer-text summary stays private');
  assert.equal(classifyReportEntry(holdNote), REPORT_PRIVATE, 'payment-hold note stays private');
  assert.equal(classifyReportEntry(emailNote), REPORT_PRIVATE, 'email note stays private');
});

test('whole-job report includes visits/reports/photos, excludes internal content by default', () => {
  const r = composeJobReport({ job: { canonical_name: 'Thomas', address: '4627 N Crest Ridge Rd' }, entries: [visit, report, plainNote, instinctText, holdNote, emailNote] });
  assert.match(r.text, /Job report - Thomas/);
  assert.match(r.text, /Set 12 windows/);
  assert.match(r.text, /Trim started/);
  assert.doesNotMatch(r.text, /OWT 424/, 'no Instinct text summary');
  assert.doesNotMatch(r.text, /payment hold/i, 'no payment-hold note');
  assert.doesNotMatch(r.text, /blinds measured/, 'plain note excluded until ticked');
  assert.equal(r.counts.excludedPrivate, 3);
  assert.equal(r.counts.notesAvailable, 1, 'one note offered in review');
  assert.deepEqual(r.photos.map((p) => p.url), ['p1', 'p2', 'p3']);
  assert.equal(r.subject, 'Thomas - job report');
});

test('ticked notes are included; day scope narrows the report', () => {
  const r = composeJobReport({ job: { canonical_name: 'Thomas' }, entries: [visit, report, plainNote], scope: { kind: 'day', date: '2026-10-21' }, selectedNoteIds: ['n1'] });
  assert.match(r.text, /blinds measured/);
  assert.doesNotMatch(r.text, /Set 12 windows/, 'other day excluded');
  assert.equal(r.subject, 'Thomas - job report 10/21/2026');
  assert.deepEqual(r.photos.map((p) => p.url), ['p3']);
});

test('photo cap warns instead of overflowing the email', () => {
  const many = { kind: 'report', date: '2026-10-21', when: '2026-10-21T15:00', report: { text: 'Lots.', photos: Array.from({ length: 25 }, (_, i) => `ph${i}`) } };
  const r = composeJobReport({ job: { canonical_name: 'J' }, entries: [many] });
  assert.equal(r.photos.length, 20);
  assert.match(r.warnings[0], /5 photos left out/);
});

test('empty safe scope says so instead of sending a blank report', () => {
  const r = composeJobReport({ job: { canonical_name: 'J' }, entries: [instinctText] });
  assert.match(r.warnings[0], /Nothing report-safe/);
  assert.equal(r.counts.days, 0);
});
