// Pure decision helper for the source-note follow-through policy. No SDK, no I/O.
// All decisions derive from the inputs. The ingest (fetchProbuildPosts) imports
// buildNewReportRow + planReportWrite + executeMessageFills and NEVER passes
// authorizedCorrection.
//
// Policy (approved):
// - source_message_baseline is the exact raw source string captured at the last sync
//   that wrote the Hub message; source_baseline_at is when it was set.
// - New ingest rows seed message + baseline = source verbatim (empty string when the
//   source has no text yet).
// - Empty fill: Hub message empty + source nonempty -> write message + seed baseline.
// - Legacy verified Hub==source (no baseline, no manual markers) -> seed baseline only.
// - Update: Hub nonempty, baseline is a clean nonempty string, Hub === baseline, source
//   nonempty and differs -> write message + baseline. Current Hub MUST exactly equal the
//   last synced baseline.
// - Manual markers (edited_at/edited_by/original_text) block every source-driven
//   message/baseline change. Null markers alone never prove authorship; the baseline
//   gate is what authorizes an update.
// - Whitespace/type-malformed baseline fails closed for updates (treated as no usable
//   baseline). Empty/whitespace source never clears the Hub. Legacy divergent nonempty
//   Hub with no baseline is preserved.
// - authorizedCorrection is an EXTERNAL one-off (e.g. a reviewed Rainey correction),
//   never passed by the ingest. It bypasses the manual-marker block and the baseline
//   gate but still never writes on an empty source.
// - Exact project+post identity and duplicate post-id are enforced by the caller
//   (duplicatePostIds) and by freshRecheck's post_id match.
// - The GET-to-update cycle is NOT atomic CAS; the platform exposes no compare-and-set.
//   freshRecheck narrows the race window by re-running the full predicate just before the
//   write, but an edit landing between the fresh get and the update can still be
//   overwritten. This is documented, not pretended away.

const isString = (v) => typeof v === 'string';
const isNonempty = (s) => isString(s) && s.trim() !== '';
const isEmpty = (s) => s == null || (isString(s) && s.trim() === '');

function hasManualMarkers(existing) {
  return !!(existing && (existing.edited_at || existing.edited_by || existing.original_text));
}

// A usable baseline is a clean, nonempty, non-whitespace string. Empty string, null,
// non-string or whitespace-only all count as "no usable baseline" (fail closed for
// updates; seed-eligible for the verified-equal legacy case).
function baselineUsable(baseline) {
  return isString(baseline) && baseline.length > 0 && baseline.trim() !== '';
}

// Decide what (if anything) to write for one existing report.
// Returns { action: 'none', reason } | { action: 'write', plannedAction, patch }.
// patch is source/baseline-only: { message?, source_message_baseline, source_baseline_at }.
//   - message included only when it changes (empty_fill / update / authorized_correction);
//     omitted on baseline_seed.
//   - source_message_baseline is always the new verbatim baseline.
//   - source_baseline_at is always nowIso.
export function planReportWrite({ existing, sourceMessage, nowIso, authorizedCorrection }) {
  const src = isString(sourceMessage) ? sourceMessage : '';
  const srcNonempty = src.trim() !== '';
  const hub = isString(existing && existing.message) ? existing.message : '';
  const hubEmpty = hub.trim() === '';
  const baseline = existing && existing.source_message_baseline;
  const baselineOk = baselineUsable(baseline);
  const manual = hasManualMarkers(existing);

  // Manual markers block every source-driven change unless an explicit external
  // authorizedCorrection is passed (never by the ingest).
  if (manual && !authorizedCorrection) return { action: 'none', reason: 'manual_markers' };

  // Empty/whitespace source never clears or changes the Hub.
  if (!srcNonempty) return { action: 'none', reason: 'empty_source' };

  // External authorized correction (one-off, e.g. Rainey): bypass the baseline gate and
  // the manual-marker block, set message + baseline = source. Still never writes on
  // empty source. The ingest never passes this.
  if (authorizedCorrection) {
    return { action: 'write', plannedAction: 'authorized_correction', patch: { message: src, source_message_baseline: src, source_baseline_at: nowIso } };
  }

  // Empty fill: Hub empty, source nonempty.
  if (hubEmpty) {
    return { action: 'write', plannedAction: 'empty_fill', patch: { message: src, source_message_baseline: src, source_baseline_at: nowIso } };
  }

  // Hub nonempty from here.

  // No usable baseline (null / empty / whitespace / non-string).
  if (!baselineOk) {
    // Legacy verified Hub == source -> seed baseline only (message already equals source).
    if (hub === src) return { action: 'write', plannedAction: 'baseline_seed', patch: { source_message_baseline: src, source_baseline_at: nowIso } };
    // Legacy divergent nonempty Hub, no baseline -> preserve.
    return { action: 'none', reason: 'legacy_divergent_no_baseline' };
  }

  // Baseline is a clean nonempty string. Update gate: current Hub MUST exactly equal baseline.
  if (hub !== baseline) {
    // Hub changed since last sync without manual markers -> do not overwrite.
    return { action: 'none', reason: 'hub_changed_since_baseline' };
  }

  // Hub === baseline. Already in sync with source?
  if (src === hub) return { action: 'none', reason: 'already_in_sync' };

  // Source differs -> update message + baseline.
  return { action: 'write', plannedAction: 'update', patch: { message: src, source_message_baseline: src, source_baseline_at: nowIso } };
}

// Re-run the full predicate against a fresh GET just before the write.
// Returns { safe: true, patch } | { safe: false, reason }.
// Checks: fresh record exists, exact post_id identity, and the full planReportWrite
// predicate still yields a write with the same plannedAction. The patch is re-derived
// from the fresh record. NOT atomic CAS; this only narrows the GET-to-update window.
export function freshRecheck({ fresh, expectedPostId, sourceMessage, nowIso, expectedAction }) {
  if (!fresh) return { safe: false, reason: 'fresh_missing' };
  if (fresh.post_id !== expectedPostId) return { safe: false, reason: 'post_id_mismatch' };
  const recheck = planReportWrite({ existing: fresh, sourceMessage, nowIso });
  if (recheck.action !== 'write') return { safe: false, reason: 'predicate_failed:' + recheck.reason };
  if (expectedAction && recheck.plannedAction !== expectedAction) return { safe: false, reason: 'action_changed:' + recheck.plannedAction };
  return { safe: true, patch: recheck.patch };
}

// Build a new FieldReports row with the baseline seeded on create.
// Pure: no SDK, no I/O. message + baseline = source verbatim ('' when source is empty).
export function buildNewReportRow({
  jobFields, jobDate, jobName, message, photoUrls, attachmentCount,
  postId, projectId, createdAt, manHours, tripCharges, nowIso,
}) {
  const src = isString(message) ? message : '';
  return {
    ...(jobFields || {}),
    job_date: jobDate,
    job_name: jobName,
    message: src,
    source_message_baseline: src,
    source_baseline_at: nowIso,
    photo_urls: photoUrls || [],
    attachment_count: attachmentCount || 0,
    post_id: postId,
    project_id: projectId,
    created_at: createdAt || null,
    man_hours: manHours != null ? Number(manHours) : null,
    trip_charges: tripCharges != null ? Number(tripCharges) : null,
  };
}

// Batch planner. Never passes authorizedCorrection (ingest path).
// items: [{ existing, sourceMessage, postId, duplicatePostId }]
// Returns { writes: [{ id, postId, plannedAction, patch }], skipped: [{ postId, reason }] }
export function planReportWrites(items, nowIso) {
  const writes = [];
  const skipped = [];
  for (const it of items) {
    if (it.duplicatePostId) { skipped.push({ postId: it.postId, reason: 'duplicate_post_id' }); continue; }
    const res = planReportWrite({ existing: it.existing, sourceMessage: it.sourceMessage, nowIso });
    if (res.action === 'write') writes.push({ id: it.existing.id, postId: it.postId, plannedAction: res.plannedAction, patch: res.patch });
    else skipped.push({ postId: it.postId, reason: res.reason });
  }
  return { writes, skipped };
}

// The write adapter used by the ingest's message/baseline phase. Injected get/update so
// it is testable without the SDK. Re-runs the full predicate (freshRecheck) just before
// each write. Source/baseline-only patch. NOT atomic CAS.
// messageFills: [{ id, postId, sourceMessage, plannedAction, patch }]
// Returns { filled, skipped }.
export async function executeMessageFills({ messageFills, get, update, nowIso }) {
  let filled = 0;
  let skipped = 0;
  for (const mf of messageFills) {
    let fresh;
    try { fresh = await get(mf.id); }
    catch (e) { skipped++; continue; }
    const recheck = freshRecheck({ fresh, expectedPostId: mf.postId, sourceMessage: mf.sourceMessage, nowIso, expectedAction: mf.plannedAction });
    if (!recheck.safe) { skipped++; continue; }
    try { await update(mf.id, recheck.patch); filled++; }
    catch (e) { skipped++; }
  }
  return { filled, skipped };
}