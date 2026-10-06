import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitMerge, X, AlertTriangle, Check, AlertCircle } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { sanitizeText } from "@/lib/jobsSanitize";
import { movedSummary } from "@/lib/mergeLogs";

// N-job combine review + confirm. Reuses the existing soft-merge model via the
// combineJobs backend function (one JobMergeLog row per merged-away record, so
// each can be undone individually). Admin-only by construction (the entry
// button is admin-gated on the Jobs list). Nothing is written until the final
// "Combine" press; after any attempt the submit button is disabled so the same
// set can't be combined twice.

const INK = "#101617", MUTED = "#616a6d", TEAL = "#0b3f3b", BRASS = "#b8955a";
const CARD = "#ffffff", FIELD = "#f4f1ea", BORDER = "#e2dcd1", HAIRLINE = "#eee9e0";

const COUNT_ENTITIES = [
  { key: "fees", label: "Invoice lines", entity: "FeeLines" },
  { key: "notes", label: "Notes", entity: "JobNotes" },
  { key: "reports", label: "Field reports", entity: "FieldReports" },
  { key: "events", label: "Calendar visits", entity: "CalendarEvents" },
];

function daybreakTokens(job) {
  const s = `${job?.canonical_name || ""} ${job?.address || ""}`.toLowerCase();
  if (!s.includes("daybreak")) return null;
  const nums = new Set();
  const re = /\d{2,5}/g;
  let m;
  while ((m = re.exec(s))) nums.add(m[0]);
  return { lots: nums };
}

// Aggregate Daybreak/lot warnings across ALL selected jobs: flag if any job is
// in Daybreak and any other is not, and if two Daybreak jobs share no lot token.
function daybreakWarnings(jobs) {
  const tagged = jobs.map((j) => ({ job: j, d: daybreakTokens(j) }));
  const inDb = tagged.filter((t) => t.d);
  const out = tagged.filter((t) => !t.d);
  const warns = [];
  if (inDb.length && out.length) {
    warns.push("Some selected jobs are in Daybreak and others are not. Daybreak communities reuse lot numbers, so these may be different jobs.");
  }
  if (inDb.length >= 2) {
    // any pair of Daybreak jobs with no shared lot token
    for (let i = 0; i < inDb.length; i++) {
      for (let k = i + 1; k < inDb.length; k++) {
        const shared = [...inDb[i].d.lots].some((n) => inDb[k].d.lots.has(n));
        if (!shared) {
          warns.push(`${sanitizeText(inDb[i].job.canonical_name)} and ${sanitizeText(inDb[k].job.canonical_name)} both mention Daybreak but different lot numbers. Check carefully before combining.`);
        }
      }
    }
  }
  return warns;
}

function JobCounts({ counts }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px]" style={{ color: MUTED }}>
      {COUNT_ENTITIES.map(({ key, label }) => (
        <span key={key} title={label}>
          <b style={{ color: INK }}>{counts[key] || 0}</b> {label.toLowerCase().replace(/s$/, "")}{(counts[key] || 0) === 1 ? "" : "s"}
        </span>
      ))}
    </div>
  );
}

// Real history = visits + reports + notes + invoice lines (the already-loaded
// counts). This is the primary survivor signal — NOT PO count.
function realHistoryCount(c) {
  return ((c?.events || 0) + (c?.reports || 0) + (c?.notes || 0) + (c?.fees || 0));
}

// Existing data richness from the loaded job record (identity + folder + stage).
// A tiebreaker only, never the primary signal.
function dataRichness(job) {
  return (job?.po_numbers?.length || 0)
    + (job?.oe_numbers?.length || 0)
    + (job?.aliases?.length || 0)
    + (job?.address ? 1 : 0)
    + (job?.builder ? 1 : 0)
    + (job?.drive_job_folder_id ? 1 : 0)
    + (job?.stage ? 1 : 0)
    + (job?.customer_name ? 1 : 0)
    + (job?.source_window_quote_id ? 1 : 0);
}

// Rank jobs to pick the survivor. Tier 1 real history (desc) → tier 2 attached
// history photo count, only when photos were actually fetched (desc) → tier 3
// data richness (desc) → tier 4 stable id (asc). Returns { ranked, top, tied }
// where tied is true when the top two share the same real-history count.
function rankSurvivor(jobs, counts, photos, photosAvailable) {
  const scored = jobs.map((j) => {
    const c = counts[j.id] || {};
    return {
      job: j,
      rh: realHistoryCount(c),
      ph: photosAvailable ? (photos[j.id] || 0) : 0,
      dr: dataRichness(j),
      id: j.id,
    };
  });
  scored.sort((a, b) =>
    b.rh - a.rh ||
    b.ph - a.ph ||
    b.dr - a.dr ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const tied = scored.length >= 2 && scored[0].rh === scored[1].rh;
  return { ranked: scored, top: scored[0] || null, tied };
}

function JobRow({ job, counts, isSurvivor, anySurvivor, onPick, disabled }) {
  const total = COUNT_ENTITIES.reduce((s, { key }) => s + ((counts && counts[key]) || 0), 0);
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={disabled}
      aria-pressed={isSurvivor}
      className="flex w-full items-start gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors disabled:opacity-60"
      style={{
        backgroundColor: isSurvivor ? "#eaf5ee" : FIELD,
        border: `1px solid ${isSurvivor ? "#c7e4d2" : BORDER}`,
      }}
    >
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: isSurvivor ? "#166447" : "#cec6b8", color: "#fff" }}
      >
        {isSurvivor ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold" style={{ color: INK }}>{sanitizeText(job.canonical_name) || "Untitled"}</span>
        <span className="block truncate text-[12px]" style={{ color: MUTED }}>{[job.builder, job.address].filter(Boolean).map(sanitizeText).join(" · ") || "No builder or address"}</span>
        {(job.po_numbers && job.po_numbers.length > 0) && (
          <span className="mt-0.5 block font-mono text-[11.5px]" style={{ color: MUTED }}>PO {job.po_numbers.join(", ")}</span>
        )}
        <span className="mt-0.5 block font-mono text-[10.5px]" style={{ color: "#8a8f93" }}>ID {job.id}</span>
        <span className="mt-1 block"><JobCounts counts={counts || {}} /></span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: isSurvivor ? "#166447" : MUTED }}>{isSurvivor ? "Survives" : anySurvivor ? "Merged away" : "Choose"}</span>
        <span className="block text-[11px]" style={{ color: MUTED }}>{total} records</span>
      </span>
    </button>
  );
}

export default function CombineJobsReview({ jobIds, onClose, onDone }) {
  const navigate = useNavigate();
  const [step, setStep] = useState("review"); // review | confirm | working | done
  const [jobs, setJobs] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [survivorId, setSurvivorId] = useState(null); // not precommitted
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const loadVersion = useRef(0);
  const userPicked = useRef(false);
  const [winnerInfo, setWinnerInfo] = useState(null);

  const pickSurvivor = (id) => {
    userPicked.current = true;
    setSurvivorId(id);
  };

  // Load all selected jobs (fresh, by id) + per-job counts.
  useEffect(() => {
    const version = ++loadVersion.current;
    let active = true;
    setLoading(true);
    setError("");
    userPicked.current = false;
    setSurvivorId(null);
    setWinnerInfo(null);
    (async () => {
      try {
        const fetched = await Promise.all(
          jobIds.map((id) => base44.entities.Jobs.get(id).catch(() => null))
        );
        if (!active || version !== loadVersion.current) return;
        const ok = fetched.filter(Boolean);
        // Drop any that are already merged or sample — they can't be combined.
        const eligible = ok.filter((j) => !j.merged_into && !j.is_sample);
        if (eligible.length < 2) {
          setJobs(eligible);
          setError(eligible.length === 0 ? "None of the selected jobs can be combined (already merged or sample)." : "Only one eligible job remains; pick at least two.");
          setLoading(false);
          return;
        }
        setJobs(eligible);
        const ids = eligible.map((j) => j.id);
        const byJob = { job_id: { $in: ids } };
        const entries = await Promise.all(
          COUNT_ENTITIES.map(async ({ key, entity }) => {
            try {
              const r = await base44.entities[entity].aggregate({ query: byJob, groupBy: "job_id" });
              const m = {};
              for (const row of r.rows || []) m[row.job_id] = row.count || 0;
              return [key, m];
            } catch (e) {
              return [key, {}];
            }
          })
        );
        if (!active || version !== loadVersion.current) return;
        const merged = {};
        for (const id of ids) merged[id] = {};
        for (const [key, m] of entries) for (const id of ids) merged[id][key] = m[id] || 0;
        setCounts(merged);

        // Attempt a scoped photo count (FieldReports.photo_urls — the main
        // jobsite photo source in History). Bounded by the reports already
        // counted, fields-only, single page. If it fails, photos are not
        // counted and the ranking skips the photo tier honestly.
        let photos = {};
        let photosAvailable = false;
        try {
          const fr = await base44.entities.FieldReports.filter(
            { job_id: { $in: ids } },
            { fields: ["job_id", "photo_urls"], limit: 500 }
          );
          const frItems = fr.items || fr;
          for (const r of frItems) {
            const n = Array.isArray(r.photo_urls) ? r.photo_urls.length : 0;
            if (r.job_id && n) photos[r.job_id] = (photos[r.job_id] || 0) + n;
          }
          photosAvailable = true;
        } catch (e) {
          photosAvailable = false;
        }
        if (!active || version !== loadVersion.current) return;

        // Auto-pick the survivor with the most real history. The user can
        // still tap another job to override; userPicked guards that.
        const { top, tied } = rankSurvivor(eligible, merged, photos, photosAvailable);
        if (!userPicked.current && top) setSurvivorId(top.job.id);
        setWinnerInfo({ top, tied, photosAvailable, photos });
      } catch (e) {
        if (active) setError(e?.message || "Could not load the selected jobs.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [jobIds.join("|")]);

  const warnings = useMemo(() => (jobs.length >= 2 ? daybreakWarnings(jobs) : []), [jobs]);
  const survivor = jobs.find((j) => j.id === survivorId) || null;
  const mergedAway = survivor ? jobs.filter((j) => j.id !== survivorId) : [];

  const winnerBanner = useMemo(() => {
    if (!winnerInfo?.top) return null;
    const w = winnerInfo.top;
    const wc = counts[w.job.id] || {};
    const tieNote = winnerInfo.tied
      ? winnerInfo.photosAvailable
        ? `History is tied at ${w.rh}. ${sanitizeText(w.job.canonical_name)} wins on photos (${winnerInfo.photos[w.job.id] || 0}).`
        : `History is tied at ${w.rh}. ${sanitizeText(w.job.canonical_name)} wins on data richness.`
      : `${sanitizeText(w.job.canonical_name)} has the most history, so it stays.`;
    return { tieNote, wc, w };
  }, [winnerInfo, counts]);

  const combine = async () => {
    if (!survivor || mergedAway.length === 0) return;
    setStep("working");
    setError("");
    try {
      const res = await base44.functions.invoke("combineJobs", {
        job_ids: jobs.map((j) => j.id),
        survivor_job_id: survivor.id,
      });
      const r = res?.data;
      if (r?.error) throw new Error(r.error);
      setResult(r);
      setStep("done");
    } catch (e) {
      setError(e?.message || "Combine failed. Nothing was changed.");
      setStep("confirm");
    }
  };

  const finish = () => {
    onDone?.();
    onClose?.();
    if (survivor?.id) navigate(`/jobs/${survivor.id}`);
    else window.location.reload();
  };

  const close = () => {
    if (step === "working") return;
    onClose?.();
  };

  const canContinue = step === "review" && !!survivor && mergedAway.length >= 1 && !loading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ backgroundColor: "rgba(8,15,16,.6)" }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Combine jobs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[680px] rounded-t-[16px] bg-white sm:rounded-[14px]"
        style={{ border: "1px solid #e2dcd1", boxShadow: "0 24px 60px -16px rgba(10,29,31,.5)", maxHeight: "92vh" }}
      >
        <div className="flex items-center gap-3 px-5 pt-5 pb-3" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "#eaf5ee", color: "#166447" }}>
            <GitMerge className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-[17px] font-bold" style={{ color: INK, letterSpacing: "-0.02em" }}>Combine {jobs.length || jobIds.length} jobs</h3>
            <p className="m-0 mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
              {step === "review" && "One job, shared visit history. Duplicate job rows are tucked away, not the visits."}
              {step === "confirm" && "Last check before combining."}
              {step === "working" && "Combining…"}
              {step === "done" && "Done."}
            </p>
          </div>
          <button type="button" onClick={close} disabled={step === "working"} aria-label="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05] disabled:opacity-50" style={{ color: MUTED }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: "calc(92vh - 130px)" }}>
          {error && step !== "done" && (
            <p role="alert" className="mb-3 rounded-[8px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "#fcedec", color: "#a43432", border: "1px solid #f0c9c5" }}>{error}</p>
          )}

          {(step === "review" || step === "confirm") && (
            <div className="space-y-3">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "#fff3df", color: "#89511a", border: "1px solid #f0dba8" }}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}

              {loading ? (
                <p className="py-6 text-center text-[13px]" style={{ color: MUTED }}>Loading the selected jobs…</p>
              ) : jobs.length < 2 ? (
                <p className="py-6 text-center text-[13px]" style={{ color: MUTED }}>Need at least two eligible jobs to combine.</p>
              ) : (
                <>
                  <p className="m-0 text-[13px]" style={{ color: MUTED }}>
                    These are duplicate job rows for the same house, not duplicate visits. Tap the one record that stays. Each calendar visit, field report, photo, note and visit PO/OE keeps its own date and re-links to the surviving job so its History shows them all together. The other job rows are tucked away (hidden from lists, not deleted).
                  </p>
                  {winnerBanner && (
                    <div className="rounded-[10px] px-3 py-2.5 text-[12.5px] leading-[18px]" style={{ backgroundColor: "#eaf5ee", border: "1px solid #c7e4d2", color: "#166447" }}>
                      <span className="font-semibold">{winnerBanner.tieNote}</span>
                      <span style={{ color: "#3b5a3a" }}> {winnerBanner.w.rh} history: {winnerBanner.wc.events || 0} visits, {winnerBanner.wc.reports || 0} reports, {winnerBanner.wc.notes || 0} notes, {winnerBanner.wc.fees || 0} lines. Tap another record to override.</span>
                    </div>
                  )}
                  <div className="space-y-2">
                    {jobs.map((j) => (
                      <JobRow
                        key={j.id}
                        job={j}
                        counts={counts[j.id]}
                        isSurvivor={survivorId === j.id}
                        anySurvivor={!!survivorId}
                        onPick={() => pickSurvivor(j.id)}
                        disabled={step === "confirm"}
                      />
                    ))}
                  </div>
                </>
              )}

              {step === "confirm" && survivor && (
                <div className="rounded-[10px] px-3 py-3 text-[13.5px] leading-[20px]" style={{ backgroundColor: FIELD, border: `1px solid ${BORDER}`, color: INK }}>
                  <p className="m-0"><b>{sanitizeText(survivor.canonical_name)}</b> stays as the one job record. The visits, field reports, photos, notes and ticket refs from the other {mergedAway.length} {mergedAway.length === 1 ? "record" : "records"} re-link to it so its History shows them all:</p>
                  <p className="m-0 mt-1.5 font-mono text-[11.5px]" style={{ color: MUTED }}>{jobs.length} total · {mergedAway.length} {mergedAway.length === 1 ? "source" : "sources"} · survivor ID {survivor.id}</p>
                  <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[12.5px]" style={{ color: MUTED }}>
                    {mergedAway.map((j) => (
                      <li key={j.id}><b style={{ color: INK }}>{sanitizeText(j.canonical_name)}</b> <span className="font-mono text-[11px]" style={{ color: "#8a8f93" }}>ID {j.id}</span> is tucked away (hidden from lists, not deleted).</li>
                    ))}
                  </ul>
                  <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[12.5px]" style={{ color: MUTED }}>
                    <li>Each calendar visit re-links to the surviving job and stays its own dated visit — visits are not merged into one. Field reports and their photos, notes and their attachments, invoice lines, contact links, job budgets and Probuild project links re-link to it too.</li>
                    <li>Visit PO/OE ticket refs move with each visit.</li>
                    <li>A record that still has service items, setup sheets, job knowledge, orders, handoffs, to-dos or message threads is NOT combined — nothing moves and it stays visible, so that history is never hidden.</li>
                    <li>Drive folder files are not moved. The survivor keeps its own folder; a different folder stays linked in a note and under Combined records.</li>
                    <li>Anything linked to a record during the combine is moved too; if it can't be, that record stays visible.</li>
                    <li>PO numbers and aliases are added to the survivor.</li>
                    <li>Where they disagree, the survivor's value wins; the other value is saved in a note.</li>
                    <li>Invoice marks, fees and statuses are never changed.</li>
                    <li>Undo restores each tucked-away record and moves its re-linked visits, reports, photos, notes and lines back to it.</li>
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                {step === "review" && (
                  <>
                    <button type="button" onClick={close} className="inline-flex h-[40px] items-center rounded-[10px] px-4 text-[13.5px] font-semibold" style={{ backgroundColor: FIELD, color: INK, border: `1px solid ${BORDER}` }}>Cancel</button>
                    <button type="button" onClick={() => setStep("confirm")} disabled={!canContinue} className="inline-flex h-[40px] items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: TEAL }}>
                      <GitMerge className="h-4 w-4" />Continue
                    </button>
                  </>
                )}
                {step === "confirm" && (
                  <>
                    <button type="button" onClick={() => setStep("review")} className="inline-flex h-[40px] items-center rounded-[10px] px-4 text-[13.5px] font-semibold" style={{ backgroundColor: FIELD, color: INK, border: `1px solid ${BORDER}` }}>Back</button>
                    <button type="button" onClick={combine} className="inline-flex h-[40px] items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-semibold text-white" style={{ backgroundColor: TEAL }}>
                      <GitMerge className="h-4 w-4" />Combine {mergedAway.length + 1} jobs
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {step === "working" && (
            <div className="flex items-center justify-center gap-2.5 py-10 text-[14px]" style={{ color: MUTED }}>
              <span className="h-5 w-5 rounded-full border-2 animate-spin" style={{ borderColor: HAIRLINE, borderTopColor: TEAL }} />
              Combining {jobs.length} jobs…
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-3">
              {result.ok ? (
                <div className="rounded-[10px] px-3 py-3 text-[13.5px]" style={{ backgroundColor: "#eaf5ee", border: "1px solid #c7e4d2", color: "#166447" }}>
                  <p className="m-0 font-semibold">{sanitizeText(result.survivor_name)} now shows the combined history from {result.merged_count} {result.merged_count === 1 ? "record" : "records"}.</p>
                  <p className="m-0 mt-1 text-[12.5px]" style={{ color: "#3b5a3a" }}>
                    Moved: {movedSummary({ relocated_link_counts: result.totals })}.
                  </p>
                </div>
              ) : (
                <div className="rounded-[10px] px-3 py-3 text-[13.5px]" style={{ backgroundColor: "#fff3df", border: "1px solid #f0dba8", color: "#89511a" }}>
                  <p className="m-0 font-semibold flex items-center gap-2"><AlertCircle className="h-4 w-4" />Partial combine: {result.merged_count} fully merged, {result.failed_count} not fully merged.</p>
                  <p className="m-0 mt-1 text-[12.5px]" style={{ color: "#6f4e10" }}>Sources that partially moved were left visible (not hidden) and each wrote an undo log. Reverse a source's log to put its moved records back, or investigate on its job page.</p>
                </div>
              )}
              <ul className="m-0 space-y-1.5">
                {result.results?.map((r) => {
                  const isPartial = !r.ok && (r.partial || r.blocked);
                  const bg = r.ok ? "#f4f8f5" : isPartial ? "#fff3df" : "#fcedec";
                  const bd = r.ok ? "#d6e8de" : isPartial ? "#f0dba8" : "#f0c9c5";
                  const ic = r.ok ? "#166447" : isPartial ? "#89511a" : "#a43432";
                  return (
                    <li key={r.source_job_id} className="flex items-start gap-2 rounded-[8px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: bg, border: `1px solid ${bd}` }}>
                      <span className="mt-0.5 shrink-0">{r.ok ? <Check className="h-3.5 w-3.5" style={{ color: ic }} /> : <AlertCircle className="h-3.5 w-3.5" style={{ color: ic }} />}</span>
                      <span className="min-w-0 flex-1">
                        <b style={{ color: INK }}>{sanitizeText(r.source_job_name || r.source_job_id)}</b>
                        {r.ok ? (
                          <span style={{ color: MUTED }}> — moved {movedSummary(r)}{r.conflict_note_recorded ? " · a conflict note was added" : r.conflict_note_error ? ` · ${r.conflict_note_error}` : ""}.</span>
                        ) : r.blocked ? (
                          <span style={{ color: "#89511a" }}> — not combined, left visible. {r.error}</span>
                        ) : isPartial ? (
                          <span style={{ color: "#89511a" }}> — partially moved {r.relocated_link_counts?.fee_lines || 0} lines but was NOT hidden (some records failed to move). {[(r.relocate_errors || []).join("; "), r.fields_error, r.mark_error].filter(Boolean).join(" · ") || "See the undo log on this job."} Reverse its log to put the moved records back.</span>
                        ) : (
                          <span style={{ color: "#a43432" }}> — {r.error}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={finish} className="inline-flex h-[40px] items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-semibold text-white" style={{ backgroundColor: TEAL }}>
                  <Check className="h-4 w-4" />Open the survivor
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}