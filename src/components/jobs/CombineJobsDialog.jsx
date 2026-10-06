import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GitMerge, Search, X, AlertTriangle, ArrowRight, Undo2, Check } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { sanitizeText } from "@/lib/jobsSanitize";

// Combine two jobs into one using the existing soft-merge model (mergeJobs +
// JobMergeLog + reverseMerge). Admin-only. Nothing is deleted: the merged-away
// job stays recoverable, and a JobMergeLog row is written for undo.
//
// Flow: search the other job → side-by-side compare with a clear survivor →
// plain-worded confirm → combine. On done, the survivor's job page opens.

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

function daybreakWarning(a, b) {
  const da = daybreakTokens(a);
  const db = daybreakTokens(b);
  if (!da && !db) return null;
  if (da && !db) return "One job is in Daybreak and the other is not. Daybreak communities reuse lot numbers, so these may be different jobs.";
  if (!da && db) return "One job is in Daybreak and the other is not. Daybreak communities reuse lot numbers, so these may be different jobs.";
  // both daybreak — compare lot tokens
  const shared = [...da.lots].some((n) => db.lots.has(n));
  if (!shared) return "Both jobs mention Daybreak but different lot numbers. Daybreak communities reuse lot numbers across neighborhoods, so check carefully before combining.";
  return null;
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

function ScoreBar({ job, counts, survivor, onFlip }) {
  const total = COUNT_ENTITIES.reduce((s, { key }) => s + (counts[key] || 0), 0);
  const isSurv = survivor === job.id;
  return (
    <button
      type="button"
      onClick={onFlip}
      className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors"
      style={{
        backgroundColor: isSurv ? "#eaf5ee" : FIELD,
        border: `1px solid ${isSurv ? "#c7e4d2" : BORDER}`,
      }}
      aria-pressed={isSurv}
    >
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: isSurv ? "#166447" : "#cec6b8", color: "#fff" }}
      >
        {isSurv ? <Check className="h-3.5 w-3.5" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold" style={{ color: INK }}>{sanitizeText(job.canonical_name) || "Untitled"}</span>
        <span className="block truncate text-[12px]" style={{ color: MUTED }}>{[job.builder, job.address].filter(Boolean).map(sanitizeText).join(" · ") || "No builder or address"}</span>
        <span className="mt-1 block"><JobCounts counts={counts} /></span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em]" style={{ color: isSurv ? "#166447" : MUTED }}>{isSurv ? "Survives" : "Merged away"}</span>
        <span className="block text-[11px]" style={{ color: MUTED }}>{total} records</span>
      </span>
    </button>
  );
}

export default function CombineJobsDialog({ job, onClose, onDone }) {
  const navigate = useNavigate();
  const [step, setStep] = useState("search"); // search | compare | confirm | working | done
  const [candidates, setCandidates] = useState([]);
  const [counts, setCounts] = useState({}); // { [jobId]: { fees, notes, reports, events } }
  const [loadingList, setLoadingList] = useState(true);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null); // the other job
  const [survivorId, setSurvivorId] = useState(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const loadVersion = useRef(0);

  // Load candidate jobs + per-job counts once on open.
  useEffect(() => {
    const version = ++loadVersion.current;
    let active = true;
    setLoadingList(true);
    setError("");
    (async () => {
      try {
        const page = await base44.entities.Jobs.filter(
          { is_sample: { $ne: true }, merged_into: { $exists: false } },
          { sort: "-created_date", limit: 200, fields: ["id", "canonical_name", "address", "builder", "po_numbers", "created_date"] }
        );
        if (!active || version !== loadVersion.current) return;
        const list = (page.items || []).filter((j) => j.id !== job.id);
        setCandidates(list);

        // Counts for the current job + every candidate, via 4 aggregate-by-job_id passes.
        const ids = [job.id, ...list.map((j) => j.id)];
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
        for (const [key, m] of entries) {
          for (const id of ids) merged[id][key] = m[id] || 0;
        }
        setCounts(merged);
      } catch (e) {
        if (active) setError(e?.message || "Could not load jobs.");
      } finally {
        if (active) setLoadingList(false);
      }
    })();
    return () => { active = false; };
  }, [job.id]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((j) => {
      const hay = `${j.canonical_name || ""} ${j.address || ""} ${j.builder || ""} ${(j.po_numbers || []).join(" ")}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, candidates]);

  const openCompare = (other) => {
    setPicked(other);
    // Default survivor: the one with more real data. Tie → the current job stays.
    const a = counts[job.id] || {};
    const b = counts[other.id] || {};
    const ta = COUNT_ENTITIES.reduce((s, { key }) => s + (a[key] || 0), 0);
    const tb = COUNT_ENTITIES.reduce((s, { key }) => s + (b[key] || 0), 0);
    setSurvivorId(tb > ta ? other.id : job.id);
    setStep("compare");
  };

  const survivor = survivorId === job.id ? job : picked;
  const mergedAway = survivorId === job.id ? picked : job;
  const warn = picked ? daybreakWarning(job, picked) : null;

  const combine = async () => {
    setStep("working");
    setError("");
    try {
      const res = await base44.functions.invoke("mergeJobs", {
        source_job_id: mergedAway.id,
        target_job_id: survivor.id,
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
    if (survivor?.id && survivor.id !== job.id) navigate(`/jobs/${survivor.id}`);
    else window.location.reload();
  };

  const close = () => {
    if (step === "working") return;
    onClose?.();
  };

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
        className="w-full max-w-[640px] rounded-t-[16px] bg-white sm:rounded-[14px]"
        style={{ border: "1px solid #e2dcd1", boxShadow: "0 24px 60px -16px rgba(10,29,31,.5)", maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3" style={{ borderBottom: `1px solid ${HAIRLINE}` }}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "#eaf5ee", color: "#166447" }}>
            <GitMerge className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-[17px] font-bold" style={{ color: INK, letterSpacing: "-0.02em" }}>Combine jobs</h3>
            <p className="m-0 mt-0.5 text-[12.5px]" style={{ color: MUTED }}>
              {step === "search" && "Pick the other job this one is a duplicate of."}
              {step === "compare" && "One job, shared visit history. Duplicate job rows are tucked away, not the visits."}
              {step === "confirm" && "Last check before combining."}
              {step === "working" && "Combining…"}
              {step === "done" && "Done. The jobs are one record now."}
            </p>
          </div>
          <button type="button" onClick={close} disabled={step === "working"} aria-label="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05] disabled:opacity-50" style={{ color: MUTED }}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4" style={{ maxHeight: "calc(92vh - 130px)" }}>
          {error && (
            <p role="alert" className="mb-3 rounded-[8px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "#fcedec", color: "#a43432", border: "1px solid #f0c9c5" }}>{error}</p>
          )}

          {step === "search" && (
            <div>
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: MUTED }} />
                <input
                  autoFocus
                  aria-label="Search jobs"
                  placeholder="Search by name, address, builder or PO"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="h-[42px] w-full rounded-[10px] pl-9 pr-3 text-[14px] outline-none focus:ring-2"
                  style={{ backgroundColor: FIELD, border: `1px solid ${BORDER}`, color: INK, "--tw-ring-color": "rgba(11,63,59,.4)" }}
                />
              </div>
              {loadingList ? (
                <p className="py-6 text-center text-[13px]" style={{ color: MUTED }}>Loading jobs…</p>
              ) : filtered.length === 0 ? (
                <p className="py-6 text-center text-[13px]" style={{ color: MUTED }}>{query ? "No jobs match that search." : "No other jobs to combine with."}</p>
              ) : (
                <ul className="space-y-1.5">
                  {filtered.slice(0, 60).map((j) => (
                    <li key={j.id}>
                      <button
                        type="button"
                        onClick={() => openCompare(j)}
                        className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03]"
                        style={{ border: `1px solid ${BORDER}` }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold" style={{ color: INK }}>{sanitizeText(j.canonical_name) || "Untitled"}</span>
                          <span className="block truncate text-[12px]" style={{ color: MUTED }}>{[j.builder, j.address].filter(Boolean).map(sanitizeText).join(" · ") || "No builder or address"}</span>
                          {(j.po_numbers || []).length > 0 && (
                            <span className="mt-0.5 block font-mono text-[11.5px]" style={{ color: MUTED }}>PO {(j.po_numbers || []).join(", ")}</span>
                          )}
                        </span>
                        <span className="shrink-0"><JobCounts counts={counts[j.id] || {}} /></span>
                        <ArrowRight className="h-4 w-4 shrink-0" style={{ color: BRASS }} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {step === "compare" && picked && (
            <div className="space-y-3">
              {warn && (
                <div className="flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "#fff3df", color: "#89511a", border: "1px solid #f0dba8" }}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{warn}</span>
                </div>
              )}
              <p className="m-0 text-[13px]" style={{ color: MUTED }}>
                These are duplicate job rows for the same house, not duplicate visits. Tap the one record that stays. Each visit, field report, photo, note and visit PO/OE keeps its own date and re-links to the surviving job so its History shows them all. The other job row is tucked away (hidden from lists, not deleted).
              </p>
              <ScoreBar job={job} counts={counts[job.id] || {}} survivor={survivorId} onFlip={() => setSurvivorId(job.id)} />
              <ScoreBar job={picked} counts={counts[picked.id] || {}} survivor={survivorId} onFlip={() => setSurvivorId(picked.id)} />
              <div className="rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: FIELD, border: `1px solid ${BORDER}`, color: MUTED }}>
                <b style={{ color: INK }}>{sanitizeText(survivor.canonical_name)}</b> stays as the one job record. <b style={{ color: INK }}>{sanitizeText(mergedAway.canonical_name)}</b> is tucked away (hidden from lists, not deleted). Its visits, reports, photos, notes and ticket refs re-link to the survivor. You can undo this from the tucked-away record.
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStep("search")} className="inline-flex h-[40px] items-center rounded-[10px] px-4 text-[13.5px] font-semibold" style={{ backgroundColor: FIELD, color: INK, border: `1px solid ${BORDER}` }}>Back</button>
                <button type="button" onClick={() => setStep("confirm")} className="inline-flex h-[40px] items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-semibold text-white" style={{ backgroundColor: TEAL }}>
                  <GitMerge className="h-4 w-4" />Continue
                </button>
              </div>
            </div>
          )}

          {step === "confirm" && picked && (
            <div className="space-y-3">
              <div className="rounded-[10px] px-3 py-3 text-[13.5px] leading-[20px]" style={{ backgroundColor: FIELD, border: `1px solid ${BORDER}`, color: INK }}>
                <p className="m-0"><b>{sanitizeText(mergedAway.canonical_name)}</b> is tucked away and its visits, reports, photos, notes and ticket refs re-link to <b>{sanitizeText(survivor.canonical_name)}</b>.</p>
                <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[12.5px]" style={{ color: MUTED }}>
                  <li>Each calendar visit re-links to the surviving job and stays its own dated visit — visits are not merged into one. Field reports and their photos, notes and their attachments, invoice lines, contact links, job budgets and Probuild project links re-link to it too.</li>
                  <li>Visit PO/OE ticket refs move with each visit.</li>
                  <li>Install budgets, setup sheets, service items and job knowledge do NOT re-link — they stay on the tucked-away record and resolve through it.</li>
                  <li>The tucked-away record's Drive job-folder link is not adopted (the survivor keeps its own; a different folder is recorded in a note).</li>
                  <li>PO numbers and aliases are added to the survivor.</li>
                  <li>Where the two disagree, the survivor's value wins; the other value is saved in a note.</li>
                  <li>Invoice marks, fees and statuses are never changed.</li>
                  <li>Undo restores the tucked-away record and moves its re-linked visits, reports, photos, notes and lines back to it.</li>
                </ul>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setStep("compare")} disabled={step === "working"} className="inline-flex h-[40px] items-center rounded-[10px] px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ backgroundColor: FIELD, color: INK, border: `1px solid ${BORDER}` }}>Back</button>
                <button type="button" onClick={combine} className="inline-flex h-[40px] items-center gap-1.5 rounded-[10px] px-4 text-[13.5px] font-semibold text-white" style={{ backgroundColor: TEAL }}>
                  <GitMerge className="h-4 w-4" />Combine
                </button>
              </div>
            </div>
          )}

          {step === "working" && (
            <div className="flex items-center justify-center gap-2.5 py-10 text-[14px]" style={{ color: MUTED }}>
              <span className="h-5 w-5 rounded-full border-2 animate-spin" style={{ borderColor: HAIRLINE, borderTopColor: TEAL }} />
              Combining the two jobs…
            </div>
          )}

          {step === "done" && result && (
            <div className="space-y-3">
              <div className="rounded-[10px] px-3 py-3 text-[13.5px]" style={{ backgroundColor: "#eaf5ee", border: "1px solid #c7e4d2", color: "#166447" }}>
                <p className="m-0 font-semibold">{sanitizeText(survivor.canonical_name)} now holds everything from {sanitizeText(mergedAway.canonical_name)}.</p>
                <p className="m-0 mt-1 text-[12.5px]" style={{ color: "#3b5a3a" }}>
                  Moved: {result.relocated_link_counts?.fee_lines || 0} invoice lines, {result.relocated_link_counts?.calendar_events || 0} visits, {result.relocated_link_counts?.field_reports || 0} reports, {result.relocated_link_counts?.job_notes || 0} notes, {result.relocated_link_counts?.job_budgets || 0} budgets.
                  {result.conflict_note_recorded ? " A note was added for any field that disagreed." : ""}
                </p>
              </div>
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