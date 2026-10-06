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

// Relocate all linked records from fromJobId to toJobId. Returns counts per
// entity type. Uses updateMany in a loop (500-record batches).
export async function relocateLinks(base44, fromJobId, toJobId) {
  const counts = { fee_lines: 0, field_reports: 0, calendar_events: 0, job_notes: 0, contact_job_links: 0, job_budgets: 0, probuild_project_links: 0 };

  // FeeLines
  for (;;) {
    const res = await base44.asServiceRole.entities.FeeLines.updateMany(
      { job_id: fromJobId },
      { $set: { job_id: toJobId } }
    );
    counts.fee_lines += res.updated || 0;
    if (!res.has_more) break;
  }
  // FieldReports
  for (;;) {
    const res = await base44.asServiceRole.entities.FieldReports.updateMany(
      { job_id: fromJobId },
      { $set: { job_id: toJobId } }
    );
    counts.field_reports += res.updated || 0;
    if (!res.has_more) break;
  }
  // CalendarEvents
  for (;;) {
    const res = await base44.asServiceRole.entities.CalendarEvents.updateMany(
      { job_id: fromJobId },
      { $set: { job_id: toJobId } }
    );
    counts.calendar_events += res.updated || 0;
    if (!res.has_more) break;
  }
  // JobNotes
  for (;;) {
    const res = await base44.asServiceRole.entities.JobNotes.updateMany(
      { job_id: fromJobId },
      { $set: { job_id: toJobId } }
    );
    counts.job_notes += res.updated || 0;
    if (!res.has_more) break;
  }
  // ContactJobLink (optional — may not exist on all apps)
  try {
    for (;;) {
      const res = await base44.asServiceRole.entities.ContactJobLink.updateMany(
        { job_id: fromJobId },
        { $set: { job_id: toJobId } }
      );
      counts.contact_job_links += res.updated || 0;
      if (!res.has_more) break;
    }
  } catch (_) {
    // ContactJobLink entity may not be present; non-fatal.
  }
  // JobBudgets (optional — admin-only procurement budgets keyed by job_id)
  try {
    for (;;) {
      const res = await base44.asServiceRole.entities.JobBudgets.updateMany(
        { job_id: fromJobId },
        { $set: { job_id: toJobId } }
      );
      counts.job_budgets += res.updated || 0;
      if (!res.has_more) break;
    }
  } catch (_) {
    // JobBudgets entity may not be present; non-fatal.
  }
  // ProbuildProjectLink (optional — owner-confirmed project → job links)
  try {
    for (;;) {
      const res = await base44.asServiceRole.entities.ProbuildProjectLink.updateMany(
        { job_id: fromJobId },
        { $set: { job_id: toJobId } }
      );
      counts.probuild_project_links += res.updated || 0;
      if (!res.has_more) break;
    }
  } catch (_) {
    // ProbuildProjectLink entity may not be present; non-fatal.
  }

  return counts;
}