// Field-visit reporting rules: the event choices and their conditional fields, ordered-window
// issues, the shared non-blocking documentation prompts, follow-up recipient routing and the
// Today-item fan-out, rescheduling flags, the customer charge, Hub invoicing staging, and the
// Installer Error carve-out. Pure rules only — no live data, no network, no entity writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  VISIT_EVENT_TYPES,
  EVENT_TYPE_KEYS,
  LEGACY_EVENT_TYPES,
  isCurrentEventType,
  isBillableEventType,
  eventTypeLabel,
  eventFieldScope,
  rubricTicketTypeFor,
  checklistItemsFor,
  notReadyReasonsFor,
  windowIssueKindsFor,
  documentationPrompts,
  orderedWindowOptions,
  patioDoorDetected,
  requiredDimensionsOf,
  rubricFromRows,
  priceFieldReport,
  internalCostState,
  followUpTriggers,
  followUpRequired,
  reschedulingFlags,
  validateFieldReport,
  buildFollowUpTasks,
  followUpTaskKey,
  buildInvoiceStagingLine,
  invoiceStagingState,
  feeLineMarker,
  reportSummaryLines,
  halfHours,
} from '../base44/shared/fieldVisitReport.js';

// The live PricingRubric rows, as read on 2026-10-31. These are CUSTOMER sell rates.
const RUBRIC_ROWS = [
  { kind: 'setting', key: 'long_distance', label: 'Long distance charge', amount: 75 },
  { kind: 'material', key: 'vinyl', label: 'Vinyl', hourly_rate: 100 },
  { kind: 'material', key: 'composite', label: 'Composite', hourly_rate: 125 },
  { kind: 'material', key: 'wood', label: 'Wood', hourly_rate: 150 },
  { kind: 'ticket_type', key: 'initial_visit_po', label: 'Initial visit', visit_fee: null },
  { kind: 'ticket_type', key: 'install', label: 'Install', visit_fee: null },
  { kind: 'ticket_type', key: 'sheetrock_window', label: 'Sheetrock window', visit_fee: null },
  { kind: 'ticket_type', key: 'screen_service', label: 'Screen Service', visit_fee: null },
  { kind: 'ticket_type', key: 'service', label: 'Service', visit_fee: null },
  { kind: 'ticket_type', key: 'warranty', label: 'Warranty', visit_fee: null },
  { kind: 'ticket_type', key: 'follow_up', label: 'Follow-up', visit_fee: 0 },
  { kind: 'ticket_type', key: 'inspection', label: 'Inspection', visit_fee: 25, retired: true },
];
const RUBRIC = rubricFromRows(RUBRIC_ROWS);

// A job whose accepted quote snapshot carries the ordered window package.
const JOB = {
  id: 'job-1',
  canonical_name: 'Holmes Homes - 408 Oquirrh West',
  accepted_quote_snapshot: {
    lines: [
      { id: 'w-a', mark: 'A1', room: 'Great room', style: 'XO slider', width: 72, height: 48, qty: 2, units: 'in', dimension_basis: 'rough_opening' },
      { id: 'w-b', mark: 'B2', room: 'Basement', style: 'SV', width: 36, height: 24, qty: 1, units: 'in', dimension_basis: 'frame' },
      { mark: 'C3', room: 'Dining', style: '8080 SGD patio door', width: 96, height: 80, qty: 1, units: 'in' },
    ],
  },
};
// Three recipients with stable TeamMember ids (shape matches the live TeamMember rows).
const PEOPLE = [
  { id: '6aa81fe757621e73f20ea04b', display_name: 'Milan Fronk' },
  { id: '6aa7aa807101f01d02723c87', display_name: 'Israel' },
  { id: '6aa7aa807101f01d02723c88', display_name: 'Yelian' },
];

const base = (over = {}) => ({ event_type: 'install', completion: 'complete', recipients: [], ...over });

// ── Event choices and field scoping ───────────────────────────────────────────
test('the event choices are exactly the seven current visit types, in order', () => {
  assert.deepEqual(EVENT_TYPE_KEYS, [
    'job_readiness', 'install', 'sheetrock_window_install', 'service', 'screen_service', 'warranty', 'installer_error',
  ]);
  assert.deepEqual(VISIT_EVENT_TYPES.map((e) => e.label), [
    'Job Readiness', 'Install', 'Sheetrock Window Install', 'Service', 'Screen Service', 'Warranty', 'Installer Error',
  ]);
});

test('Punch is not a new choice, and historical/legacy types still read by label', () => {
  assert.equal(isCurrentEventType('punch_list'), false);
  assert.equal(VISIT_EVENT_TYPES.some((e) => /punch/i.test(e.label)), false);
  // Preserved for historical records.
  assert.equal(eventTypeLabel('punch_list'), 'Punch List');
  for (const legacy of LEGACY_EVENT_TYPES) {
    assert.equal(eventTypeLabel(legacy.key), legacy.label, legacy.key);
    assert.equal(isCurrentEventType(legacy.key), false, `${legacy.key} must never be offered`);
  }
  // An unrelated legacy value on an old record is never silently dropped.
  assert.equal(eventTypeLabel('some_retired_2024_type'), 'some_retired_2024_type');
});

test('Install shows no man-hours and no product-material field; hours/material belong to Screen Service, Warranty and Installer Error', () => {
  const install = eventFieldScope('install');
  assert.equal(install.hours, false);
  assert.equal(install.material, false);
  for (const key of ['screen_service', 'warranty', 'installer_error']) {
    assert.equal(eventFieldScope(key).hours, true, key);
    assert.equal(eventFieldScope(key).material, true, key);
  }
  for (const key of ['job_readiness', 'install', 'sheetrock_window_install', 'service']) {
    assert.equal(eventFieldScope(key).hours, false, key);
    assert.equal(eventFieldScope(key).material, false, key);
  }
});

test('Service uses its own parts/issue checklist instead of a blanket hour/material picker', () => {
  const service = eventFieldScope('service');
  assert.equal(service.hours, false);
  assert.equal(service.material, false);
  assert.equal(service.serviceChecklist, true);
  assert.equal(service.partsNeeded, true);
  assert.equal(service.screenIssues, true);
  assert.equal(service.cannotFix, true);
  assert.ok(checklistItemsFor('service').length > 0);
  assert.deepEqual(checklistItemsFor('install'), []);
  assert.equal(checklistItemsFor('installer_error').some((i) => i.key === 'missed_flashing'), true);
  assert.equal(checklistItemsFor('installer_error').some((i) => i.key === 'missing_back_dam'), true);
});

test('each event only offers its own reasons and window-issue kinds', () => {
  assert.deepEqual(notReadyReasonsFor('install').map((r) => r.key), ['windows_not_delivered', 'framing_issue', 'rescheduled', 'other']);
  assert.deepEqual(notReadyReasonsFor('service').map((r) => r.key), ['house_not_cleaned', 'construction_behind', 'scheduled_too_early', 'no_access', 'other']);
  assert.deepEqual(notReadyReasonsFor('job_readiness').map((r) => r.key), ['house_not_framed']);
  assert.deepEqual(notReadyReasonsFor('screen_service'), []);
  assert.deepEqual(windowIssueKindsFor('install').map((k) => k.key), ['missing', 'framing_ro', 'damaged']);
  assert.deepEqual(windowIssueKindsFor('job_readiness').map((k) => k.key), ['framing_ro', 'osb_header', 'needs_clarification']);
  assert.deepEqual(windowIssueKindsFor('warranty'), []);
  assert.equal(eventFieldScope('sheetrock_window_install').sheetrock, true);
  assert.equal(eventFieldScope('warranty').warrantyIssue, true);
});

// ── Ordered window package, current vs required RO ────────────────────────────
test('the window checklist is built from the job ordered package, always with an Other escape', () => {
  const options = orderedWindowOptions(JOB);
  assert.equal(options.length, 4);
  assert.deepEqual(options.slice(0, 3).map((w) => w.id), ['w-a', 'w-b', 'line-3']);
  assert.match(options[0].label, /A1 · Great room · XO slider · 72×48/);
  assert.equal(options[3].other, true);
  // A job with no accepted package still offers Other, so an unidentifiable unit is reportable.
  assert.deepEqual(orderedWindowOptions({}).map((w) => w.id), ['other']);
  assert.equal(patioDoorDetected(JOB), true);
  assert.equal(patioDoorDetected({ accepted_quote_snapshot: { lines: [{ style: 'SH' }] } }), false);
  // No price ever rides along with a window choice.
  for (const w of options) for (const k of Object.keys(w)) assert.ok(!/price|cost|sell|total/i.test(k), k);
});

test('several ordered-window issues coexist, each with its own current and required RO', () => {
  const required = requiredDimensionsOf(orderedWindowOptions(JOB), 'w-a');
  assert.deepEqual(required, { width: 72, height: 48, units: 'in', dimension_basis: 'rough_opening' });
  const report = base({
    window_issues: [
      { kind: 'framing_ro', window_id: 'w-a', current_width: 70.5, current_height: 47, required_width: 72, required_height: 48 },
      { kind: 'framing_ro', window_id: 'w-b', current_width: 34, current_height: 24, required_width: 36, required_height: 24 },
      { kind: 'missing', window_id: 'line-3', source: 'bfs' },
      { kind: 'missing', window_id: 'other', location_note: 'basement north wall, second from left', source: '' },
      { kind: 'damaged', window_id: 'w-b', source: 'amsco', installed_anyway: true },
    ],
  });
  const check = validateFieldReport(report);
  assert.deepEqual(check.errors, []);
  const lines = reportSummaryLines(report, { job: JOB });
  assert.equal(lines.filter((l) => /framed 70.5×47/.test(l)).length, 1);
  assert.ok(lines.some((l) => /framed 34×24/.test(l) && /required 36×24/.test(l)));
  assert.ok(lines.some((l) => /installed anyway: yes/.test(l)));
  assert.ok(lines.some((l) => /location basement north wall/.test(l)));
});

test('a framing/RO item without both current and required dimensions cannot be submitted', () => {
  const missingCurrent = validateFieldReport(base({ window_issues: [{ kind: 'framing_ro', window_id: 'w-a', required_width: 72, required_height: 48 }] }));
  assert.ok(missingCurrent.errors.includes('current_ro_dimensions'));
  const missingRequired = validateFieldReport(base({ window_issues: [{ kind: 'framing_ro', window_id: 'w-a', current_width: 70, current_height: 47 }] }));
  assert.ok(missingRequired.errors.includes('required_ro_dimensions'));
  const noTarget = validateFieldReport(base({ window_issues: [{ kind: 'missing' }] }));
  assert.ok(noTarget.errors.includes('window_target'));
  const otherNoNote = validateFieldReport(base({ window_issues: [{ kind: 'missing', window_id: 'other' }] }));
  assert.ok(otherNoNote.errors.includes('window_other_location'));
  // OSB in headers is a readiness finding, not an install one.
  assert.ok(validateFieldReport(base({ window_issues: [{ kind: 'osb_header', window_id: 'w-a' }] })).errors.includes('window_issue_kind'));
  assert.deepEqual(validateFieldReport(base({ event_type: 'job_readiness', window_issues: [{ kind: 'osb_header', window_id: 'w-a' }] })).errors, []);
});

// ── Shared documentation prompts: optional and non-blocking ───────────────────
test('the shared documentation confirmations apply to Install and Service, and never block a submit', () => {
  const installNoPatio = documentationPrompts('install', { hasPatioDoor: false }).map((p) => p.key);
  assert.deepEqual(installNoPatio, ['all_four_elevations', 'foundation_windows']);
  const installPatio = documentationPrompts('install', { hasPatioDoor: true }).map((p) => p.key);
  assert.deepEqual(installPatio, ['all_four_elevations', 'patio_door_operation_video', 'patio_handle_inside', 'patio_handle_outside', 'foundation_windows']);
  assert.deepEqual(documentationPrompts('service', { hasPatioDoor: true }).map((p) => p.key), installPatio);
  // Other event types get no blanket documentation checklist.
  for (const key of ['job_readiness', 'sheetrock_window_install', 'screen_service', 'warranty', 'installer_error']) {
    assert.deepEqual(documentationPrompts(key, { hasPatioDoor: true }), [], key);
  }
  for (const p of documentationPrompts('install', { hasPatioDoor: true })) assert.equal(p.required, false);
  // Nothing confirmed, no media at all: still submittable.
  const bare = validateFieldReport(base({ documentation: {}, media_urls: [] }));
  assert.equal(bare.ok, true);
  const partial = validateFieldReport(base({ documentation: { all_four_elevations: true, foundation_windows: false } }));
  assert.equal(partial.ok, true);
});

test('an issue item may never carry its own attachments — media stays visit-level', () => {
  for (const field of ['photos', 'attachments', 'media', 'videos', 'photo_urls', 'files']) {
    const r = validateFieldReport(base({ items: [{ key: 'hardware', note: 'x', [field]: ['https://files.test/a.jpg'] }] }));
    assert.ok(r.errors.includes('issue_level_media_not_allowed'), field);
  }
  const onWindow = validateFieldReport(base({ window_issues: [{ kind: 'missing', window_id: 'w-a', photos: [] }] }));
  assert.ok(onWindow.errors.includes('issue_level_media_not_allowed'));
});

// ── Explanations ──────────────────────────────────────────────────────────────
test('incomplete work and Other answers require an explanation', () => {
  const noWhy = validateFieldReport(base({ completion: 'incomplete', recipients: [PEOPLE[0].id] }));
  assert.ok(noWhy.errors.includes('incomplete_reason'));
  const withWhy = validateFieldReport(base({ completion: 'incomplete', incomplete_reason: 'Framing wrong on two openings', recipients: [PEOPLE[0].id] }));
  assert.deepEqual(withWhy.errors, []);
  const otherReason = validateFieldReport(base({ event_type: 'service', not_ready_reasons: [{ key: 'other' }], recipients: [PEOPLE[0].id] }));
  assert.ok(otherReason.errors.includes('other_reason_note'));
  const otherIssue = validateFieldReport(base({ event_type: 'service', items: [{ key: 'other' }] }));
  assert.ok(otherIssue.errors.includes('other_issue_note'));
  assert.ok(validateFieldReport(base({ completion: '' })).errors.includes('completion'));
  assert.ok(validateFieldReport(base({ event_type: 'punch_list' })).errors.includes('event_type'));
});

// ── Follow-up recipients: zero / one / many ───────────────────────────────────
test('zero recipients is valid only when nothing needs follow-up', () => {
  const clean = validateFieldReport(base({ completion: 'complete', recipients: [] }));
  assert.equal(clean.ok, true);
  assert.deepEqual(clean.triggers, []);
  assert.equal(followUpRequired(base()), false);
});

test('every follow-up trigger requires at least one recipient, and one or many both work', () => {
  const cases = [
    ['incomplete_work', { completion: 'incomplete', incomplete_reason: 'left two openings' }],
    ['job_not_ready', { event_type: 'service', not_ready: true }],
    ['job_not_ready', { event_type: 'service', not_ready_reasons: [{ key: 'no_access' }] }],
    ['needs_clarification', { event_type: 'job_readiness', window_issues: [{ kind: 'needs_clarification', window_id: 'w-a', note: 'is this unit tempered?' }] }],
    ['unresolved_issue', { event_type: 'service', items: [{ key: 'hardware', follow_up: true }] }],
    ['manager_review', { event_type: 'service', cannot_fix: [{ window_id: 'w-a', note: 'sash is out of square' }] }],
    ['needs_rescheduling', { event_type: 'sheetrock_window_install', sheetrock_outcomes: [{ key: 'sheetrock_not_stocked' }] }],
  ];
  for (const [trigger, over] of cases) {
    const none = validateFieldReport(base({ ...over, recipients: [] }));
    assert.ok(none.triggers.includes(trigger), `${trigger} must be detected`);
    assert.ok(none.errors.includes('recipients_required'), `${trigger} with zero recipients must be blocked`);
    const one = validateFieldReport(base({ ...over, recipients: [PEOPLE[0].id] }));
    assert.deepEqual(one.errors, [], `${trigger} with one recipient: ${one.errors.join()}`);
    const many = validateFieldReport(base({ ...over, recipients: PEOPLE.map((p) => p.id) }));
    assert.deepEqual(many.errors, [], `${trigger} with many recipients: ${many.errors.join()}`);
    assert.deepEqual(many.recipients, PEOPLE.map((p) => p.id));
  }
});

test('one Today item per recipient, with stable ids, the issue detail and a link back to the report', () => {
  const report = base({
    event_type: 'job_readiness',
    completion: 'incomplete',
    incomplete_reason: 'Two openings could not be checked',
    window_issues: [{ kind: 'needs_clarification', window_id: 'w-b', note: 'is the basement unit egress?' }],
    recipients: PEOPLE.map((p) => p.id),
  });
  const tasks = buildFollowUpTasks({
    report, requestKey: 'field-report:job-1:abc', recipients: PEOPLE, job: JOB, jobId: 'job-1',
    jobName: JOB.canonical_name, originPath: '/jobs/job-1?report=fvr-1', author: 'crew@example.com',
    now: '2026-10-31T18:00:00.000Z', createdByUserId: 'user-1',
  });
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((t) => t.assignee_member_id), PEOPLE.map((p) => p.id));
  assert.equal(new Set(tasks.map((t) => t.request_key)).size, 3, 'one key per recipient');
  for (const t of tasks) {
    assert.match(t.request_key, /^[A-Za-z0-9:_-]+$/, 'TodoTask request_key charset');
    assert.ok(t.title.length <= 200);
    assert.ok(t.details.length <= 5000);
    assert.match(t.title, /Job Readiness/);
    assert.match(t.details, /Holmes Homes - 408 Oquirrh West/);
    assert.match(t.details, /Event: Job Readiness/);
    assert.match(t.details, /Needs clarification: B2 · Basement/);
    assert.match(t.details, /is the basement unit egress\?/);
    assert.match(t.details, /Two openings could not be checked/);
    assert.match(t.details, /Full report: \/jobs\/job-1\?report=fvr-1/);
    assert.equal(t.category, 'follow_up');
    assert.equal(t.status, 'open');
    assert.equal(t.job_id, 'job-1');
  }
  // No trigger: nothing is fanned out even if somebody was picked.
  assert.deepEqual(buildFollowUpTasks({ report: base({ recipients: [PEOPLE[0].id] }), requestKey: 'k', recipients: PEOPLE, jobId: 'job-1' }), []);
  // No recipient: nothing is invented.
  assert.deepEqual(buildFollowUpTasks({ report, requestKey: 'k', recipients: [], jobId: 'job-1' }), []);
});

test('the per-recipient Today key is deterministic, so a retry or an edited re-submit dedupes', () => {
  const a = followUpTaskKey('field-report:job-1:abc', PEOPLE[0].id);
  const b = followUpTaskKey('field-report:job-1:abc', PEOPLE[0].id);
  assert.equal(a, b);
  assert.notEqual(a, followUpTaskKey('field-report:job-1:abc', PEOPLE[1].id));
  assert.notEqual(a, followUpTaskKey('field-report:job-1:xyz', PEOPLE[0].id));
  assert.match(a, /^[A-Za-z0-9:_-]+$/);
  // An unsafe key is sanitized rather than rejected into an invalid TodoTask write.
  assert.match(followUpTaskKey('field report/job 1', 'member id'), /^[A-Za-z0-9:_-]+$/);
});

// ── Rescheduling: flagged, never dated ────────────────────────────────────────
test('sheetrock not stocked and house not framed flag rescheduling without inventing a date', () => {
  const sheetrock = reschedulingFlags({ event_type: 'sheetrock_window_install', sheetrock_outcomes: [{ key: 'sheetrock_not_stocked' }] });
  assert.equal(sheetrock.needs_rescheduling, true);
  assert.equal(sheetrock.rescheduling_reason, 'sheetrock_not_stocked');
  assert.equal(sheetrock.rescheduled_date, null);
  const readiness = reschedulingFlags({ event_type: 'job_readiness', not_ready_reasons: [{ key: 'house_not_framed' }] });
  assert.equal(readiness.needs_rescheduling, true);
  assert.equal(readiness.rescheduling_reason, 'house_not_framed');
  assert.equal(readiness.rescheduled_date, null);
  const installMoved = reschedulingFlags({ event_type: 'install', not_ready_reasons: [{ key: 'rescheduled' }] });
  assert.equal(installMoved.needs_rescheduling, true);
  // Completed sheetrock install: no rescheduling at all.
  const done = reschedulingFlags({ event_type: 'sheetrock_window_install', sheetrock_outcomes: [{ key: 'window_installed' }] });
  assert.deepEqual(done, { needs_rescheduling: false, rescheduling_reason: '', rescheduled_date: null });
  // Not one of these results may contain anything that looks like a date.
  for (const r of [sheetrock, readiness, installMoved, done]) {
    assert.equal(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/.test(JSON.stringify(r)), false);
  }
  assert.ok(followUpTriggers({ event_type: 'sheetrock_window_install', sheetrock_outcomes: [{ key: 'sheetrock_not_stocked' }] }).includes('needs_rescheduling'));
});

// ── Pricing: existing product and long-distance rules ─────────────────────────
test('the charge reuses the existing rubric product rates and long-distance amount', () => {
  const screens = priceFieldReport({ eventType: 'screen_service', hours: 2, material: 'vinyl', longDistance: true, rubric: RUBRIC });
  assert.equal(screens.labor_amt, 275); // 2 h x $100 vinyl + $75 long distance
  assert.equal(screens.rate, 100);
  assert.equal(screens.long_distance_amt, 75);
  assert.equal(screens.billable, true);
  assert.deepEqual(screens.parts, ['Screen Service visit', '2 h x $100 Vinyl', 'long distance $75']);

  assert.equal(priceFieldReport({ eventType: 'warranty', hours: 1.5, material: 'wood', rubric: RUBRIC }).labor_amt, 225);
  assert.equal(priceFieldReport({ eventType: 'warranty', hours: 3, material: 'composite', longDistance: true, rubric: RUBRIC }).labor_amt, 450);
  // Half-hour granularity is preserved, as the old form had it.
  assert.equal(halfHours(2.3), 2.5);
  assert.equal(priceFieldReport({ eventType: 'screen_service', hours: 2.3, material: 'vinyl', rubric: RUBRIC }).labor_amt, 250);
  // Retired rubric rows stay off the form and out of the maths.
  assert.equal(RUBRIC.ticketTypes.some((t) => t.key === 'inspection'), false);
  // No competing pricing source and no hardcoded fallback table (vinyl/$200 was illustrative
  // only): with an empty rubric every event prices to nothing, whatever was collected.
  const empty = rubricFromRows([]);
  for (const key of EVENT_TYPE_KEYS) {
    const p = priceFieldReport({ eventType: key, hours: 8, material: 'vinyl', longDistance: true, rubric: empty });
    assert.equal(p.labor_amt, 0, key);
    assert.equal(p.rate, 0, key);
    assert.equal(p.long_distance_amt, 0, key);
  }
  // The rubric's own rates are the only source, and they are read, not restated.
  assert.deepEqual(RUBRIC.materials.map((m) => [m.key, m.hourly_rate]), [['vinyl', 100], ['composite', 125], ['wood', 150]]);
  assert.equal(RUBRIC.longDistanceAmount, 75);
});

test('Warranty is not assumed non-billable: labour prices, a no-labour visit simply has no amount', () => {
  const withLabour = priceFieldReport({ eventType: 'warranty', hours: 2, material: 'vinyl', rubric: RUBRIC });
  assert.equal(withLabour.billable, true);
  assert.equal(withLabour.labor_amt, 200);
  assert.equal(invoiceStagingState({ eventType: 'warranty', price: withLabour }), 'staged');
  const noLabour = priceFieldReport({ eventType: 'warranty', hours: 0, material: '', rubric: RUBRIC });
  assert.equal(noLabour.billable, false);
  assert.equal(noLabour.reason, 'no_chargeable_amount');
  assert.equal(invoiceStagingState({ eventType: 'warranty', price: noLabour }), 'none');
  assert.equal(isBillableEventType('warranty'), true);
});

test('Install never prices labour, because it never collects hours or material', () => {
  const price = priceFieldReport({ eventType: 'install', hours: 6, material: 'wood', longDistance: true, rubric: RUBRIC });
  assert.equal(price.hours, 0);
  assert.equal(price.rate, 0);
  assert.equal(price.labor_amt, 75, 'only the long-distance trip charge applies');
  assert.equal(rubricTicketTypeFor('install'), 'install');
  assert.equal(rubricTicketTypeFor('job_readiness'), 'initial_visit_po');
});

// ── Hub invoicing staging ─────────────────────────────────────────────────────
test('an eligible billable visit stages exactly one unbilled Hub invoicing line', () => {
  const report = base({ event_type: 'screen_service', hours: 2, material: 'vinyl', long_distance: true, notes: 'swapped four screens' });
  const price = priceFieldReport({ eventType: 'screen_service', hours: 2, material: 'vinyl', longDistance: true, rubric: RUBRIC });
  const line = buildInvoiceStagingLine({ price, report, requestKey: 'field-report:job-1:abc', jobId: 'job-1', jobName: JOB.canonical_name, jobDate: '2026-10-30', calendarEventId: 'g-1', media: ['https://files.test/a.jpg'], author: 'crew@example.com' });
  assert.equal(line.labor_amt, 275);
  assert.equal(line.fee_amt, 27.5);
  assert.equal(line.billable, true);
  assert.equal(line.billed_to_bfs, false);
  assert.equal(line.invoiced_to_ya, false);
  assert.equal(line.source, 'field_report');
  assert.equal(line.invoice_month, '2026-10');
  assert.equal(line.man_hours, 2);
  assert.equal(line.service_material, 'vinyl');
  assert.equal(line.service_rate, 100);
  assert.equal(line.trip_charges, 1);
  assert.match(line.line_description, /Screen Service visit \+ 2 h x \$100 Vinyl \+ long distance \$75/);
  // The marker is the idempotency handle a retry or an edited re-submit matches on.
  assert.ok(line.note_text.includes(feeLineMarker('field-report:job-1:abc')));
  assert.equal(feeLineMarker('field-report:job-1:abc'), feeLineMarker('field-report:job-1:abc'));
  assert.notEqual(feeLineMarker('field-report:job-1:abc'), feeLineMarker('field-report:job-1:xyz'));
  // The job and event detail travel with the amount.
  assert.match(line.note_text, /Screen Service/);
  assert.match(line.note_text, /swapped four screens/);
  assert.equal(line.job_name_raw, JOB.canonical_name.toUpperCase());
  // A $0 visit stages nothing at all.
  assert.equal(buildInvoiceStagingLine({ price: priceFieldReport({ eventType: 'service', rubric: RUBRIC }), report, requestKey: 'k', jobId: 'job-1', jobDate: '2026-10-30' }), null);
});

// ── Installer Error ───────────────────────────────────────────────────────────
test('Installer Error is always non-billable and never reaches a fee line or invoicing staging', () => {
  assert.equal(isBillableEventType('installer_error'), false);
  assert.equal(eventFieldScope('installer_error').billable, false);
  assert.equal(eventFieldScope('installer_error').longDistance, false);
  assert.equal(rubricTicketTypeFor('installer_error'), null);
  const report = base({ event_type: 'installer_error', hours: 6, material: 'wood', long_distance: true, items: [{ key: 'missed_flashing', note: 'back dam missing on two' }] });
  const price = priceFieldReport({ eventType: 'installer_error', hours: 6, material: 'wood', longDistance: true, rubric: RUBRIC });
  assert.equal(price.billable, false);
  assert.equal(price.labor_amt, 0);
  assert.equal(price.reason, 'installer_error_never_billable');
  assert.equal(buildInvoiceStagingLine({ price, report, requestKey: 'k', jobId: 'job-1', jobDate: '2026-10-30' }), null);
  assert.equal(invoiceStagingState({ eventType: 'installer_error', price }), 'not_billable');
  // Even if a caller fabricates a billable price object, the state is still not billable.
  assert.equal(invoiceStagingState({ eventType: 'installer_error', price: { billable: true, labor_amt: 900 } }), 'not_billable');
});

test('Installer Error keeps the internal hours/material record with an honest cost state', () => {
  const noRate = internalCostState({ eventType: 'installer_error', hours: 6, material: 'wood', costSources: { internal_labor_rate_per_hour: null, source: 'JobCostInputs' } });
  assert.equal(noRate.hours, 6);
  assert.equal(noRate.material, 'wood');
  assert.equal(noRate.state, 'pending');
  assert.equal(noRate.amount, null);
  assert.equal(noRate.reason, 'no_internal_labor_cost_rate');
  // Never the customer sell rate: $150/h wood would have been $900.
  assert.notEqual(noRate.amount, 900);
  // With a real internal rate it prices from that rate alone.
  const priced = internalCostState({ eventType: 'installer_error', hours: 6, material: 'wood', costSources: { internal_labor_rate_per_hour: 45 } });
  assert.equal(priced.state, 'priced');
  assert.equal(priced.amount, 270);
  // An event that records no hours or material is unpriced, not pending.
  assert.equal(internalCostState({ eventType: 'install', hours: 6, material: 'wood' }).state, 'unpriced');
  assert.equal(internalCostState({ eventType: 'install', hours: 6 }).reason, 'event_records_no_hours_or_material');
  assert.equal(internalCostState({ eventType: 'warranty', hours: 0, material: '' }).state, 'unpriced');
  // The cost function cannot read the rubric even if one is handed to it.
  const sneaky = internalCostState({ eventType: 'warranty', hours: 2, material: 'vinyl', costSources: { rubric: RUBRIC } });
  assert.equal(sneaky.state, 'pending');
  assert.equal(sneaky.amount, null);
});

// ── Phone flow: one media section, nothing per issue, thumb-sized targets ─────
const SECTIONS = fs.readFileSync(new URL('../src/components/jobs/FieldReportSections.jsx', import.meta.url), 'utf8');
const MODAL = fs.readFileSync(new URL('../src/components/jobs/JobFieldReportModal.jsx', import.meta.url), 'utf8');

test('no issue section renders an upload control: the only media picker is the shared end-of-visit one', () => {
  assert.equal(/type="file"/.test(SECTIONS), false, 'conditional issue sections must not upload');
  assert.equal(/UploadFile/.test(SECTIONS), false);
  const pickers = MODAL.match(/type="file"/g) || [];
  assert.equal(pickers.length, 2, 'exactly one camera picker and one library picker');
  // Both pickers sit inside the single media Card, after the recipients section.
  const mediaCard = MODAL.indexOf('Photos & videos for this visit');
  assert.ok(mediaCard > 0);
  assert.ok(MODAL.indexOf('RecipientsSection people') < mediaCard, 'media comes at the end of the visit');
  for (const i of [MODAL.indexOf('type="file"'), MODAL.lastIndexOf('type="file"')]) assert.ok(i > mediaCard);
  assert.match(MODAL, /a missing photo never stops you submitting/i);
});

test('the phone form keeps thumb-sized targets and a single column', () => {
  for (const src of [SECTIONS, MODAL]) {
    for (const m of src.matchAll(/min-h-\[(\d+)px\]/g)) {
      assert.ok(Number(m[1]) >= 44, `touch target ${m[1]}px is below 44px`);
    }
    assert.equal(/overflow-x-auto|whitespace-nowrap/.test(src), false, 'no horizontal scrolling on a phone');
    assert.equal(/grid-cols-[4-9]/.test(src), false, 'no dense multi-column grids');
  }
  // Submitting is never gated on media; it is gated on the rules.
  assert.match(MODAL, /const canSubmit = check\.ok && !saving && !uploading;/);
});

test('the Today item link lands on a page that actually opens the originating report', () => {
  const tasks = buildFollowUpTasks({
    report: base({ completion: 'incomplete', incomplete_reason: 'x', recipients: [PEOPLE[0].id] }),
    requestKey: 'k', recipients: [PEOPLE[0]], jobId: 'job-1', jobName: 'J', originPath: '/jobs/job-1?report=fvr-7',
  });
  const link = tasks[0].details.split('\n').find((l) => l.startsWith('Full report: ')).slice(13);
  // The route the link uses exists, and that page reads the report id and opens the viewer.
  const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  assert.match(app, /path="\/jobs\/:id"/);
  assert.match(link, /^\/jobs\/[^?]+\?report=[^&]+$/);
  const page = fs.readFileSync(new URL('../src/pages/JobDetail.jsx', import.meta.url), 'utf8');
  assert.match(page, /searchParams\.get\("report"\)/);
  assert.match(page, /<FieldVisitReportView reportId=\{openReportId\}/);
  const view = fs.readFileSync(new URL('../src/components/jobs/FieldVisitReportView.jsx', import.meta.url), 'utf8');
  assert.match(view, /FieldVisitReports\.get\(reportId\)/);
  assert.match(view, /media_urls/, 'the viewer shows the visit-level media');
  assert.equal(/type="file"/.test(view), false, 'the viewer is read-only');
});

test('the form and the server validate with the same shared module', () => {
  assert.match(MODAL, /from "\.\.\/\.\.\/\.\.\/base44\/shared\/fieldVisitReport\.js"/);
  const handler = fs.readFileSync(new URL('../base44/functions/resolveFieldReport/entry.ts', import.meta.url), 'utf8');
  assert.match(handler, /from '\.\.\/\.\.\/shared\/fieldVisitReport\.js'/);
  assert.match(handler, /validateFieldReport/);
  // No person is named in the follow-up routing any more.
  assert.equal(/milan|mylan|israel|yelian|elian|jeremy/i.test(handler), false, 'recipients must come from live data, not names');
  assert.equal(/milan|mylan|israel|yelian|elian|jeremy/i.test(fs.readFileSync(new URL('../base44/shared/fieldVisitReport.js', import.meta.url), 'utf8')), false);
});
