// Field-visit reporting core: the event types a worker can file, which fields each event
// shows, what has to be explained, who has to be told, what may be billed, and what the
// internal cost state honestly is. Pure (no SDK, no React, no network) so the published
// resolveFieldReport handler, the phone form and the tests all read the same rules.
//
// Rules this module owns, and the reasons they live here:
// - The seven current event choices are a closed list. Punch is NOT one of them: new punch
//   work is filed as Service or Warranty. Historical/legacy ticket types still render by
//   label (eventTypeLabel) so old records keep reading correctly; they are never offered.
// - Field scoping is per event. Install never shows man-hours or a product-material picker;
//   hours/material belong to Screen Service, Warranty and Installer Error. Service uses its
//   own parts/issue checklist instead of a blanket hour/material picker.
// - Attachments are visit-level only. An issue item carrying its own media is a validation
//   error, so the phone flow can never grow a per-issue upload box.
// - Missing media never blocks a submission; missing explanations and missing follow-up
//   recipients do.
// - Installer Error is ALWAYS non-billable. priceFieldReport returns no chargeable amount for
//   it, on first submit and on every retry/edit.
// - Internal cost is never inferred from PricingRubric. Those rows are customer sell rates.
//   internalCostState only reads cost sources passed to it and reports pending/unpriced when
//   no real internal rate exists.
// - Nothing here invents a replacement date. Rescheduling is a flag plus a reason.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
export const halfHours = (v) => {
  const n = num(v);
  if (n === null || n <= 0) return 0;
  return Math.min(24, Math.round(n * 2) / 2);
};

// ── Event types ────────────────────────────────────────────────────────────────
// rubricTicketType is the existing PricingRubric `ticket_type` key this event prices from.
// There is no rubric row for a readiness visit, so Job Readiness reuses the existing
// "Initial visit" ticket type (initial_visit_po) rather than introducing a second pricing
// source; its visit fee is whatever that rubric row says. Installer Error has no rubric key
// on purpose: it never prices.
export const VISIT_EVENT_TYPES = Object.freeze([
  { key: 'job_readiness', label: 'Job Readiness', rubricTicketType: 'initial_visit_po' },
  { key: 'install', label: 'Install', rubricTicketType: 'install' },
  { key: 'sheetrock_window_install', label: 'Sheetrock Window Install', rubricTicketType: 'sheetrock_window' },
  { key: 'service', label: 'Service', rubricTicketType: 'service' },
  { key: 'screen_service', label: 'Screen Service', rubricTicketType: 'screen_service' },
  { key: 'warranty', label: 'Warranty', rubricTicketType: 'warranty' },
  { key: 'installer_error', label: 'Installer Error', rubricTicketType: null },
]);

export const EVENT_TYPE_KEYS = Object.freeze(VISIT_EVENT_TYPES.map((e) => e.key));

// Types that exist on historical records (and on retired rubric rows). Kept so an old
// report still shows a readable event name. Never offered as a new choice — "Punch List"
// in particular: new punch work goes under Service or Warranty.
export const LEGACY_EVENT_TYPES = Object.freeze([
  { key: 'initial_visit_po', label: 'Initial visit' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'sheetrock_window', label: 'Sheetrock window' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'punch_list', label: 'Punch List' },
  { key: 'repair', label: 'Repair' },
  { key: 'measurement', label: 'Measurement' },
  { key: 'inspection', label: 'Inspection' },
]);

export const isCurrentEventType = (key) => EVENT_TYPE_KEYS.includes(String(key || ''));

export function eventTypeLabel(key) {
  const k = String(key || '');
  const current = VISIT_EVENT_TYPES.find((e) => e.key === k);
  if (current) return current.label;
  const legacy = LEGACY_EVENT_TYPES.find((e) => e.key === k);
  if (legacy) return legacy.label;
  return k; // an unknown historical value still reads as itself rather than vanishing
}

export const rubricTicketTypeFor = (key) => (VISIT_EVENT_TYPES.find((e) => e.key === key) || {}).rubricTicketType || null;

// Installer Error corrective visits are caused by us, so they are never chargeable.
export const isBillableEventType = (key) => isCurrentEventType(key) && key !== 'installer_error';

// ── Field scoping ──────────────────────────────────────────────────────────────
const SCOPE = {
  job_readiness: { readiness: true, orderedWindows: true, windowChecklist: true, jobNotFramed: true },
  install: { readiness: true, orderedWindows: true, documentation: true, patio: true },
  sheetrock_window_install: { sheetrock: true },
  service: { readiness: true, documentation: true, patio: true, partsNeeded: true, screenIssues: true, cannotFix: true, serviceChecklist: true },
  screen_service: { hours: true, material: true, screenIssues: true },
  warranty: { hours: true, material: true, warrantyIssue: true },
  installer_error: { hours: true, material: true, correctiveNotes: true },
};
const EMPTY_SCOPE = Object.freeze({
  hours: false, material: false, readiness: false, orderedWindows: false, windowChecklist: false,
  jobNotFramed: false, documentation: false, patio: false, sheetrock: false, partsNeeded: false,
  screenIssues: false, cannotFix: false, serviceChecklist: false, warrantyIssue: false,
  correctiveNotes: false, longDistance: false, billable: false,
});

/** Which fields an event shows. Everything not listed for the event stays off the form. */
export function eventFieldScope(key) {
  if (!isCurrentEventType(key)) return { ...EMPTY_SCOPE };
  const scope = { ...EMPTY_SCOPE, ...SCOPE[key] };
  // Long distance is a trip fact on any chargeable visit; Installer Error charges nothing.
  scope.billable = isBillableEventType(key);
  scope.longDistance = scope.billable;
  return scope;
}

// ── Reason / issue vocabularies ────────────────────────────────────────────────
export const INSTALL_NOT_READY_REASONS = Object.freeze([
  { key: 'windows_not_delivered', label: 'Windows not delivered' },
  { key: 'framing_issue', label: 'Framing issue' },
  { key: 'rescheduled', label: 'Rescheduled' },
  { key: 'other', label: 'Other', needsNote: true },
]);

export const SERVICE_NOT_READY_REASONS = Object.freeze([
  { key: 'house_not_cleaned', label: 'House not cleaned' },
  { key: 'construction_behind', label: 'Too deep in construction / construction behind' },
  { key: 'scheduled_too_early', label: 'Scheduled too early' },
  { key: 'no_access', label: 'Locked / no access' },
  { key: 'other', label: 'Other', needsNote: true },
]);

export const READINESS_JOB_FLAGS = Object.freeze([
  { key: 'house_not_framed', label: 'House not framed / not ready', reschedules: true },
]);

export const WINDOW_ISSUE_KINDS = Object.freeze([
  { key: 'missing', label: 'Window missing', events: ['install'], needsSource: true },
  { key: 'framing_ro', label: 'Framing / incorrect RO', events: ['install', 'job_readiness'], needsDimensions: true },
  { key: 'damaged', label: 'Broken / damaged on delivery', events: ['install'], needsSource: true, needsInstalledAnyway: true },
  { key: 'osb_header', label: 'OSB in headers', events: ['job_readiness'] },
  { key: 'needs_clarification', label: 'Needs clarification', events: ['job_readiness'], needsNote: true, needsRecipients: true },
]);

export const WINDOW_SOURCES = Object.freeze([
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'bfs', label: 'BFS' },
  { key: 'amsco', label: 'AMSCO' },
  { key: '', label: 'Not known' },
]);

export const SHEETROCK_OUTCOMES = Object.freeze([
  { key: 'window_installed', label: 'Completed — window installed' },
  { key: 'sheetrock_not_stocked', label: 'Sheetrock not stocked yet', reschedules: true },
  { key: 'window_missing', label: 'Window missing (possibly removed / taken)' },
  { key: 'window_damaged', label: 'Window damaged' },
]);

export const SCREEN_ISSUE_KINDS = Object.freeze([
  { key: 'missing', label: 'Missing' },
  { key: 'short', label: 'Short' },
  { key: 'wrong_size', label: 'Wrong size' },
]);

// Service's own parts / issue checklist. Repeated issues are checklist and note items, not
// attachment subforms: every photo for the visit goes in the one shared end-of-visit section.
export const SERVICE_CHECKLIST_ITEMS = Object.freeze([
  { key: 'window_operation', label: 'Window will not operate properly' },
  { key: 'hardware', label: 'Hardware (lock, handle, balance, roller)' },
  { key: 'screen', label: 'Screen' },
  { key: 'glass', label: 'Glass (broken, scratched, failed seal)' },
  { key: 'weatherstrip', label: 'Weatherstrip / seal' },
  { key: 'caulking', label: 'Caulking / sealant' },
  { key: 'water_leak', label: 'Water leak' },
  { key: 'trim_drywall', label: 'Trim / drywall damage' },
  { key: 'other', label: 'Other', needsNote: true },
]);

// Installer Error corrective work. Always non-billable; captured for the internal record.
export const INSTALLER_ERROR_ITEMS = Object.freeze([
  { key: 'missed_flashing', label: 'Missed flashing' },
  { key: 'missing_back_dam', label: 'Missing back dam' },
  { key: 'sill_pan', label: 'Sill pan not installed correctly' },
  { key: 'fastening', label: 'Fastening' },
  { key: 'plumb_square_level', label: 'Not plumb / square / level' },
  { key: 'sealant', label: 'Sealant' },
  { key: 'other', label: 'Other', needsNote: true },
]);

/** The repeatable checklist vocabulary for one event, or [] when the event has none. */
export function checklistItemsFor(eventType) {
  const scope = eventFieldScope(eventType);
  if (scope.serviceChecklist) return SERVICE_CHECKLIST_ITEMS;
  if (scope.correctiveNotes) return INSTALLER_ERROR_ITEMS;
  return [];
}

/** The not-ready / readiness reasons for one event, or [] when the event has none. */
export function notReadyReasonsFor(eventType) {
  if (eventType === 'install') return INSTALL_NOT_READY_REASONS;
  if (eventType === 'service') return SERVICE_NOT_READY_REASONS;
  if (eventType === 'job_readiness') return READINESS_JOB_FLAGS;
  return [];
}

/** The window-issue kinds one event may record against an ordered unit. */
export function windowIssueKindsFor(eventType) {
  if (!eventFieldScope(eventType).orderedWindows) return [];
  return WINDOW_ISSUE_KINDS.filter((k) => k.events.includes(eventType));
}

// Optional, non-blocking documentation confirmations. Install and Service share this list;
// the patio prompts only appear when the visit says a patio door exists. A missing
// confirmation is never an error — it is a prompt, not a gate.
export const DOCUMENTATION_PROMPTS = Object.freeze([
  { key: 'all_four_elevations', label: 'All four elevations photographed' },
  { key: 'patio_door_operation_video', label: 'Patio-door operation video', patio: true },
  { key: 'patio_handle_inside', label: 'Inside patio-door handle photo', patio: true },
  { key: 'patio_handle_outside', label: 'Outside patio-door handle photo', patio: true },
  { key: 'foundation_windows', label: 'Every foundation / basement window photographed' },
]);

/** Prompts shown for one event + patio answer. Install and Service only; never required. */
export function documentationPrompts(eventType, { hasPatioDoor = false } = {}) {
  if (!eventFieldScope(eventType).documentation) return [];
  return DOCUMENTATION_PROMPTS.filter((p) => (p.patio ? hasPatioDoor === true : true)).map((p) => ({ ...p, required: false }));
}

// ── Ordered window package ─────────────────────────────────────────────────────
const dim = (v) => {
  const n = num(v);
  return n === null ? '' : String(Math.round(n * 100) / 100);
};

/** Window choices for a job, read from the accepted quote snapshot's ordered lines.
 *  No prices are carried: a worker picks a unit, not a cost. Always ends with "Other" so an
 *  unidentifiable unit can still be reported with a free location/note. */
export function orderedWindowOptions(job) {
  const snapshot = job?.accepted_quote_snapshot || null;
  const lines = Array.isArray(snapshot?.lines) ? snapshot.lines : [];
  const windows = lines.map((line, i) => {
    const id = text(line?.id) || `line-${i + 1}`;
    const size = dim(line?.width) && dim(line?.height) ? `${dim(line.width)}×${dim(line.height)}` : '';
    const label = [text(line?.mark), text(line?.room), text(line?.style), size].filter(Boolean).join(' · ') || `Window ${i + 1}`;
    return {
      id,
      label,
      mark: text(line?.mark),
      room: text(line?.room),
      style: text(line?.style),
      width: num(line?.width),
      height: num(line?.height),
      qty: Number.isInteger(line?.qty) ? line.qty : null,
      units: line?.units === 'in' ? 'in' : '',
      dimension_basis: ['call', 'frame', 'rough_opening'].includes(line?.dimension_basis) ? line.dimension_basis : '',
      position: i + 1,
    };
  });
  return [...windows, { id: 'other', label: 'Other / cannot identify the unit', other: true, position: windows.length + 1 }];
}

const PATIO_RE = /\b(sgd|patio|glid|slider\s*door|french\s*door|\bpd\b)\b/i;
/** Does the ordered package look like it contains a patio door? A hint for the patio prompts;
 *  the worker's own answer still decides. */
export function patioDoorDetected(job) {
  return orderedWindowOptions(job).some((w) => !w.other && PATIO_RE.test([w.style, w.mark, w.room, w.label].join(' ')));
}

export function requiredDimensionsFor(job, windowId) {
  const w = orderedWindowOptions(job).find((x) => x.id === windowId && !x.other);
  if (!w) return null;
  return { width: w.width, height: w.height, units: w.units || 'in', dimension_basis: w.dimension_basis || '' };
}

// ── Pricing (customer sell) ────────────────────────────────────────────────────
/** Shape the live PricingRubric rows into what priceFieldReport reads. Retired rows drop out. */
export function rubricFromRows(rows) {
  const active = (Array.isArray(rows) ? rows : []).filter((r) => r && !r.retired);
  return {
    ticketTypes: active.filter((r) => r.kind === 'ticket_type').map((r) => ({ key: r.key, label: r.label, visit_fee: num(r.visit_fee) })),
    materials: active.filter((r) => r.kind === 'material').map((r) => ({ key: r.key, label: r.label, hourly_rate: num(r.hourly_rate) })),
    longDistanceAmount: num((active.find((r) => r.kind === 'setting' && r.key === 'long_distance') || {}).amount),
  };
}

/** What the customer is charged for one visit, from the live rubric only.
 *  Installer Error returns a non-billable zero. Hours/material are ignored for any event
 *  whose scope does not show them, so an Install can never price labor it never collected. */
export function priceFieldReport({ eventType, hours, material, longDistance, rubric } = {}) {
  const scope = eventFieldScope(eventType);
  const base = { event_type: String(eventType || ''), billable: false, visit_fee: 0, hours: 0, rate: 0, material: '', long_distance_amt: 0, labor_amt: 0, parts: [], reason: '' };
  if (!isCurrentEventType(eventType)) return { ...base, reason: 'unknown_event_type' };
  if (!isBillableEventType(eventType)) return { ...base, reason: 'installer_error_never_billable' };

  const r = rubric || { ticketTypes: [], materials: [], longDistanceAmount: null };
  const ticketKey = rubricTicketTypeFor(eventType);
  const ttRow = (r.ticketTypes || []).find((t) => t.key === ticketKey) || null;
  const visitFee = Math.max(0, num(ttRow?.visit_fee) || 0);

  const hrs = scope.hours ? halfHours(hours) : 0;
  const matKey = scope.material ? text(material) : '';
  const matRow = matKey ? (r.materials || []).find((m) => m.key === matKey || m.label === matKey) || null : null;
  const rate = matRow ? Math.max(0, num(matRow.hourly_rate) || 0) : 0;

  const ldAmt = scope.longDistance && longDistance === true ? Math.max(0, num(r.longDistanceAmount) || 0) : 0;
  const laborAmt = round2(visitFee + hrs * rate + ldAmt);

  const parts = [`${(ttRow && ttRow.label) || eventTypeLabel(eventType)} visit${visitFee ? ` $${visitFee}` : ''}`];
  if (hrs > 0) parts.push(`${hrs} h x $${rate}${matRow ? ` ${matRow.label}` : ''}`);
  if (ldAmt) parts.push(`long distance $${ldAmt}`);

  return {
    ...base,
    billable: laborAmt > 0,
    visit_fee: visitFee,
    hours: hrs,
    rate,
    material: matRow ? matRow.key : matKey,
    long_distance_amt: ldAmt,
    labor_amt: laborAmt,
    parts,
    reason: laborAmt > 0 ? '' : 'no_chargeable_amount',
  };
}

// ── Internal cost (never sell pricing) ─────────────────────────────────────────
/** The honest internal cost state for the hours/material a visit recorded.
 *
 *  costSources must come from a real internal cost source. There is no per-material internal
 *  labour cost rate anywhere in the Hub today — PricingRubric.hourly_rate is the CUSTOMER rate
 *  — so with no rate supplied this returns `pending` and no amount. It never falls back to the
 *  rubric, by construction: no rubric argument reaches this function. */
export function internalCostState({ eventType, hours, material, costSources } = {}) {
  const scope = eventFieldScope(eventType);
  const hrs = scope.hours ? halfHours(hours) : 0;
  const mat = scope.material ? text(material) : '';
  const src = costSources || {};
  const rate = num(src.internal_labor_rate_per_hour);
  const matCost = num(src.internal_material_cost);
  const out = { hours: hrs, material: mat, state: 'unpriced', amount: null, reason: 'no_hours_recorded', source: text(src.source) };

  if (!scope.hours && !scope.material) return { ...out, reason: 'event_records_no_hours_or_material' };
  if (hrs <= 0 && !mat) return out;
  if (rate !== null && rate > 0) {
    const amount = round2(hrs * rate + (matCost !== null && matCost > 0 ? matCost : 0));
    return { ...out, state: 'priced', amount, reason: '' };
  }
  return { ...out, state: 'pending', amount: null, reason: 'no_internal_labor_cost_rate' };
}

export const COST_STATE_LABELS = Object.freeze({ priced: 'Internal cost recorded', pending: 'Internal cost pending', unpriced: 'Internal cost unpriced' });

// ── Follow-up routing ──────────────────────────────────────────────────────────
const reasonKeys = (report) => list(report?.not_ready_reasons).map((x) => text(x.key)).filter(Boolean);

/** Why this report needs somebody told. An empty array means zero recipients is valid. */
export function followUpTriggers(report) {
  const triggers = [];
  const add = (t) => { if (!triggers.includes(t)) triggers.push(t); };
  if (report?.completion === 'incomplete') add('incomplete_work');
  if (report?.not_ready === true || reasonKeys(report).length > 0) add('job_not_ready');
  for (const w of list(report?.window_issues)) {
    if (text(w.kind) === 'needs_clarification') add('needs_clarification');
    if (w.follow_up === true) add('unresolved_issue');
  }
  for (const it of list(report?.items)) if (it.follow_up === true) add('unresolved_issue');
  for (const s of list(report?.screen_issues)) if (s.follow_up === true) add('unresolved_issue');
  if (list(report?.cannot_fix).length > 0) add('manager_review');
  if (list(report?.sheetrock_outcomes).some((o) => text(o.key) === 'sheetrock_not_stocked')) add('needs_rescheduling');
  if (reasonKeys(report).includes('house_not_framed')) add('needs_rescheduling');
  if (reasonKeys(report).includes('rescheduled')) add('needs_rescheduling');
  return triggers;
}

export const followUpRequired = (report) => followUpTriggers(report).length > 0;

export const TRIGGER_LABELS = Object.freeze({
  incomplete_work: 'Work left incomplete',
  job_not_ready: 'Job not ready',
  needs_clarification: 'Needs clarification',
  unresolved_issue: 'Unresolved issue needing follow-up',
  manager_review: 'Manager investigation / review',
  needs_rescheduling: 'Needs rescheduling',
});

/** Rescheduling is a flag and a reason. No date is ever guessed here. */
export function reschedulingFlags(report) {
  const reasons = [];
  if (list(report?.sheetrock_outcomes).some((o) => text(o.key) === 'sheetrock_not_stocked')) reasons.push('sheetrock_not_stocked');
  const keys = reasonKeys(report);
  if (keys.includes('house_not_framed')) reasons.push('house_not_framed');
  if (keys.includes('rescheduled')) reasons.push('rescheduled');
  return { needs_rescheduling: reasons.length > 0, rescheduling_reason: reasons.join(', '), rescheduled_date: null };
}

// ── Validation ─────────────────────────────────────────────────────────────────
const MEDIA_FIELDS = ['media', 'media_urls', 'photos', 'photo_urls', 'videos', 'attachments', 'files'];
const hasOwnMedia = (item) => MEDIA_FIELDS.some((k) => Object.prototype.hasOwnProperty.call(item || {}, k));

/** Everything that blocks a submit, and nothing else.
 *  Missing photos/videos and unticked documentation confirmations are never errors. */
export function validateFieldReport(report) {
  const errors = [];
  const add = (code) => { if (!errors.includes(code)) errors.push(code); };
  const eventType = text(report?.event_type);
  const scope = eventFieldScope(eventType);
  if (!isCurrentEventType(eventType)) add('event_type');

  if (report?.completion !== 'complete' && report?.completion !== 'incomplete') add('completion');
  if (report?.completion === 'incomplete' && !text(report?.incomplete_reason)) add('incomplete_reason');

  for (const r of list(report?.not_ready_reasons)) if (text(r.key) === 'other' && !text(r.note)) add('other_reason_note');
  for (const it of list(report?.items)) {
    if (hasOwnMedia(it)) add('issue_level_media_not_allowed');
    if (text(it.key) === 'other' && !text(it.note)) add('other_issue_note');
  }

  for (const w of list(report?.window_issues)) {
    if (hasOwnMedia(w)) add('issue_level_media_not_allowed');
    const kind = text(w.kind);
    const spec = WINDOW_ISSUE_KINDS.find((k) => k.key === kind);
    if (!spec || !spec.events.includes(eventType)) { add('window_issue_kind'); continue; }
    const target = text(w.window_id);
    if (!target) add('window_target');
    else if (target === 'other' && !text(w.location_note)) add('window_other_location');
    if (spec.needsDimensions) {
      const cur = [num(w.current_width), num(w.current_height)];
      const req = [num(w.required_width), num(w.required_height)];
      if (cur.some((v) => v === null || v <= 0)) add('current_ro_dimensions');
      if (req.some((v) => v === null || v <= 0)) add('required_ro_dimensions');
    }
    if (spec.needsNote && !text(w.note)) add('window_issue_note');
  }

  for (const s of list(report?.screen_issues)) {
    if (hasOwnMedia(s)) add('issue_level_media_not_allowed');
    if (!SCREEN_ISSUE_KINDS.some((k) => k.key === text(s.kind))) add('screen_issue_kind');
    const qty = num(s.quantity);
    if (qty === null || !Number.isInteger(qty) || qty < 1) add('screen_quantity');
    if (!text(s.location)) add('screen_location');
  }

  for (const c of list(report?.cannot_fix)) {
    if (hasOwnMedia(c)) add('issue_level_media_not_allowed');
    if (!text(c.window_id)) add('cannot_fix_window');
    if (!text(c.note)) add('cannot_fix_note');
  }

  if (scope.sheetrock && list(report?.sheetrock_outcomes).length === 0) add('sheetrock_outcome');

  const recipients = (Array.isArray(report?.recipients) ? report.recipients : []).map((x) => text(typeof x === 'string' ? x : x?.id)).filter(Boolean);
  if (followUpRequired(report) && recipients.length === 0) add('recipients_required');

  return { ok: errors.length === 0, errors, recipients, triggers: followUpTriggers(report), scope };
}

// ── Today Hub fan-out ──────────────────────────────────────────────────────────
const KEY_SAFE = (v) => String(v || '').replace(/[^A-Za-z0-9:_-]/g, '-');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const followUpTaskKey = (requestKey, memberId) => `${KEY_SAFE(requestKey)}:fu:${KEY_SAFE(memberId)}`;
export const feeLineMarker = (requestKey) => `[field-visit:${KEY_SAFE(requestKey)}]`;

/** Readable lines describing what the visit found — the body of the job note and the
 *  detail block of every follow-up Today item. */
export function reportSummaryLines(report, { job } = {}) {
  const lines = [];
  const eventType = text(report?.event_type);
  lines.push(`Event: ${eventTypeLabel(eventType)}`);
  if (report?.completion) lines.push(`Status: ${report.completion === 'complete' ? 'Completed' : 'Incomplete'}`);
  if (text(report?.incomplete_reason)) lines.push(`Why incomplete: ${text(report.incomplete_reason)}`);
  for (const r of list(report?.not_ready_reasons)) lines.push(`Not ready: ${text(r.label) || text(r.key)}${text(r.note) ? ` — ${text(r.note)}` : ''}`);
  for (const o of list(report?.sheetrock_outcomes)) lines.push(`Sheetrock: ${text(o.label) || text(o.key)}${text(o.note) ? ` — ${text(o.note)}` : ''}`);
  if (text(report?.warranty_issue?.text)) lines.push(`Reported by ${text(report.warranty_issue.reported_by) || 'caller'}: ${text(report.warranty_issue.text)}`);
  const windows = job ? orderedWindowOptions(job) : [];
  const windowLabel = (id, fallback) => text(fallback) || (windows.find((w) => w.id === id) || {}).label || text(id);
  for (const w of list(report?.window_issues)) {
    const spec = WINDOW_ISSUE_KINDS.find((k) => k.key === text(w.kind));
    const bits = [`${spec ? spec.label : text(w.kind)}: ${windowLabel(text(w.window_id), w.window_label)}`];
    if (text(w.location_note)) bits.push(`location ${text(w.location_note)}`);
    if (num(w.current_width) !== null && num(w.current_height) !== null) bits.push(`framed ${dim(w.current_width)}×${dim(w.current_height)}`);
    if (num(w.required_width) !== null && num(w.required_height) !== null) bits.push(`required ${dim(w.required_width)}×${dim(w.required_height)}`);
    if (text(w.source)) bits.push(`source ${text(w.source)}`);
    if (w.installed_anyway === true) bits.push('installed anyway: yes');
    if (w.installed_anyway === false) bits.push('installed anyway: no');
    if (text(w.note)) bits.push(text(w.note));
    lines.push(bits.join(' · '));
  }
  for (const it of list(report?.items)) lines.push(`Issue: ${text(it.label) || text(it.key)}${text(it.note) ? ` — ${text(it.note)}` : ''}`);
  for (const s of list(report?.screen_issues)) lines.push(`Screens ${text(s.kind)}: qty ${num(s.quantity) ?? '?'} at ${text(s.location)}${text(s.note) ? ` — ${text(s.note)}` : ''}`);
  for (const c of list(report?.cannot_fix)) lines.push(`Cannot fix ${windowLabel(text(c.window_id), c.window_label)}: ${text(c.note)} (manager review)`);
  if (text(report?.parts_needed)) lines.push(`Parts needed: ${text(report.parts_needed)}`);
  const scope = eventFieldScope(eventType);
  if (scope.hours && halfHours(report?.hours) > 0) lines.push(`Hours: ${halfHours(report.hours).toFixed(1)}`);
  if (scope.material && text(report?.material)) lines.push(`Product material: ${text(report.material)}`);
  if (scope.longDistance && report?.long_distance === true) lines.push('Long distance: Yes');
  const confirmed = Object.entries(report?.documentation || {}).filter(([, v]) => v === true).map(([k]) => (DOCUMENTATION_PROMPTS.find((p) => p.key === k) || { label: k }).label);
  if (confirmed.length) lines.push(`Documented: ${confirmed.join(', ')}`);
  if (text(report?.notes)) lines.push(text(report.notes));
  return lines;
}

/** One Today Hub item per selected recipient. Each carries the job, the event, the issue
 *  detail, the notes and a link back to the originating report, and a per-recipient
 *  request_key so a retry or an edited re-submit updates nothing and duplicates nothing. */
export function buildFollowUpTasks({ report, requestKey, recipients, job, jobId, jobName, originPath, author, now, createdByUserId, assignedByUserId } = {}) {
  const triggers = followUpTriggers(report);
  if (!triggers.length) return [];
  const people = (Array.isArray(recipients) ? recipients : []).filter((m) => m && text(m.id));
  if (!people.length) return [];
  const eventType = text(report?.event_type);
  const name = text(jobName) || text(job?.canonical_name) || text(jobId) || 'job';
  const link = text(originPath) || (text(jobId) ? `/jobs/${text(jobId)}` : '');
  const detail = [
    `Job: ${name}`,
    `Event: ${eventTypeLabel(eventType)}`,
    `Needs attention: ${triggers.map((t) => TRIGGER_LABELS[t] || t).join(', ')}`,
    ...reportSummaryLines(report, { job }),
    author ? `Filed by: ${text(author)}` : '',
    now ? `Filed at: ${text(now)}` : '',
    link ? `Full report: ${link}` : '',
  ].filter(Boolean).join('\n');

  return people.map((m) => ({
    title: clip(`Field visit follow-up — ${eventTypeLabel(eventType)} — ${name}`, 200),
    details: clip(detail, 5000),
    assignee_member_id: text(m.id),
    status: 'open',
    progress_note: '',
    due_date: '',
    category: 'follow_up',
    created_by_user_id: text(createdByUserId),
    assigned_by_user_id: text(assignedByUserId || createdByUserId),
    completed_at: '',
    completed_by_user_id: '',
    archived_at: '',
    revision: 0,
    request_key: followUpTaskKey(requestKey, m.id),
    seed_key: '',
    job_id: text(jobId),
    created_at: text(now),
    updated_at: text(now),
  }));
}

// ── Hub invoicing staging ──────────────────────────────────────────────────────
/** The FeeLines draft that stages one eligible billable visit in the Hub's invoicing tab.
 *  Returns null when the event is not chargeable (Installer Error always) or prices to $0,
 *  so a non-billable visit can never reach staging. The marker in note_text is the
 *  idempotency key a retry or an edited re-submit matches on. */
export function buildInvoiceStagingLine({ price, report, requestKey, jobId, jobName, jobDate, calendarEventId, media, author } = {}) {
  if (!price || price.billable !== true || !(num(price.labor_amt) > 0)) return null;
  const date = text(jobDate);
  const marker = feeLineMarker(requestKey);
  const summary = reportSummaryLines(report).join(' | ');
  return {
    job_id: text(jobId),
    job_date: date,
    invoice_month: date.slice(0, 7),
    job_name_raw: text(jobName).toUpperCase(),
    job_name_norm: text(jobName).toLowerCase(),
    line_description: clip(`Field report charge: ${price.parts.join(' + ')}`, 300),
    note_text: clip(`${marker} ${summary}`, 2000),
    man_hours: price.hours > 0 ? price.hours : null,
    trip_charges: price.long_distance_amt > 0 ? 1 : null,
    service_material: price.material || null,
    service_rate: price.rate || null,
    labor_amt: price.labor_amt,
    fee_type: 'labor_pct',
    fee_pct: 0.1,
    fee_amt: round2(price.labor_amt * 0.1),
    manually_adjusted: true,
    billable: true,
    billed_to_bfs: false,
    paid_to_ya: false,
    invoiced_to_ya: false,
    source: 'field_report',
    written_by: text(author) || 'field_report',
    match_confidence: 'high',
    calendar_event_id: text(calendarEventId) || null,
    photo_urls: Array.isArray(media) ? media : [],
  };
}

/** How a settled report reads in the Hub: staged for invoicing, or explicitly not billable. */
export function invoiceStagingState({ eventType, price }) {
  if (!isBillableEventType(eventType)) return 'not_billable';
  return price && price.billable === true && num(price.labor_amt) > 0 ? 'staged' : 'none';
}
