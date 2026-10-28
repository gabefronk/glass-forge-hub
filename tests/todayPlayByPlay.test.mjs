import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { dayPlan, dedupeEvents, markOverlaps, outlookState, overlapping, briefingLines, coversDay, minutesOf, spanLabel, taskReason, taskDetails, daySummary, denverMinutes, directionsUrl, nextUp, ownerOf } =
  await import('../src/lib/todayPlayByPlay.js');

const TODAY = '2026-10-28';
// 09:00 Denver on the day itself, so the Outlook age window is exercised honestly.
const NOW = Date.parse('2026-10-28T15:00:00.000Z');

// Shapes copied from live CalendarEvents rows: job_name is the title, start_time
// is HH:MM or null for all-day, end_date is Google's exclusive all-day end.
const event = (fields) => ({ source: 'google', source_status: 'confirmed', event_date: TODAY, job_name: 'Visit', ...fields });
const task = (fields) => ({ status: 'open', title: 'Task', details: '', due_date: '', focus_date: '', follow_up_date: '', waiting_on: '', job_id: '', ...fields });

// The live to-do created for today, verbatim: an "Address:" line, then the note.
const PRESTON_DETAILS = 'Address: 2132 E Applewood Ave, Holladay, UT\n\nFlexible timing. Could go right after Beau’s school; otherwise around noon or this afternoon. Confirm timing before leaving.';
const preston = () => task({ id: '6ae1fe29c912b73c2c970a0f', title: 'Preston RO check — retro', details: PRESTON_DETAILS, focus_date: TODAY });

test('timed events sort by start time, then title, and keep their range and location', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    events: [
      event({ id: 'c', google_event_id: 'gc', start_time: '13:30', end_time: '15:00', job_name: 'Landscope - Bldg 12' }),
      event({ id: 'b', google_event_id: 'gb', start_time: '08:00', job_name: 'Zeta punch list' }),
      event({ id: 'a', google_event_id: 'ga', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const - Alexander Pool House', address: '3549 W Boulden Blvd Bluffdale, UT 84065', job_id: 'job1' }),
    ],
  });
  assert.deepEqual(plan.timed.map((i) => i.title), ['One Wolf Const - Alexander Pool House', 'Zeta punch list', 'Landscope - Bldg 12']);
  assert.deepEqual(plan.timed.map((i) => i.timeLabel), ['08:00–10:00', '08:00', '13:30–15:00']);
  assert.equal(plan.timed[0].location, '3549 W Boulden Blvd Bluffdale, UT 84065');
  assert.equal(plan.timed[0].jobId, 'job1');
  assert.equal(plan.timed[1].location, '');
  assert.equal(plan.timed[0].source.label, 'Google Calendar');
  assert.equal(plan.timed[0].status.label, 'Confirmed');
  assert.equal(minutesOf('13:30'), 810);
  assert.equal(minutesOf('25:00'), null);
  assert.equal(minutesOf(null), null);
});

test('all-day items stay out of the timed list, including a multi-day span that covers today', () => {
  const spanning = event({ id: 's', google_event_id: 'gs', event_date: '2026-10-26', end_date: '2026-10-30', start_time: null, job_name: 'Landscope - Bldg 12 Mayflower' });
  const sameDay = event({ id: 'd', google_event_id: 'gd', start_time: null, end_date: '2026-10-29', job_name: 'Thomas Res - finish install' });
  const plan = dayPlan({ today: TODAY, now: NOW, events: [spanning, sameDay, event({ id: 't', google_event_id: 'gt', start_time: '08:00' })] });
  assert.deepEqual(plan.allDay.map((i) => i.title), ['Landscope - Bldg 12 Mayflower', 'Thomas Res - finish install']);
  assert.deepEqual(plan.timed.map((i) => i.title), ['Visit']);
  assert.equal(plan.allDay[0].timeLabel, 'All day');
  assert.equal(plan.allDay[0].span, '2026-10-26 through 2026-10-29');
  assert.equal(plan.allDay[1].span, '');
  assert.equal(coversDay(spanning, TODAY), true);
  assert.equal(coversDay({ ...spanning, end_date: '2026-10-27' }, TODAY), false);
  assert.equal(spanLabel({ event_date: TODAY, end_date: '2026-10-29', start_time: '08:00' }), '');
});

test('cancelled source events, the Renta reminder and out-of-day rows never reach the day', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    events: [
      event({ id: 'x', google_event_id: 'gx', start_time: '09:00', source_status: 'cancelled' }),
      event({ id: 'r', google_event_id: 'gr', start_time: '09:00', job_name: 'Renta' }),
      event({ id: 'y', google_event_id: 'gy', start_time: '09:00', event_date: '2026-10-29' }),
      event({ id: 'k', google_event_id: 'gk', start_time: '09:00', job_name: 'Keep me' }),
    ],
  });
  assert.deepEqual(plan.timed.map((i) => i.title), ['Keep me']);
  assert.equal(plan.allDay.length, 0);
});

test('tasks on the day are listed as unscheduled with the reason read off their own dates', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    jobs: [{ id: 'job1', canonical_name: 'Thomas Res' }],
    tasks: [
      task({ id: 't1', title: 'Send COI', due_date: '2026-09-15' }),
      task({ id: 't2', title: 'Order shower glass', status: 'in_progress', job_id: 'job1' }),
      task({ id: 't3', title: 'Site check', focus_date: TODAY }),
      task({ id: 't4', title: 'Chase glass', waiting_on: 'Steve', follow_up_date: '2026-10-27' }),
    ],
  });
  assert.deepEqual(plan.unscheduled.map((i) => i.title), ['Send COI', 'Order shower glass', 'Site check', 'Chase glass']);
  assert.deepEqual(plan.unscheduled.map((i) => i.status.label), ['Overdue · was due 2026-09-15', 'In progress', 'Planned for today', 'Follow up on Steve']);
  assert.deepEqual(plan.unscheduled.map((i) => i.timeLabel), ['No set time', 'No set time', 'No set time', 'No set time']);
  assert.equal(plan.unscheduled[1].jobName, 'Thomas Res');
  assert.equal(plan.unscheduled[1].source.label, 'Hub task');
  assert.equal(plan.timed.length + plan.allDay.length, 0);
  assert.equal(taskReason(task({ due_date: TODAY }), TODAY).label, 'Due today');
  assert.equal(taskReason(task({}), TODAY).label, 'On your list');
});

test('a mirrored installer copy is deduplicated by stable source id, keeping the richest row and its job link', () => {
  const source = event({ id: 'a', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const', google_event_id: 'g1', installer_event_id: 'i1', scope_notes: 'Israel to will call', job_id: 'job1' });
  const mirror = event({ id: 'b', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const', google_event_id: 'i1' });
  for (const order of [[source, mirror], [mirror, source]]) {
    const deduped = dedupeEvents(order);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0].id, 'a');
    assert.equal(deduped[0].job_id, 'job1');
    assert.deepEqual(deduped[0].merged_source_ids, ['b']);
  }
  // The dropped copy carried the only job link, so the kept row inherits it.
  const linkedMirror = { ...mirror, job_id: 'job9' };
  const unlinked = { ...source, job_id: '' };
  const inherited = dedupeEvents([unlinked, linkedMirror])[0];
  assert.equal(inherited.job_id, 'job9');
  assert.equal(inherited.job_link_inherited, true);
  // Separate visits that share no identifier are both kept.
  assert.equal(dedupeEvents([source, event({ id: 'c', google_event_id: 'g2', start_time: '13:00' })]).length, 2);
  // Recurring copies match on the occurrence key alone.
  assert.equal(dedupeEvents([event({ id: 'd', google_event_id: 'g3', source_occurrence_key: 'k1' }), event({ id: 'e', google_event_id: 'g4', source_occurrence_key: 'k1' })]).length, 1);
  const plan = dayPlan({ today: TODAY, now: NOW, events: [source, mirror] });
  assert.equal(plan.timed.length, 1);
  assert.deepEqual(plan.timed[0].mergedSourceIds, ['b']);
});

test('overlapping timed items are marked on both rows; touching ones are not', () => {
  assert.equal(overlapping({ start: 480, end: 600 }, { start: 540, end: 660 }), true);
  assert.equal(overlapping({ start: 480, end: 600 }, { start: 600, end: 660 }), false);
  assert.equal(overlapping({ start: 480, end: null }, { start: 480, end: null }), true);
  assert.equal(overlapping({ start: 480, end: null }, { start: 540, end: null }), false);
  assert.equal(overlapping({ start: null, end: null }, { start: 480, end: 600 }), false);
  const marked = markOverlaps([
    { title: 'Install', start: 480, end: 600 },
    { title: 'Will call', start: 540, end: 570 },
    { title: 'Walkthrough', start: 660, end: 720 },
  ]);
  assert.deepEqual(marked.map((i) => i.conflicts), [['Will call'], ['Install'], []]);
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    events: [
      event({ id: 'a', google_event_id: 'ga', start_time: '08:00', end_time: '10:00', job_name: 'Install' }),
      event({ id: 'b', google_event_id: 'gb', start_time: '09:00', end_time: '09:30', job_name: 'Will call' }),
    ],
  });
  assert.equal(plan.conflicts, 2);
  assert.deepEqual(plan.timed.map((i) => i.conflicts), [['Will call'], ['Install']]);
});

test('Outlook items are read-only and only shown while a complete import covers today', () => {
  const outlookEvent = event({ id: 'o', google_event_id: 'go', source: 'outlook', start_time: '11:00', job_name: 'UT Window Install visit' });
  const current = { calendar_name: 'UT Window Install', complete: true, range_start: '2026-10-27', range_end: '2026-10-30', captured_at: '2026-10-28T06:00:00.000Z' };
  const fresh = dayPlan({ today: TODAY, now: NOW, events: [outlookEvent], outlook: current });
  assert.equal(fresh.outlook.available, true);
  assert.equal(fresh.outlook.reason, 'current');
  assert.deepEqual(fresh.timed.map((i) => i.source.label), ['Outlook · read-only']);

  const stale = dayPlan({ today: TODAY, now: NOW, events: [outlookEvent], outlook: { ...current, captured_at: '2026-10-26T06:00:00.000Z' } });
  assert.equal(stale.outlook.available, false);
  assert.equal(stale.outlook.reason, 'stale');
  assert.equal(stale.outlook.note, 'The Outlook import is 57h old (over 26h), so no Outlook items are shown.');
  assert.equal(stale.timed.length, 0);

  // The live snapshot today: complete, but captured in September for September.
  const old = { calendar_name: 'UT Window Install', complete: true, range_start: '2026-09-08', range_end: '2026-09-11', captured_at: '2026-09-08T20:53:31.911Z' };
  assert.equal(outlookState(old, TODAY, NOW).reason, 'out_of_range');
  assert.equal(outlookState(old, TODAY, NOW).note, 'The Outlook import covers 2026-09-08–2026-09-11, not 2026-10-28, so no Outlook items are shown.');
  assert.equal(outlookState({ ...current, complete: false }, TODAY, NOW).reason, 'incomplete');
  assert.equal(outlookState({ ...current, captured_at: '' }, TODAY, NOW).reason, 'undated');
  assert.equal(outlookState(null, TODAY, NOW).reason, 'none');
  assert.equal(outlookState(null, TODAY, NOW).note, 'No Outlook import is loaded, so no Outlook items are shown.');
  // A missing import never hides the Google-sourced day.
  assert.equal(dayPlan({ today: TODAY, now: NOW, events: [event({ id: 'g', google_event_id: 'gg', start_time: '08:00' })], outlook: null }).timed.length, 1);
});

test('the briefing states only what the items already say, and never a travel time', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    events: [
      event({ id: 'a', google_event_id: 'ga', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const - Alexander Pool House', address: '3549 W Boulden Blvd' }),
      event({ id: 'b', google_event_id: 'gb', start_time: '09:00', end_time: '09:30', job_name: 'Amsco will call' }),
      event({ id: 'c', google_event_id: 'gc', start_time: null, job_name: 'ETA - Holmes Homes - 324 Lake View', builder: 'ETA' }),
      event({ id: 'd', google_event_id: 'gd', start_time: null, job_name: 'Thomas Res - finish install', report_status: 'rescheduled' }),
    ],
    tasks: [task({ id: 't1', title: 'Send COI', due_date: '2026-09-15' })],
  });
  assert.deepEqual(plan.briefing, [
    '2 timed events, 2 all-day items, 1 task.',
    'First timed: 08:00–10:00 · One Wolf Const - Alexander Pool House · 3549 W Boulden Blvd.',
    'Last timed item ends 10:00.',
    '2 timed items overlap another: One Wolf Const - Alexander Pool House; Amsco will call.',
    '1 item is a provisional ETA, not a confirmed schedule.',
    '1 item is marked rescheduled.',
  ]);
  assert.equal(plan.allDay.find((i) => i.title.startsWith('ETA')).status.label, 'Provisional ETA');
  // One status per row: a provisional ETA stays provisional even when its report was rescheduled.
  assert.equal(plan.allDay.find((i) => i.title.startsWith('Thomas')).status.label, 'Rescheduled');
  assert.equal(plan.briefing.join(' ').toLowerCase().includes('travel'), false);
  assert.equal(plan.briefing.join(' ').toLowerCase().includes('drive'), false);

  const allDayOnly = dayPlan({ today: TODAY, now: NOW, events: [event({ id: 'd', google_event_id: 'gd', start_time: null })] });
  assert.deepEqual(allDayOnly.briefing, ['0 timed events, 1 all-day item, 0 tasks.', 'No exact times today: every calendar item is all-day.']);

  const empty = dayPlan({ today: TODAY, now: NOW, events: [], tasks: [] });
  assert.deepEqual(empty.briefing, ['Nothing on the calendar and no tasks on your list for today.']);
  assert.equal(empty.empty, true);
  assert.deepEqual(briefingLines({ timed: [], allDay: [], unscheduled: [] }), empty.briefing);
});

// My Day leads with one plain sentence instead of the whole briefing. The
// briefing itself is unchanged and still rendered, under Day details.
test('the day summary is one plain sentence read off the same items as the briefing', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    events: [
      event({ id: 'a', google_event_id: 'ga', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const - Alexander Pool House' }),
      event({ id: 'b', google_event_id: 'gb', start_time: '08:45', source: 'app', job_name: 'School event' }),
      event({ id: 'c', google_event_id: 'gc', start_time: null, job_name: 'Thomas Res - finish install' }),
    ],
    tasks: [task({ id: 't1', title: 'Send COI', due_date: '2026-09-15' })],
  });
  assert.equal(daySummary(plan), '2 timed appointments, starting 08:00 · 1 all-day job running · 1 task with no set time.');
  assert.equal(plan.briefing[0], '2 timed events, 1 all-day item, 1 task.');
  assert.equal(daySummary(plan).toLowerCase().includes('travel'), false);
  assert.equal(daySummary({ timed: [], allDay: [], unscheduled: [] }), 'Nothing on your calendar and no tasks on your list today.');
  const installsOnly = dayPlan({ today: TODAY, now: NOW, events: [event({ id: 'd', google_event_id: 'gd', start_time: null })] });
  assert.equal(daySummary(installsOnly), 'No timed appointment · 1 all-day job running.');
});

test('the lead marker follows the clock handed in: running now, else next to start, else none left', () => {
  const timed = [
    { key: 'install', start: 480, end: 600 },
    { key: 'school', start: 525, end: null },
    { key: 'walk', start: 660, end: 720 },
  ];
  assert.deepEqual(nextUp(timed, 420), { key: 'install', state: 'next' });
  assert.deepEqual(nextUp(timed, 540), { key: 'install', state: 'now' });
  assert.deepEqual(nextUp(timed, 620), { key: 'walk', state: 'next' });
  assert.deepEqual(nextUp(timed, 800), { key: '', state: 'done' });
  assert.deepEqual(nextUp([], 540), { key: '', state: 'none' });
  // Without a clock the first appointment leads, so the view is never unmarked.
  assert.deepEqual(nextUp(timed, null), { key: 'install', state: 'next' });
  // An item with no end claims its own minute only; it never invents a span.
  assert.deepEqual(nextUp([{ key: 'school', start: 525, end: null }], 525), { key: 'school', state: 'now' });
  assert.deepEqual(nextUp([{ key: 'school', start: 525, end: null }], 526), { key: '', state: 'done' });
  // 09:00 Denver on the day itself, the same instant the Outlook window uses.
  assert.equal(denverMinutes(NOW), 540);
});

test('a directions link is an ordinary Google Maps search built from the address on the record', () => {
  assert.equal(
    directionsUrl('Avondale Preschool Academy, 1417 Lake View Terrace Rd, Saratoga Springs, UT 84045'),
    'https://www.google.com/maps/search/?api=1&query=Avondale%20Preschool%20Academy%2C%201417%20Lake%20View%20Terrace%20Rd%2C%20Saratoga%20Springs%2C%20UT%2084045',
  );
  assert.equal(directionsUrl(''), '');
  assert.equal(directionsUrl(null), '');
});

// The hierarchy My Day renders: ownership decides the section, not whether an
// item carries a time. A job-linked row is install work even when it is timed,
// and the user's own tasks and unlinked appointments are the primary section.
test('the day splits by ownership: the user’s own calendar and to-dos above, every job-linked row on the Install Calendar', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    jobs: [{ id: 'job1', canonical_name: 'One Wolf Const' }, { id: 'job2', canonical_name: 'Landscope' }],
    events: [
      event({ id: 'i', google_event_id: 'gi', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const - Alexander Pool House', address: '3549 W Boulden Blvd Bluffdale, UT 84065', job_id: 'job1' }),
      event({ id: 'p', source: 'app', start_time: '08:45', end_time: null, job_name: 'Beau’s Halloween event at school', address: 'Avondale Preschool Academy, 1417 Lake View Terrace Rd, Saratoga Springs, UT 84045', report_status: 'waived' }),
      event({ id: 'a1', google_event_id: 'ga1', start_time: null, end_date: '2026-10-30', job_name: 'Landscope - Bldg 12 Mayflower', address: '1008 W Hert Cir Heber City, UT 84032', job_id: 'job2' }),
    ],
    tasks: [preston()],
  });
  // The user's own day: their timed appointment first, then the to-do with no time.
  assert.deepEqual(plan.personal.timed.map((i) => i.title), ['Beau’s Halloween event at school']);
  assert.deepEqual(plan.personal.untimed.map((i) => i.title), ['Preston RO check — retro']);
  assert.deepEqual([...plan.personal.timed, ...plan.personal.untimed].map((i) => i.owner), ['personal', 'personal']);
  // One Wolf is install work: it never appears in the personal section, timed or not.
  assert.equal([...plan.personal.timed, ...plan.personal.untimed].some((i) => i.title.startsWith('One Wolf')), false);
  assert.deepEqual(plan.install.timed.map((i) => i.title), ['One Wolf Const - Alexander Pool House']);
  assert.deepEqual(plan.install.allDay.map((i) => i.title), ['Landscope - Bldg 12 Mayflower']);
  assert.deepEqual([...plan.install.timed, ...plan.install.allDay].map((i) => i.owner), ['install', 'install']);
  assert.equal(ownerOf({ job_id: 'job1' }), 'install');
  assert.equal(ownerOf({ job_id: '' }), 'personal');
  assert.equal(ownerOf({}), 'personal');
  // The undivided day is untouched, so the briefing and the summary still read off it.
  assert.deepEqual(plan.timed.map((i) => i.title), ['One Wolf Const - Alexander Pool House', 'Beau’s Halloween event at school']);
  assert.deepEqual(plan.allDay.map((i) => i.title), ['Landscope - Bldg 12 Mayflower']);
  assert.deepEqual(plan.unscheduled.map((i) => i.title), ['Preston RO check — retro']);
  // Overlaps are marked before the split, so the clash survives in both sections.
  assert.deepEqual(plan.personal.timed[0].conflicts, ['One Wolf Const - Alexander Pool House']);
  assert.deepEqual(plan.personal.timed[0].conflictsAcross, ['One Wolf Const - Alexander Pool House']);
  assert.deepEqual(plan.install.timed[0].conflicts, ['Beau’s Halloween event at school']);
  assert.deepEqual(plan.install.timed[0].conflictsAcross, ['Beau’s Halloween event at school']);
  assert.equal(plan.conflicts, 2);
  assert.equal(plan.crossSection, 2);
  assert.equal(plan.briefing.includes('Your own day and the Install Calendar overlap: One Wolf Const - Alexander Pool House; Beau’s Halloween event at school.'), true);
  // Each row keeps its own address, directions and job link in whichever section it lands.
  assert.equal(plan.personal.timed[0].location, 'Avondale Preschool Academy, 1417 Lake View Terrace Rd, Saratoga Springs, UT 84045');
  assert.equal(plan.personal.timed[0].source.label, 'Hub event');
  assert.equal(plan.personal.timed[0].jobId, '');
  assert.equal(directionsUrl(plan.personal.timed[0].location).includes('Avondale%20Preschool%20Academy'), true);
  assert.equal(plan.install.timed[0].jobId, 'job1');
  assert.equal(plan.install.timed[0].location, '3549 W Boulden Blvd Bluffdale, UT 84065');
  assert.equal(plan.install.timed[0].timeLabel, '08:00–10:00');
  assert.equal(plan.install.allDay[0].jobId, 'job2');
  assert.equal(plan.install.allDay[0].span, '2026-10-26' < TODAY ? '2026-10-28 through 2026-10-29' : '');
  // At 08:45 the install is still running, so the one lead marker belongs to that row.
  assert.deepEqual(nextUp(plan.timed, 525), { key: plan.install.timed[0].key, state: 'now' });
});

// A timed install stays below even when it is the only job-linked row and the
// user's own day is empty, so the personal section never borrows install work.
test('a day of nothing but job work leaves the personal section empty rather than pulling installs up', () => {
  const plan = dayPlan({
    today: TODAY,
    now: NOW,
    events: [
      event({ id: 'i', google_event_id: 'gi', start_time: '08:00', end_time: '10:00', job_name: 'One Wolf Const - Alexander Pool House', job_id: 'job1' }),
      event({ id: 'a1', google_event_id: 'ga1', start_time: null, job_name: 'Thomas Res - finish install', job_id: 'job2' }),
    ],
  });
  assert.deepEqual(plan.personal.timed, []);
  assert.deepEqual(plan.personal.untimed, []);
  assert.deepEqual(plan.install.timed.map((i) => i.title), ['One Wolf Const - Alexander Pool House']);
  assert.deepEqual(plan.install.allDay.map((i) => i.title), ['Thomas Res - finish install']);
  assert.equal(plan.crossSection, 0);
  assert.equal(plan.empty, false);
  // No cross-section line when nothing clashes across the two sections.
  assert.equal(plan.briefing.some((line) => line.startsWith('Your own day and the Install Calendar')), false);
});

// The to-do created for today: its address must be visible in the personal
// section with a directions link, and its flexible-timing note readable but
// plainly subordinate. The record itself is never rewritten to achieve that.
test('a to-do’s details carry its exact address into the personal section, with the timing note kept subordinate', () => {
  const plan = dayPlan({ today: TODAY, now: NOW, tasks: [preston()] });
  const row = plan.personal.untimed[0];
  assert.equal(row.title, 'Preston RO check — retro');
  assert.equal(row.owner, 'personal');
  assert.equal(row.source.label, 'Hub task');
  assert.equal(row.location, '2132 E Applewood Ave, Holladay, UT');
  assert.equal(row.note, 'Flexible timing. Could go right after Beau’s school; otherwise around noon or this afternoon. Confirm timing before leaving.');
  // The address line is lifted out of the note, so it is never shown twice.
  assert.equal(row.note.includes('Address:'), false);
  assert.equal(directionsUrl(row.location), 'https://www.google.com/maps/search/?api=1&query=2132%20E%20Applewood%20Ave%2C%20Holladay%2C%20UT');
  // Flexible timing stays flexible: no start minute is invented for it.
  assert.equal(row.start, null);
  assert.equal(row.end, null);
  assert.equal(row.timeLabel, 'No set time');
  assert.equal(row.status.label, 'Planned for today');
  assert.deepEqual(row.conflicts, []);
  assert.deepEqual(row.conflictsAcross, []);
  // Still the same unscheduled row the briefing and the summary count.
  assert.deepEqual(plan.unscheduled.map((i) => i.title), ['Preston RO check — retro']);
  assert.equal(daySummary(plan), 'No timed appointment · 1 task with no set time.');
});

test('task details are read, never guessed: an address line is lifted out and the rest is left verbatim', () => {
  assert.deepEqual(taskDetails(PRESTON_DETAILS), {
    location: '2132 E Applewood Ave, Holladay, UT',
    note: 'Flexible timing. Could go right after Beau’s school; otherwise around noon or this afternoon. Confirm timing before leaving.',
  });
  assert.deepEqual(taskDetails('Site - 100 Main St\nBring the shims'), { location: '100 Main St', note: 'Bring the shims' });
  assert.deepEqual(taskDetails('Call Preston first'), { location: '', note: 'Call Preston first' });
  assert.deepEqual(taskDetails(''), { location: '', note: '' });
  assert.deepEqual(taskDetails(null), { location: '', note: '' });
  // Only the first address line is taken; a second stays in the note as written.
  assert.deepEqual(taskDetails('Address: A\nAddress: B'), { location: 'A', note: 'Address: B' });
  // No address line means no address, so the row offers no directions link.
  assert.equal(directionsUrl(taskDetails('Call Preston first').location), '');
});
