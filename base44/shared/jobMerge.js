// Shared job-merge logic used by mergeJobs and reverseMerge backend functions.
// Relocates all linked records (FeeLines, FieldReports, CalendarEvents,
// JobNotes, ContactJobLinks, JobBudgets, ProbuildProjectLinks) from a source
// job to a target job, and merges identity fields (po_numbers, oe_numbers,
// aliases) plus blank identity/document scalars onto the target.
//
// All entity writes use the service role so the merge succeeds regardless of
// the calling admin's RLS reach. The caller is responsible for auth checks.

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
// conflicts. Never includes stage, fee, billing or quote-snapshot fields — those
// are never moved by a combine (invoice marks, fees, statuses and manual
// adjustments must never change).
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

// Merge identity fields from source onto target. Returns:
//   patch          — update to apply to the target (arrays + blank scalar fills)
//   relocated      — snapshot of array values moved (for reversal)
//   conflict_note  — human-readable note recording any source scalar value that
//                    differed from a non-empty target value (never lost). Empty
//                    string when there was no conflict. The caller creates a
//                    JobNote on the target with this text.
export function mergeJobFields(source, target) {
  const po = unionArr(target.po_numbers, source.po_numbers);
  const oe = unionArr(target.oe_numbers, source.oe_numbers);
  const aliases = unionArr(target.aliases, source.aliases);
  const patch = {};
  if (po.length !== (target.po_numbers || []).length) patch.po_numbers = po;
  if (oe.length !== (target.oe_numbers || []).length) patch.oe_numbers = oe;
  if (aliases.length !== (target.aliases || []).length) patch.aliases = aliases;
  const relocated = {
    po_numbers: (source.po_numbers || []).filter((p) => !(target.po_numbers || []).some((tp) => tp.toLowerCase() === String(p).toLowerCase())),
    oe_numbers: (source.oe_numbers || []).filter((p) => !(target.oe_numbers || []).some((tp) => tp.toLowerCase() === String(p).toLowerCase())),
    aliases: (source.aliases || []).filter((p) => !(target.aliases || []).some((tp) => tp.toLowerCase() === String(p).toLowerCase())),
  };

  // Scalar fields: fill blanks on the target from the source; record conflicts.
  const conflicts = [];
  for (const f of SCALAR_FIELDS) {
    const sv = source[f] == null ? "" : String(source[f]).trim();
    const tv = target[f] == null ? "" : String(target[f]).trim();
    if (!sv) continue;
    if (!tv) {
      patch[f] = source[f];
      relocated[f] = source[f];
    } else if (sv !== tv && f !== "source_window_quote_id" && f !== "pm_member_key" && f !== "handoff_id") {
      // Different non-empty values: the survivor (target) keeps its value; the
      // source's value is recorded so it is never lost. Reference ids
      // (source_window_quote_id / pm_member_key / handoff_id) are not conflicts —
      // they are links, and a difference just means the survivor keeps its own.
      conflicts.push(`${f.replace(/_/g, " ")}: ${sv}`);
    }
  }
  const conflict_note = conflicts.length
    ? `Combined from "${source.canonical_name || source.id}". The surviving record kept its own value for these fields; the other record's values were:\n${conflicts.join("\n")}`
    : "";

  return { patch, relocated, conflict_note };
}

// Entity entries processed during a relocation. required = true means a write
// failure is a hard partial failure; optional entities may not exist on every
// app, but their errors are still surfaced so the caller can mark partial.
export const LINK_ENTITIES = [
  { key: "fee_lines", entity: "FeeLines", required: true },
  { key: "field_reports", entity: "FieldReports", required: true },
  { key: "calendar_events", entity: "CalendarEvents", required: true },
  { key: "job_notes", entity: "JobNotes", required: true },
  { key: "contact_job_links", entity: "ContactJobLink", required: false },
  { key: "job_budgets", entity: "JobBudgets", required: false },
  { key: "probuild_project_links", entity: "ProbuildProjectLink", required: false },
];

// Phase 1 of a safe relocation: list the exact ids of every record linked to
// fromJobId, WITHOUT mutating anything. The caller writes these planned ids into
// the audit log BEFORE any move, so provenance is durable even if a later step
// crashes. Returns { plan, errors } where plan is { <entityKey>: [...ids] } and
// errors lists any per-entity listing failures (non-empty => partial).
export async function planRelocateLinks(base44, fromJobId) {
  const plan = {};
  const errors = [];
  for (const { key, entity, required } of LINK_ENTITIES) {
    plan[key] = [];
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
      errors.push(`${entity}: could not list records (${e?.message || e})${required ? "" : " (optional entity)"}`);
    }
  }
  return { plan, errors };
}

// Phase 2: move exactly the planned ids from fromJobId to toJobId, guarded by
// each record's current job_id so only records still on the source move. Returns
// { moved, counts, errors } where moved is the per-entity array of ids that
// successfully moved (a subset of plan). A batch failure is reported in errors;
// ids from batches that succeeded are still returned so the caller can update
// the audit log with exactly what moved.
export async function executeRelocateLinks(base44, plan, fromJobId, toJobId) {
  const moved = {};
  const counts = {};
  const errors = [];
  for (const { key, entity } of LINK_ENTITIES) {
    moved[key] = [];
    counts[key] = 0;
    const ids = plan[key] || [];
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      try {
        const res = await base44.asServiceRole.entities[entity].updateMany(
          { id: { $in: batch }, job_id: fromJobId },
          { $set: { job_id: toJobId } }
        );
        counts[key] += res.updated || 0;
        moved[key].push(...batch);
      } catch (e) {
        errors.push(`${entity}: moved ${moved[key].length} of ${ids.length} before failure (${e?.message || e})`);
      }
    }
  }
  return { moved, counts, errors };
}

// Move a specific set of record ids back to a job, guarded by their current
// job_id, so only records still on the expected job are moved. Used by
// reverseMerge to undo exactly the ids a merge logged — never a blind relocate
// of everything currently on the survivor.
export async function relocateLinksByIds(base44, idsByEntity, fromJobId, toJobId) {
  const counts = {};
  const errors = [];
  for (const { key, entity } of LINK_ENTITIES) {
    counts[key] = 0;
    const entityIds = idsByEntity[key] || [];
    for (let i = 0; i < entityIds.length; i += 500) {
      const batch = entityIds.slice(i, i + 500);
      try {
        const res = await base44.asServiceRole.entities[entity].updateMany(
          { id: { $in: batch }, job_id: fromJobId },
          { $set: { job_id: toJobId } }
        );
        counts[key] += res.updated || 0;
      } catch (e) {
        errors.push(`${entity}: ${e?.message || e}`);
      }
    }
  }
  return { counts, errors };
}