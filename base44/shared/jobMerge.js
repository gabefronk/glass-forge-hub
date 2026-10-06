// Shared job-merge logic: the ONE soft-merge model used by mergeJobs (pairwise),
// combineJobs (N jobs, one source at a time) and reverseMerge (undo).
//
// Supported links (LINK_ENTITIES) are moved by exact record id, guarded by the
// record's current job_id, and every moved id is verified and written to the
// JobMergeLog so an undo can move back exactly those ids — never a blind
// relocate of everything on the survivor.
//
// Job-linked entities the merge cannot move (UNSUPPORTED_LINK_ENTITIES) block a
// source: if the source still has any of them, nothing is moved and the source
// stays visible, so no history is hidden where the survivor cannot reach it.
//
// All entity writes use the service role. Callers do the auth checks.

const msg = (e) => e?.message || String(e);

// Union two arrays case-insensitively, preserving order of first appearance.
export function unionArr(a, b) {
  const seen = new Set();
  const out = [];
  for (const v of [...(a || []), ...(b || [])]) {
    const key = String(v || "").trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(key);
  }
  return out;
}

// Scalar identity/document fields considered when filling blanks and recording
// conflicts. Never includes stage, fee, billing or quote-snapshot fields.
const SCALAR_FIELDS = [
  "address",
  "builder",
  "customer_name",
  "drive_job_folder_id",
  "drive_job_folder_url",
  "source_window_quote_id",
  "pm_member_key",
  "handoff_id",
];
const LINK_ONLY_FIELDS = new Set(["source_window_quote_id", "pm_member_key", "handoff_id"]);
const DRIVE_FIELDS = new Set(["drive_job_folder_id", "drive_job_folder_url"]);

export function driveFolderUrl(job) {
  if (job?.drive_job_folder_url) return String(job.drive_job_folder_url);
  if (job?.drive_job_folder_id) return `https://drive.google.com/drive/folders/${job.drive_job_folder_id}`;
  return "";
}

// Merge identity fields from source onto target. Returns { patch, relocated,
// conflict_note }. A different Drive job folder on the source is NOT adopted and
// its files are NOT moved; the note keeps a link to it so it stays reachable.
export function mergeJobFields(source, target) {
  const po = unionArr(target.po_numbers, source.po_numbers);
  const oe = unionArr(target.oe_numbers, source.oe_numbers);
  const aliases = unionArr(target.aliases, source.aliases);
  const patch = {};
  if (po.length !== (target.po_numbers || []).length) patch.po_numbers = po;
  if (oe.length !== (target.oe_numbers || []).length) patch.oe_numbers = oe;
  if (aliases.length !== (target.aliases || []).length) patch.aliases = aliases;
  const notIn = (list, other) => (list || []).filter((p) => !(other || []).some((tp) => String(tp).toLowerCase() === String(p).toLowerCase()));
  const relocated = {
    po_numbers: notIn(source.po_numbers, target.po_numbers),
    oe_numbers: notIn(source.oe_numbers, target.oe_numbers),
    aliases: notIn(source.aliases, target.aliases),
  };

  const conflicts = [];
  const targetHasFolder = !!(target.drive_job_folder_id || target.drive_job_folder_url);
  for (const f of SCALAR_FIELDS) {
    const sv = source[f] == null ? "" : String(source[f]).trim();
    const tv = target[f] == null ? "" : String(target[f]).trim();
    if (!sv) continue;
    // Drive folder fields move as a pair: only fill when the target has no folder.
    if (DRIVE_FIELDS.has(f) && targetHasFolder) continue;
    if (!tv) {
      patch[f] = source[f];
      relocated[f] = source[f];
    } else if (sv !== tv && !LINK_ONLY_FIELDS.has(f)) {
      conflicts.push(`${f.replace(/_/g, " ")}: ${sv}`);
    }
  }
  const sourceFolder = driveFolderUrl(source);
  const differentFolder = targetHasFolder && sourceFolder
    && String(source.drive_job_folder_id || "") !== String(target.drive_job_folder_id || "")
    && sourceFolder !== driveFolderUrl(target);
  if (differentFolder) {
    conflicts.push(`Drive job folder of the combined record (its files were NOT moved into this job's folder; open it here): ${sourceFolder}`);
  }
  const conflict_note = conflicts.length
    ? `Combined from "${source.canonical_name || source.id}" (ID ${source.id}). The surviving record kept its own value for these fields; the other record's values were:\n${conflicts.join("\n")}`
    : "";

  return { patch, relocated, conflict_note };
}

// Linked records the merge moves by exact id (and undo moves back).
export const LINK_ENTITIES = [
  { key: "fee_lines", entity: "FeeLines" },
  { key: "field_reports", entity: "FieldReports" },
  { key: "calendar_events", entity: "CalendarEvents" },
  { key: "job_notes", entity: "JobNotes" },
  { key: "contact_job_links", entity: "ContactJobLink" },
  { key: "job_budgets", entity: "JobBudgets" },
  { key: "probuild_project_links", entity: "ProbuildProjectLink" },
];

// Job-linked records the merge does NOT move. Their history is only reachable
// from the record they point at, so a source holding any of them is never hidden.
export const UNSUPPORTED_LINK_ENTITIES = [
  "ServiceItems", "JobSetupSheets", "JobKnowledge", "JobHandoffs", "JobCostInputs",
  "PurchaseOrders", "VendorOrders", "TodoTask", "MessageConversation", "EmailRelay",
  "ProbuildReportDraft", "QuoteRequests", "WindowQuoteOnlineRequests", "FieldLibraryProject",
];

export function emptyIds() {
  const o = {};
  for (const { key } of LINK_ENTITIES) o[key] = [];
  return o;
}

export function unionIds(...sets) {
  const o = {};
  for (const { key } of LINK_ENTITIES) {
    const seen = new Set();
    for (const s of sets) for (const id of (s?.[key] || [])) if (id) seen.add(String(id));
    o[key] = [...seen];
  }
  return o;
}

export function hasAnyIds(s) {
  return LINK_ENTITIES.some(({ key }) => (s?.[key] || []).length > 0);
}

export function countIds(s) {
  const o = {};
  for (const { key } of LINK_ENTITIES) o[key] = (s?.[key] || []).length;
  return o;
}

const totalIds = (s) => Object.values(countIds(s)).reduce((a, b) => a + b, 0);

// List the exact ids of every supported record currently linked to jobId,
// without mutating anything. Returns { plan, errors }.
export async function planRelocateLinks(base44, fromJobId) {
  const plan = emptyIds();
  const errors = [];
  for (const { key, entity } of LINK_ENTITIES) {
    try {
      let cursor;
      for (;;) {
        const page = await base44.asServiceRole.entities[entity].filter(
          { job_id: fromJobId },
          { fields: ["id"], limit: 500, cursor }
        );
        plan[key].push(...(page.items || []).map((r) => r.id));
        if (!page.has_more) break;
        cursor = page.next_cursor;
      }
    } catch (e) {
      errors.push(`${entity}: could not list records (${msg(e)})`);
    }
  }
  return { plan, errors };
}

// Move exactly the given ids from fromJobId to toJobId, guarded by each record's
// current job_id, then VERIFY which ids are now on toJobId. moved holds only
// verified ids (if verification itself fails, the batch is recorded as moved so
// an undo still covers it — its job_id guard makes that safe — and an error is
// reported so the caller never treats the step as clean).
export async function executeRelocateLinks(base44, plan, fromJobId, toJobId) {
  const moved = emptyIds();
  const errors = [];
  for (const { key, entity } of LINK_ENTITIES) {
    const ids = plan?.[key] || [];
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      try {
        await base44.asServiceRole.entities[entity].updateMany(
          { id: { $in: batch }, job_id: fromJobId },
          { $set: { job_id: toJobId } }
        );
      } catch (e) {
        errors.push(`${entity}: move failed (${msg(e)})`);
      }
      // Verify even after a failure: a thrown call may still have applied writes.
      try {
        const page = await base44.asServiceRole.entities[entity].filter(
          { id: { $in: batch }, job_id: toJobId },
          { fields: ["id"], limit: 500 }
        );
        moved[key].push(...(page.items || []).map((r) => r.id));
      } catch (e) {
        moved[key].push(...batch);
        errors.push(`${entity}: could not verify moved records (${msg(e)})`);
      }
    }
  }
  return { moved, counts: countIds(moved), errors };
}

// Which of the given ids are still linked to jobId. Returns { ids, errors }.
export async function idsStillOn(base44, idsByEntity, jobId) {
  const ids = emptyIds();
  const errors = [];
  for (const { key, entity } of LINK_ENTITIES) {
    const list = idsByEntity?.[key] || [];
    for (let i = 0; i < list.length; i += 500) {
      try {
        const page = await base44.asServiceRole.entities[entity].filter(
          { id: { $in: list.slice(i, i + 500) }, job_id: jobId },
          { fields: ["id"], limit: 500 }
        );
        ids[key].push(...(page.items || []).map((r) => r.id));
      } catch (e) {
        errors.push(`${entity}: could not check (${msg(e)})`);
      }
    }
  }
  return { ids, errors };
}

// Unsupported job-linked records on jobId. blocked is true when any exist OR a
// check failed (unknown is treated as unsafe).
export async function findUnsupportedLinks(base44, jobId) {
  const found = {};
  const errors = [];
  for (const entity of UNSUPPORTED_LINK_ENTITIES) {
    try {
      const page = await base44.asServiceRole.entities[entity].filter({ job_id: jobId }, { fields: ["id"], limit: 50 });
      const ids = (page.items || []).map((r) => r.id);
      if (ids.length) found[entity] = { ids, more: !!page.has_more };
    } catch (e) {
      errors.push(`${entity}: could not check (${msg(e)})`);
    }
  }
  return { found, errors, blocked: errors.length > 0 || Object.keys(found).length > 0 };
}

export function describeUnsupported(u) {
  const parts = Object.entries(u?.found || {}).map(([entity, v]) => `${v.ids.length}${v.more ? "+" : ""} ${entity}`);
  const bits = [];
  if (parts.length) bits.push(`It still has records the combine cannot move (${parts.join(", ")}).`);
  if (u?.errors?.length) bits.push(`Some linked records could not be checked (${u.errors.join("; ")}).`);
  return bits.join(" ");
}

// Merge ONE source job into the target. Steps, each halting this source on
// failure with an honest result (ok:false) and the source left visible:
//   0. refuse if the source has unsupported links (nothing moved)
//   1. plan exact ids → 2. write audit log BEFORE any move
//   3. move + verify → 4. record verified ids
//   5. reconcile records added to the source meanwhile (log first, then move)
//   6. merge identity fields + conflict note
//   7. final check right before hiding: no supported or unsupported links left
//   8. hide the source (merged_into) → 9. final audit update
export async function mergeSourceIntoTarget(base44, { sourceId, targetId, actor, now = new Date().toISOString(), today }) {
  const db = base44.asServiceRole.entities;
  const base = { source_job_id: sourceId, ok: false, partial: false, hidden: false };
  if (!sourceId || !targetId) return { ...base, error: "source and survivor ids are required" };
  if (String(sourceId) === String(targetId)) return { ...base, error: "Cannot merge a job into itself" };

  let target, source;
  try { target = await db.Jobs.get(targetId); } catch (e) { return { ...base, error: "Could not load survivor: " + msg(e) }; }
  if (!target) return { ...base, error: "Survivor job not found" };
  if (target.merged_into) return { ...base, error: "Survivor is itself merged into " + target.merged_into };
  if (target.is_sample) return { ...base, error: "Cannot combine sample jobs" };
  try { source = await db.Jobs.get(sourceId); } catch (e) { return { ...base, error: "Could not load source: " + msg(e) }; }
  if (!source) return { ...base, error: "Source job not found" };
  if (source.merged_into) return { ...base, source_job_name: source.canonical_name, error: "Already merged into " + source.merged_into };
  if (source.is_sample) return { ...base, source_job_name: source.canonical_name, error: "Cannot combine sample jobs" };
  base.source_job_name = source.canonical_name;

  // 0. Unsupported links: block before anything moves.
  const pre = await findUnsupportedLinks(base44, sourceId);
  if (pre.blocked) {
    return { ...base, blocked: true, unsupported_links: pre.found, error: `${describeUnsupported(pre)} Nothing was moved and this record stays visible.` };
  }

  // 1. Plan.
  const first = await planRelocateLinks(base44, sourceId);
  if (first.errors.length) {
    return { ...base, error: `Could not list this record's links; nothing was moved. ${first.errors.join("; ")}` };
  }
  let planned = first.plan;

  // 2. Audit log before any move.
  let log;
  try {
    log = await db.JobMergeLog.create({
      source_job_id: sourceId,
      source_job_name: source.canonical_name,
      target_job_id: targetId,
      target_job_name: target.canonical_name,
      merged_by: actor,
      merged_at: now,
      planned_link_ids: planned,
      relocated_link_ids: emptyIds(),
      relocated_link_counts: countIds(null),
      relocated_fields: {},
      audit_version: 1,
      status: "planned",
      partial: true,
    });
  } catch (e) {
    return { ...base, error: "Could not create audit log before moving; aborted with zero moves: " + msg(e) };
  }
  const logId = log.id;
  let moved = emptyIds();
  let reconciled = emptyIds();
  const errors = [];

  const result = (extra = {}) => ({
    ...base,
    merge_log_id: logId,
    partial: hasAnyIds(moved) && !extra.ok,
    relocated_link_ids: moved,
    relocated_link_counts: countIds(moved),
    reconciled_link_ids: hasAnyIds(reconciled) ? reconciled : undefined,
    relocate_errors: errors.length ? [...errors] : undefined,
    ...extra,
  });
  // Best-effort final status for a halted source; the log already holds the ids.
  const halt = async (error, logPatch = {}) => {
    const status = hasAnyIds(moved) ? "partial" : "failed";
    let auditError = "";
    try {
      await db.JobMergeLog.update(logId, { status, partial: true, relocate_errors: [...errors, error], ...logPatch });
    } catch (e) {
      auditError = "Audit log could not record this failure: " + msg(e);
    }
    return result({ error: auditError ? `${error} ${auditError}` : error });
  };

  // 3-4. Move + verify, then record verified ids. If recording fails, stop.
  const moveAndRecord = async (ids) => {
    const exec = await executeRelocateLinks(base44, ids, sourceId, targetId);
    moved = unionIds(moved, exec.moved);
    errors.push(...exec.errors);
    try {
      await db.JobMergeLog.update(logId, {
        relocated_link_ids: moved,
        relocated_link_counts: countIds(moved),
        status: errors.length ? "relocated_partial" : "relocated",
      });
    } catch (e) {
      return { stop: `Moved records but could not update the audit log; stopped. Undo log ${logId} to recover (planned ids are recorded). ${msg(e)}`, noLog: true };
    }
    if (exec.errors.length) return { stop: "Some records could not be moved; this record was left visible." };
    return {};
  };

  let step;
  try { step = await moveAndRecord(planned); } catch (e) { return halt("Relocate threw: " + msg(e)); }
  if (step.noLog) return result({ error: step.stop });
  if (step.stop) return halt(step.stop);

  // 5. Reconcile: records linked to the source after the plan (ingest, a new
  //    note). Write them into the log first, then move them by exact id.
  for (let round = 0; round < 2; round++) {
    const again = await planRelocateLinks(base44, sourceId);
    if (again.errors.length) { errors.push(...again.errors); return halt("Could not re-check this record's links; it was left visible."); }
    if (!hasAnyIds(again.plan)) break;
    reconciled = unionIds(reconciled, again.plan);
    planned = unionIds(planned, again.plan);
    try {
      await db.JobMergeLog.update(logId, { planned_link_ids: planned, reconciled_link_ids: reconciled });
    } catch (e) {
      return halt(`New records appeared on this record during the combine and could not be logged, so they were not moved. ${msg(e)}`);
    }
    try { step = await moveAndRecord(again.plan); } catch (e) { return halt("Relocate threw: " + msg(e)); }
    if (step.noLog) return result({ error: step.stop });
    if (step.stop) return halt(step.stop);
  }

  // 6. Identity fields + conflict note.
  let patch = {}, relocated = {}, conflict_note = "";
  try {
    ({ patch, relocated, conflict_note } = mergeJobFields(source, target));
    if (Object.keys(patch).length) await db.Jobs.update(targetId, patch);
  } catch (e) {
    return halt("Could not merge identity fields; this record was left visible. " + msg(e), { fields_error: msg(e) });
  }
  let conflictNoteRecorded = false;
  if (conflict_note) {
    try {
      await db.JobNotes.create({
        job_id: targetId,
        note_date: today || new Date(now).toLocaleDateString("en-CA", { timeZone: "America/Denver" }),
        interaction_type: "note",
        body: conflict_note,
        author: actor || "Glass Forge Hub",
      });
      conflictNoteRecorded = true;
    } catch (e) {
      return halt("Could not save the conflict note, so the other record's values would only be on a hidden record; it was left visible. " + msg(e), { fields_error: msg(e) });
    }
  }

  // 7. Final check immediately before hiding.
  const last = await planRelocateLinks(base44, sourceId);
  const lastUnsupported = await findUnsupportedLinks(base44, sourceId);
  if (last.errors.length || hasAnyIds(last.plan) || lastUnsupported.blocked) {
    errors.push(...last.errors);
    const why = hasAnyIds(last.plan)
      ? `${totalIds(last.plan)} records were linked to this record during the combine and were not moved.`
      : lastUnsupported.blocked ? describeUnsupported(lastUnsupported) : "Its links could not be re-checked.";
    return halt(`${why} This record was left visible.`, { unsupported_links: lastUnsupported.found });
  }

  // 8. Hide the source.
  try {
    await db.Jobs.update(sourceId, { merged_into: targetId, merged_at: now });
  } catch (e) {
    return halt("Records moved but the record could not be hidden. " + msg(e), { mark_error: msg(e), relocated_fields: relocated });
  }

  // 9. Final audit update. The source IS hidden at this point: say so honestly.
  try {
    await db.JobMergeLog.update(logId, { relocated_fields: relocated, partial: false, status: "complete" });
  } catch (e) {
    return result({ hidden: true, error: `Combined and hidden, but the audit log could not be marked complete (its ids are recorded; undo still works). ${msg(e)}` });
  }
  return result({
    ok: true,
    hidden: true,
    relocated_fields: relocated,
    target_patch: patch,
    conflict_note_recorded: conflictNoteRecorded,
  });
}

// Undo one audited merge log. Moves back exactly the logged ids still on the
// survivor (the survivor's own records are never in the log), un-hides the
// source FIRST, and only marks the log reversed when nothing is left behind.
// Safe to run again after a failure: already-returned ids are no-ops.
export async function reverseMergeLog(base44, log, { actor, now = new Date().toISOString() } = {}) {
  const db = base44.asServiceRole.entities;
  if (!log) return { ok: false, status: 404, error: "Merge log not found" };
  if (log.reversed) return { ok: false, status: 400, error: "This merge was already reversed" };
  const audited = typeof log.audit_version === "number" && log.audit_version >= 1;
  if (!audited) {
    return { ok: false, status: 409, legacy: true, error: "This merge log predates exact-ID auditing and cannot be safely reversed automatically. Its moved records are not individually recorded, so a blind relocate would also move the survivor's own records." };
  }
  const sourceId = log.source_job_id, targetId = log.target_job_id;
  const base = { merge_log_id: log.id, source_job_id: sourceId, target_job_id: targetId };
  let source, target;
  try { [source, target] = await Promise.all([db.Jobs.get(sourceId), db.Jobs.get(targetId)]); }
  catch (e) { return { ...base, ok: false, status: 500, error: "Could not load the jobs: " + msg(e) }; }
  if (!source) return { ...base, ok: false, status: 404, error: "The combined-away record no longer exists" };
  if (source.merged_into && source.merged_into !== targetId) {
    return { ...base, ok: false, status: 409, error: `This record is now combined into a different job (${source.merged_into}). Undo that combine first.` };
  }
  if (target?.merged_into) {
    return { ...base, ok: false, status: 409, error: `The surviving job was itself combined into ${target.merged_into}. Undo that combine first.` };
  }

  // 1. Un-hide first so nothing ends up on a hidden record mid-undo.
  if (source.merged_into) {
    try { await db.Jobs.update(sourceId, { merged_into: null, merged_at: null }); }
    catch (e) { return { ...base, ok: false, status: 500, resumable: true, error: "Could not make the record visible again; nothing was moved back. " + msg(e) }; }
  }

  // 2. Move back exactly the logged ids still on the survivor, then verify.
  const ids = unionIds(log.relocated_link_ids, log.planned_link_ids, log.reconciled_link_ids);
  const back = await executeRelocateLinks(base44, ids, targetId, sourceId);
  const still = await idsStillOn(base44, ids, targetId);
  const errors = [...back.errors, ...still.errors];
  const left = totalIds(still.ids);
  if (errors.length || left > 0) {
    const reason = errors.length ? errors.join("; ") : `${left} recorded records are still on the surviving job`;
    let auditNote = "";
    try { await db.JobMergeLog.update(log.id, { reverse_status: "partial", reverse_errors: [reason], reverse_attempted_at: now }); }
    catch (e) { auditNote = " The undo attempt could not be logged: " + msg(e); }
    return {
      ...base, ok: false, status: 200, resumable: true,
      relocated_back_counts: countIds(back.moved), relocated_back_ids: back.moved, remaining_ids: still.ids,
      reverse_errors: errors.length ? errors : undefined,
      error: `Undo did not finish: ${reason}. The record is visible again; run Undo again to move the rest back.${auditNote}`,
    };
  }

  // 3. Mark reversed.
  try {
    await db.JobMergeLog.update(log.id, { reversed: true, reversed_at: now, reversed_by: actor, reverse_status: "complete", reverse_errors: [], reverse_attempted_at: now });
  } catch (e) {
    return { ...base, ok: false, status: 200, resumable: true, relocated_back_counts: countIds(back.moved), relocated_back_ids: back.moved, error: "Records moved back, but the log could not be marked reversed. Running Undo again is safe. " + msg(e) };
  }
  return { ...base, ok: true, status: 200, relocated_back_counts: countIds(back.moved), relocated_back_ids: back.moved };
}