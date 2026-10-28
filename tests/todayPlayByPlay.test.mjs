import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { dayPlan, dedupeEvents, markOverlaps, outlookState, overlapping, briefingLines, coversDay, minutesOf, spanLabel, taskReason } =
  await import('../src/lib/todayPlayByPlay.js');

const TODAY = '2026-10-28';
// 09:00 Denver on the day itself, so the Outlook age window is exercised honestly.
const NOW = Date.parse('2026-10-28T15:00:00.000Z');

// Shapes copied from live CalendarEvents rows: job_name is the title, start_time
// is HH:MM or null for all-day, end_date is Google's exclusive all-day end.
const event = (fields) => ({ source: 'google', source_status: 'confirmed', event_date: TODAY, job_name: 'Visit', ...fields });
const task = (fields) => ({ status: 'open', title: 'Task', due_date: '', focus_date: '', follow_up_date: '', waiting_on: '', job_id: '', ...fields });

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
