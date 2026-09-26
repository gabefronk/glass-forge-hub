import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { jobSnapshot, workLines } = await import('../src/lib/jobWorkspace.js');
const TODAY = '2026-09-25';
const job = { po_numbers: ['7249419'], oe_numbers: ['79567505-00'] };

test('today visit leads with the time and first line of scope', () => {
  const s = jobSnapshot({ job, today: TODAY, status: { key: 'active', label: 'Active' }, events: [
    { event_date: '2026-09-21', job_name: 'Rainey warranty', scope_notes: 'Glass received' },
    { event_date: '2026-09-25', job_name: 'Rainey warranty', created_by: 'iryedra@gmail.com', scope_notes: 'Replace 1626 FX glass, primary bath<br>Labor $450<br>PO 7302254<br>Replace 2646 SH pantry deadlight', po_number: '7302254' },
  ] });
  assert.equal(s.step.tag, 'Today');
  assert.equal(s.step.text, 'Today, all day. Replace 1626 FX glass, primary bath');
  assert.equal(s.kind, 'Service');
  assert.deepEqual(s.work, ['Replace 1626 FX glass, primary bath', 'Replace 2646 SH pantry deadlight']);
  assert.deepEqual(s.facts.map((f) => f.v), ['Today · all day', 'Ragen', '7249419', '79567505-00']);
  assert.deepEqual(s.refs, ['PO 7249419', 'PO 7302254', 'OE 79567505-00']);
});

test('a late report outranks the next visit', () => {
  const s = jobSnapshot({ job: {}, today: TODAY, status: { key: 'needs_report', label: 'Needs report' }, events: [
    { event_date: '2026-09-22', report_status: 'pending', days_late: 3, scope_notes: 'Install Bonelli handle' },
    { event_date: '2026-09-29', scope_notes: 'Return trip' },
  ] });
  assert.equal(s.step.tag, 'Report late');
  assert.equal(s.step.tone, 'bad');
  assert.match(s.step.text, /Sep 22 visit still has no field report/);
});

test('cancelled visits are ignored and empty jobs say so', () => {
  const s = jobSnapshot({ job: {}, today: TODAY, status: { key: 'active', label: 'Active' }, events: [{ event_date: '2026-09-30', source_status: 'cancelled' }] });
  assert.equal(s.next, null);
  assert.equal(s.step.text, 'No visit on the calendar yet.');
  assert.deepEqual(workLines('- one;  two\n$1,200 labor'), ['one', 'two']);
});

test('a job worked from a field report shows that visit and its work, not "none yet"', () => {
  const s = jobSnapshot({ job: {}, today: TODAY, status: { key: 'complete', label: 'Complete' }, events: [],
    rows: [{ job_date: '2026-09-23', source: 'probuild', calendar_creator: 'iryedra@gmail.com', po_number: '6534825' }],
    fieldReports: [{ job_date: '2026-09-23', message: 'Pulled the stationary panel\nReseated it in the cavity\nWater tested, no leaks' }] });
  assert.equal(s.facts[0].k, 'Last visit');
  assert.equal(s.facts[0].v, 'Sep 23');
  assert.equal(s.facts[1].v, 'Ragen');
  assert.equal(s.facts[2].v, '6534825');
  assert.equal(s.step.tag, 'Done');
  assert.equal(s.step.text, 'Work complete. Last visit was Sep 23.');
  assert.deepEqual(s.work, ['Pulled the stationary panel', 'Reseated it in the cavity', 'Water tested, no leaks']);
  assert.equal(s.workFrom, 'from the Sep 23 report');
});

test('job names display with capital first letters, keeping existing capitals', async () => {
  const { titleCase } = await import('../src/lib/displayName.js');
  assert.equal(titleCase('patterson homes - 10 beck hillside estates'), 'Patterson Homes - 10 Beck Hillside Estates');
  assert.equal(titleCase('AV24 - Aria-Belle - 1212 North Luna Circle - RETRO'), 'AV24 - Aria-Belle - 1212 North Luna Circle - RETRO');
  assert.equal(titleCase('d r horton 165 viridian'), 'D R Horton 165 Viridian');
  assert.equal(titleCase('911 - pulte home - 347 sunset flat'), '911 - Pulte Home - 347 Sunset Flat');
  assert.equal(titleCase(''), '');
});

test('scope lines lift out contact details and order numbers, keeping the words', async () => {
  const { workLines, findSuperInText } = await import('../src/lib/jobWorkspace.js');
  const notes = 'Amsco Investigation *Closing 9/24*<br>Take shoes off, carpets are being cleaned.<br><br>WARRANTY* - Per Report: (primary bath sh window is not opening and all ops need to be checked in the house – bring 2 32-4 balance springs in case they need to be swapped in the bath) *Orig. PO#: 6851328*<br>SPR: Mike Shaw 385-230-1483<br>Email: mikes@fieldstonehomes.com';
  const lines = workLines(notes, 10);
  assert.deepEqual(lines, [
    'Amsco Investigation Closing 9/24',
    'Take shoes off, carpets are being cleaned.',
    'WARRANTY - Per Report: (primary bath sh window is not opening and all ops need to be checked in the house – bring 2 32-4 balance springs in case they need to be swapped in the bath)',
  ]);
  assert.deepEqual(findSuperInText(notes), { name: 'Mike Shaw', phone: '385-230-1483', email: 'mikes@fieldstonehomes.com' });
  assert.equal(findSuperInText('Call the office when done'), null);
  assert.deepEqual(findSuperInText('Super - Colton (801) 885-4735'), { name: 'Colton', phone: '801-885-4735', email: '' });
});

test('a report stored twice shows once', async () => {
  const { mergeNoteTexts, buildReports } = await import('../src/lib/jobHistory.js');
  const t = 'Changed out the balance springs, checked ops. 1 vinyl man hour';
  assert.equal(mergeNoteTexts(t, t), t);
  assert.equal(mergeNoteTexts('Short', 'Short plus more detail'), 'Short plus more detail');
  assert.equal(mergeNoteTexts('A', 'B'), 'A\n\nB');
  const r = buildReports([{ source: 'probuild', probuild_post_id: 'p', job_date: '2026-09-22', note_text: t, probuild_note_text: t }], []);
  assert.equal(r[0].message, t);
});
