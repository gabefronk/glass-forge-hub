import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKLIST, STAGES, evaluateChecklist, readiness, buildSummary, buildTodoRow, buildKickoffEvent, buildHandoffNote, cleanChecklistInput, todoRequestKey, kickoffEventId, fmtDate } from '../base44/shared/jobHandoff.js';

const JOB = { id: 'job1', canonical_name: 'Aspen Spring', builder: 'Walker Design', address: '123 Aspen Ln, Lehi', po_numbers: ['YA-0005'], oe_numbers: [], drive_job_folder_url: '' };
const SUPER = { name: 'Mike', phone: '(423) 635-9290' };

test('checklist: an empty job fails every required item with a plain reason', () => {
  const items = evaluateChecklist({ job: { id: 'j', canonical_name: 'X', po_numbers: [] } }, []);
  assert.equal(items.length, CHECKLIST.length);
  assert.deepEqual(items.map((i) => i.ok), [false, false, false, false, false, false]);
  assert.equal(items[0].detail, 'No PO on the job yet');
  assert.equal(items[1].detail, 'No ETA yet');
  assert.equal(items[2].detail, 'No plans attached and no folder linked');
  assert.equal(items[4].detail, 'No super saved on the job');
  assert.equal(items[5].detail, 'Scope card is empty');
  const r = readiness(items);
  assert.equal(r.ready, false);
  assert.equal(r.missing.length, 6);
});

test('checklist: auto items pass from job facts; uploads and the scope tick pass the rest', () => {
  const saved = [{ key: 'plans', file_url: 'https://files/plans.pdf', file_name: 'plans.pdf' }, { key: 'scope', done: true }];
  const items = evaluateChecklist({ job: JOB, eta_date: '2026-10-02', budget: { source_pdf_name: 'amsco-quote.pdf' }, superContact: SUPER, homeowner: null, scopeText: '12 windows, 2 sliders, install only' }, saved);
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.equal(by.po.ok, true); assert.equal(by.po.detail, 'PO YA-0005');
  assert.equal(by.eta.ok, true); assert.equal(by.eta.detail, 'ETA Oct 2, 2026');
  assert.equal(by.plans.ok, true); assert.equal(by.plans.detail, 'Attached: plans.pdf'); assert.equal(by.plans.auto, false);
  assert.equal(by.order_doc.ok, true); assert.equal(by.order_doc.detail, 'Quote on the job: amsco-quote.pdf');
  assert.equal(by.contacts.ok, true); assert.equal(by.contacts.detail, 'Super: Mike · (423) 635-9290'); assert.equal(by.contacts.warning, 'No homeowner on file yet');
  assert.equal(by.scope.ok, true);
  assert.deepEqual(readiness(items), { ready: true, missing: [] });
  // a typed PO counts, a Drive folder counts for plans, a folder link counts too
  const typed = evaluateChecklist({ job: { ...JOB, po_numbers: [], drive_job_folder_url: 'https://drive/x' }, po_number: ' 7104999 ' }, []);
  assert.equal(typed[0].ok, true); assert.equal(typed[0].value, '7104999');
  assert.equal(typed[2].ok, true); assert.equal(typed[2].detail, 'Job folder linked (Drive)');
  const linked = evaluateChecklist({ job: { ...JOB, po_numbers: [] }, folder_link: 'https://onedrive/y' }, []);
  assert.equal(linked[2].ok, true); assert.equal(linked[2].detail, 'Folder link on file');
  // scope ticked with an empty card does not pass
  const emptyScope = evaluateChecklist({ job: JOB, scopeText: '' }, [{ key: 'scope', done: true }]);
  assert.equal(emptyScope[5].ok, false);
  assert.equal(emptyScope[5].warning, 'Ticked, but the Scope card is empty');
  // a bad ETA is not an ETA
  assert.equal(evaluateChecklist({ job: JOB, eta_date: 'next week' }, [])[1].ok, false);
});

test('summary packs the job tab: contacts, PO/OE, ETA, folder, files, scope, note and the job link', () => {
  const items = evaluateChecklist({ job: JOB, eta_date: '2026-10-02', superContact: SUPER, homeowner: { name: 'Dana Brewer', phone: '801-555-0199' }, scopeText: '12 windows' }, [{ key: 'plans', file_url: 'https://files/plans.pdf', file_name: 'plans.pdf' }]);
  const s = buildSummary({ job: JOB, handoff: { start_date: '2026-10-06', eta_date: '2026-10-02', notes: 'Super wants a call the day before.', folder_link: 'https://onedrive/aspen' }, items, superContact: SUPER, homeowner: { name: 'Dana Brewer', phone: '801-555-0199' }, scopeText: '12 windows', fromName: 'Gabe Fronk' });
  const lines = s.split('\n');
  assert.equal(lines[0], 'Aspen Spring — Walker Design');
  assert.equal(lines[1], 'Handed off by Gabe Fronk · starts Oct 6, 2026');
  assert.ok(lines.includes('Super: Mike · (423) 635-9290'));
  assert.ok(lines.includes('Homeowner: Dana Brewer · 801-555-0199'));
  assert.ok(lines.includes('PO: YA-0005 · OE: —'));
  assert.ok(lines.includes('ETA: Oct 2, 2026'));
  assert.ok(lines.includes('Folder: https://onedrive/aspen'));
  assert.ok(lines.includes('- plans.pdf: https://files/plans.pdf'));
  assert.ok(lines.includes('Scope: 12 windows'));
  assert.ok(lines.includes('Note from Gabe Fronk: Super wants a call the day before.'));
  assert.equal(lines.at(-1), 'Open job: https://glass-forge-hub.base44.app/jobs/job1');
  const bare = buildSummary({ job: { id: 'j2', canonical_name: 'Bare' }, handoff: {}, items: [] });
  assert.ok(bare.includes('Super: —'));
  assert.ok(!bare.includes('Files:'));
  assert.ok(!bare.includes('Note from'));
});

test('to-do row mirrors the todo service shape, lands in Follow-ups due on the start date, idempotent key', () => {
  const row = buildTodoRow({ job: JOB, handoff: { start_date: '2026-10-06' }, summary: 'packet', assigneeMemberId: 'tm-milan', userId: 'u1', fromName: 'Gabe', now: '2026-09-26T18:00:00.000Z' });
  assert.equal(row.title, 'New project: Aspen Spring — starts Oct 6, 2026 · from Gabe');
  assert.equal(row.details, 'packet');
  assert.equal(row.assignee_member_id, 'tm-milan');
  assert.equal(row.category, 'follow_up');
  assert.equal(row.due_date, '2026-10-06');
  assert.equal(row.status, 'open');
  assert.equal(row.request_key, 'handoff:job1');
  assert.equal(row.revision, 1);
  assert.equal(row.created_at, '2026-09-26T18:00:00.000Z');
  assert.equal(todoRequestKey('a b/c'), 'handoff:a_b_c');
});

test('kickoff event is a Hub-only, all-day, money-free app event linked to the job', () => {
  const ev = buildKickoffEvent({ job: JOB, handoff: { start_date: '2026-10-06' }, toName: 'Milan', createdBy: 'gabefronk@gmail.com', summary: 'line1\nline2' });
  assert.equal(ev.source, 'app');
  assert.equal(ev.event_date, '2026-10-06');
  assert.equal(ev.start_time, null);
  assert.equal(ev.job_name, 'Kickoff: Aspen Spring (Milan)');
  assert.equal(ev.job_id, 'job1');
  assert.equal(ev.labor_amt, 0);
  assert.equal(ev.google_event_id, 'gfjobs-handoff-job1');
  assert.equal(kickoffEventId('job1').startsWith('gfjobs'), true, 'movers refuse gfjobs* ids');
  assert.equal(ev.created_by, 'gabefronk@gmail.com');
  assert.equal(ev.address, '123 Aspen Ln, Lehi');
});

test('handoff note lands in the job feed; checklist input is cleaned; stages are ordered', () => {
  const note = buildHandoffNote({ job: JOB, handoff: { start_date: '2026-10-06', eta_date: '2026-10-02', notes: 'Call first.' }, fromName: 'Gabe', toName: 'Milan', today: '2026-09-26' });
  assert.equal(note.job_id, 'job1');
  assert.equal(note.note_date, '2026-09-26');
  assert.equal(note.interaction_type, 'note');
  assert.equal(note.author, 'Handoff · Gabe');
  assert.match(note.body, /^Handed off to Milan · starts Oct 6, 2026 · ETA Oct 2, 2026\.\nNote: Call first\./);
  assert.deepEqual(cleanChecklistInput([{ key: 'plans', done: 'yes', file_url: ' https://f ', file_name: 'p.pdf', extra: 1 }, { key: 'bogus' }, null]), [{ key: 'plans', done: false, value: '', file_url: 'https://f', file_name: 'p.pdf' }]);
  assert.deepEqual(STAGES, ['quoted', 'sold', 'ordered', 'handed_off', 'scheduled', 'installed', 'closed']);
  assert.equal(fmtDate('2026-10-06'), 'Oct 6, 2026');
  assert.equal(fmtDate('nope'), '');
});
