// Pure decision helper for the source-note follow-through policy. No SDK, no I/O.
// All decisions derive from the inputs. The ingest (fetchProbuildPosts) imports
// buildNewReportRow + planReportWrite + executeMessageFills.
//
// Policy (approved, defect-corrected, final-adapter-gap closed):
// - source_message_baseline is the exact raw source string captured at the last sync
//   that wrote the Hub message; source_baseline_at is when it was set.
// - New ingest rows seed message + baseline = source verbatim ('' when source empty).
// - Empty fill: Hub message empty (null/undefined/'') + source nonempty -> write
//   message + seed baseline.
// - Legacy verified Hub==source (baseline null/absent, no manual markers) -> seed
//   baseline only. ONLY null/absent (true legacy) may seed; a present-but-malformed
//   baseline (empty string / whitespace / non-string) never seeds a nonempty Hub.
// - Update: Hub nonempty, baseline a clean nonempty string, Hub === baseline, source
//   nonempty and differs -> write message + baseline. Current Hub MUST exactly equal
//   the last synced baseline.
// - Manual markers (edited_at/edited_by/original_text) ALWAYS block every source-driven
//   message/baseline change. There is NO authorizedCorrection lever in this helper;
//   the Rainey one-off is inspected/handled separately and externally.
// - Malformed Hub (number/object/boolean) fails closed (never coerced to '' and
//   overwritten). Malformed baseline (non-string / whitespace / empty string) fails
//   closed for updates and never seeds. Empty/whitespace source never clears Hub.
// - Exact project+post identity is verified at the initial plan AND the fresh recheck
//   (expectedPostId + expectedProjectId); mismatch fails closed.
// - The fresh recheck carries a plan-time snapshot (message + baseline + markers +
//   project_id + post_id) and requires the fresh record to match it byte-for-byte
//   BEFORE re-running the predicate. This is a narrower race safeguard than action
//   equality: even if the re-run predicate would still produce the same action, a
//   changed Hub or baseline means a newer sync advanced the state and a stale earlier
//   source must not overwrite it.
// - The adapter (executeMessageFills) MANDATES nonempty id + expectedPostId +
//   expectedProjectId + snapshot per queued fill (omitting any skips the guard, so a
//   planner that forgets them can never silently bypass identity/snapshot checks).
//   fresh.id must equal the queued id. An injected lookup by post_id is run just
//   before write and must return exactly one record matching the expected id +
//   project; a duplicate that appeared since plan (or the record going missing) fails
//   closed. planReportWrites emits the exact queue shape (expectedPostId /
//   expectedProjectId / id / snapshot / sourceMessage) so its output feeds the adapter
//   directly.
// - The GET-to-update cycle is NOT atomic CAS; the platform exposes no compare-and-set.
//   The snapshot + predicate re-run + duplicate lookup narrow the race window but an
//   edit landing between the fresh get and the update can still be overwritten.
//   Documented, not pretended away.

const isString = (v) => typeof v === 'string';

function hasManualMarkers(existing) {
  return !!(existing && (existing.edited_at || existing.edited_by || existing.original_text));
}

// Capture the relevant state of an existing record at plan time, so the fresh GET can
// be compared to it byte-for-byte before any write (narrow race safeguard). Includes
// the exact post_id + project_id so a re-keyed record is detected.
export function captureSnapshot(existing) {
  return {
    post_id: existing ? existing.post_id : undefined,
    project_id: existing ? existing.project_id : undefined,
    message: existing ? existing.message : undefined,
    source_message_baseline: existing ? existing.source_message_baseline : undefined,
    edited_at: existing ? existing.edited_at : undefined,
    edited_by: existing ? existing.edited_by : undefined,
    original_text: existing ? existing.original_text : undefined,
  };
}

// Decide what (if anything) to write for one existing report.
// expectedPostId / expectedProjectId: when provided, the record must match both
// (exact project+post identity); mismatch fails closed. The ingest always passes the
// post's own ids so a wrong-project record can never be changed.
// There is NO authorizedCorrection lever: manual markers ALWAYS block.
// Returns { action: 'none', reason } | { action: 'write', plannedAction, patch, snapshot }.
// patch is source/baseline-only: { message?, source_message_baseline, source_baseline_at }.
export function planReportWrite({ existing, sourceMessage, nowIso, expectedPostId, expectedProjectId }) {
  // Exact project+post identity (initial check). Fail closed on mismatch OR missing.
  if (expectedPostId != null && (!existing || existing.post_id !== expectedPostId)) {
    return { action: 'none', reason: 'identity_mismatch:post_id' };
  }
  if (expectedProjectId != null && (!existing || existing.project_id !== expectedProjectId)) {
    return { action: 'none', reason: 'identity_mismatch:project_id' };
  }

  // Manual markers ALWAYS block (no authorizedCorrection bypass).
  if (hasManualMarkers(existing)) return { action: 'none', reason: 'manual_markers' };

  const src = isString(sourceMessage) ? sourceMessage : '';
  const srcNonempty = src.trim() !== '';
  // Empty/whitespace source never clears or changes the Hub.
  if (!srcNonempty) return { action: 'none', reason: 'empty_source' };

  // Hub type check: null/undefined -> empty; string -> as-is; anything else
  // (number/object/boolean) is malformed -> fail closed (never coerce to '' and overwrite).
  const hubRaw = existing ? existing.message : undefined;
  let hub;
  if (hubRaw == null) {
    hub = '';
  } else if (isString(hubRaw)) {
    hub = hubRaw;
  } else {
    return { action: 'none', reason: 'malformed_hub' };
  }
  const hubEmpty = hub.trim() === '';

  const baseline = existing ? existing.source_message_baseline : undefined;
  const baselineAbsent = baseline == null; // null/undefined = true legacy (field absent)
  const baselineUsable = isString(baseline) && baseline.length > 0 && baseline.trim() !== '';

  const snapshot = captureSnapshot(existing);

  // Empty fill: Hub empty, source nonempty.
  if (hubEmpty) {
    return { action: 'write', plannedAction: 'empty_fill', patch: { message: src, source_message_baseline: src, source_baseline_at: nowIso }, snapshot };
  }

  // Hub nonempty from here.

  if (baselineAbsent) {
    // True legacy (no baseline field). Verified Hub == source -> seed baseline only.
    if (hub === src) return { action: 'write', plannedAction: 'baseline_seed', patch: { source_message_baseline: src, source_baseline_at: nowIso }, snapshot };
    // Legacy divergent nonempty Hub -> preserve.
    return { action: 'none', reason: 'legacy_divergent_no_baseline' };
  }

  if (!baselineUsable) {
    // Malformed baseline (empty string / whitespace / non-string). Fail closed: no seed,
    // no update, even when Hub === source. Only null/absent (true legacy) may seed.
    return { action: 'none', reason: 'malformed_baseline' };
  }

  // Baseline is a clean nonempty string. Update gate: current Hub MUST exactly equal baseline.
  if (hub !== baseline) {
    return { action: 'none', reason: 'hub_changed_since_baseline' };
  }
  if (src === hub) return { action: 'none', reason: 'already_in_sync' };
  return { action: 'write', plannedAction: 'update', patch: { message: src, source_message_baseline: src, source_baseline_at: nowIso }, snapshot };
}

// Re-run the full predicate against a fresh GET, but ONLY after the fresh record matches
// the plan-time snapshot byte-for-byte (message, baseline, markers, post_id, project_id)
// and the queued id (fresh.id === expectedId). This is a narrower race safeguard than
// action equality: even if the re-run predicate would still produce the same action, a
// changed Hub or baseline means a newer sync advanced the state and a stale earlier
// source must not overwrite it.
// expectedId / expectedPostId / expectedProjectId are optional here (checked when provided);
// the adapter mandates them nonempty before calling.
// Returns { safe: true, patch } | { safe: false, reason }.
export function freshRecheck({ fresh, expectedId, expectedPostId, expectedProjectId, snapshot, sourceMessage, nowIso, expectedAction }) {
  if (!fresh) return { safe: false, reason: 'fresh_missing' };
  if (expectedId != null && fresh.id !== expectedId) return { safe: false, reason: 'id_mismatch' };
  if (expectedPostId != null && fresh.post_id !== expectedPostId) return { safe: false, reason: 'post_id_mismatch' };
  if (expectedProjectId != null && fresh.project_id !== expectedProjectId) return { safe: false, reason: 'project_id_mismatch' };
  if (snapshot) {
    if (fresh.message !== snapshot.message) return { safe: false, reason: 'state_changed_since_plan:message' };
    if (fresh.source_message_baseline !== snapshot.source_message_baseline) return { safe: false, reason: 'state_changed_since_plan:baseline' };
    if ((fresh.edited_at || null) !== (snapshot.edited_at || null)) return { safe: false, reason: 'state_changed_since_plan:edited_at' };
    if ((fresh.edited_by || null) !== (snapshot.edited_by || null)) return { safe: false, reason: 'state_changed_since_plan:edited_by' };
    if ((fresh.original_text || null) !== (snapshot.original_text || null)) return { safe: false, reason: 'state_changed_since_plan:original_text' };
    if ((fresh.project_id || null) !== (snapshot.project_id || null)) return { safe: false, reason: 'state_changed_since_plan:project_id' };
    if ((fresh.post_id || null) !== (snapshot.post_id || null)) return { safe: false, reason: 'state_changed_since_plan:post_id' };
  }
  const recheck = planReportWrite({ existing: fresh, sourceMessage, nowIso, expectedPostId, expectedProjectId });
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

// Batch planner. Never passes authorizedCorrection (no such lever). Verifies exact
// project+post identity per item. Output shape is the EXACT queue shape the adapter
// (executeMessageFills) consumes: { id, expectedPostId, expectedProjectId, sourceMessage,
// plannedAction, patch, snapshot }. So planReportWrites(...).writes feeds the adapter
// directly with no reshaping.
// items: [{ existing, sourceMessage, postId, projectId, duplicatePostId }]
// Returns { writes: [...], skipped: [{ postId, reason }] }
export function planReportWrites(items, nowIso) {
  const writes = [];
  const skipped = [];
  for (const it of items) {
    if (it.duplicatePostId) { skipped.push({ postId: it.postId, reason: 'duplicate_post_id' }); continue; }
    const res = planReportWrite({ existing: it.existing, sourceMessage: it.sourceMessage, nowIso, expectedPostId: it.postId, expectedProjectId: it.projectId });
    if (res.action === 'write') {
      writes.push({ id: it.existing.id, expectedPostId: it.postId, expectedProjectId: it.projectId, sourceMessage: it.sourceMessage, plannedAction: res.plannedAction, patch: res.patch, snapshot: res.snapshot });
    } else {
      skipped.push({ postId: it.postId, reason: res.reason });
    }
  }
  return { writes, skipped };
}

// The write adapter used by the ingest's message/baseline phase. Injected get/update/
// lookup so it is testable without the SDK. Re-runs the snapshot equality + full
// predicate (freshRecheck) just before each write, then a fresh duplicate-mapping
// lookup by post_id that must return exactly one record matching the expected id +
// project. Source/baseline-only patch. NOT atomic CAS.
//
// MANDATES nonempty id + expectedPostId + expectedProjectId + snapshot per queued fill:
// omitting any fails closed, so a planner that forgets them can never silently bypass
// the identity/snapshot guards. fresh.id must equal the queued id.
//
// messageFills: [{ id, expectedPostId, expectedProjectId, snapshot, sourceMessage, plannedAction, patch }]
// lookup(postId, projectId): optional injected fresh-duplicate check; returns an array
//   (or a page {items}) of records with that post_id. When provided, must be exactly one
//   record matching id + post_id + project_id, else fail closed.
// Returns { filled, skipped }.
export async function executeMessageFills({ messageFills, get, update, lookup, nowIso }) {
  let filled = 0;
  let skipped = 0;
  for (const mf of messageFills) {
    // Mandatory nonempty id + expected ids + snapshot. Fail closed if any missing/empty.
    if (!mf || !mf.id || !mf.expectedPostId || !mf.expectedProjectId || !mf.snapshot) { skipped++; continue; }
    let fresh;
    try { fresh = await get(mf.id); }
    catch (e) { skipped++; continue; }
    const recheck = freshRecheck({ fresh, expectedId: mf.id, expectedPostId: mf.expectedPostId, expectedProjectId: mf.expectedProjectId, snapshot: mf.snapshot, sourceMessage: mf.sourceMessage, nowIso, expectedAction: mf.plannedAction });
    if (!recheck.safe) { skipped++; continue; }
    // Fresh duplicate-mapping check: an injected lookup by post_id must return exactly
    // one record matching the expected id + project. A duplicate that appeared since
    // plan (or the record going missing, or a re-key) fails closed.
    if (lookup) {
      let byPost;
      try { byPost = await lookup(mf.expectedPostId, mf.expectedProjectId); }
      catch (e) { skipped++; continue; }
      const arr = Array.isArray(byPost) ? byPost : ((byPost && byPost.items) || []);
      if (arr.length !== 1) { skipped++; continue; }
      const m = arr[0];
      if (!m || m.id !== mf.id || m.post_id !== mf.expectedPostId || m.project_id !== mf.expectedProjectId) { skipped++; continue; }
    }
    try { await update(mf.id, recheck.patch); filled++; }
    catch (e) { skipped++; }
  }
  return { filled, skipped };
}