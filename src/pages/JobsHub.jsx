import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { C, addedTimestamp } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import JobBrowserRow, { DuplicateTags } from "@/components/jobs/JobBrowserRow";
import JobWorkspacePanel from "@/components/jobs/JobWorkspacePanel";
import ProbuildReports from "@/pages/ProbuildReports";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { buildJobsOverview } from "@/lib/jobsOverview";
import AddJobDialog from "@/components/jobs/AddJobDialog";
import { jobMatchesSearch } from "@/lib/jobSearch";

export default function JobsHub() {
  const [jobs, setJobs] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [calEvents, setCalEvents] = useState(null);
  const [jobNotes, setJobNotes] = useState(null);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const [owner, setOwner] = useState(false);
  const [view, setView] = useState("jobs");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const load = async () => {
      try {
        // Calendar events and notes are report evidence for "Needs report"; if they
        // can't load, statuses fall back to fee lines alone and a notice says so.
        const [jb, fl, ev, nt] = await Promise.all([
          fetchAllPages(base44.entities.Jobs, '-created_date', 1000),
          fetchAllPages(base44.entities.FeeLines, '-created_date', 1000),
          fetchAllPages(base44.entities.CalendarEvents, '-event_date', 1000).catch(() => null),
          fetchAllPages(base44.entities.JobNotes, '-note_date', 1000).catch(() => null),
        ]);
        setJobs(jb);
        setFeeLines(fl);
        setCalEvents(ev);
        setJobNotes(nt);
      } catch (e) {
        setLoadError("Jobs could not load. Reload to try again. " + (e?.message || ""));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    base44.auth.me().then((u) => setOwner(isAgentCenterOwner(u))).catch(() => setOwner(false));
    if (searchParams.get("report") || searchParams.get("project") || searchParams.get("conversation")) setView("reports");
  }, []);

  const switchView = (k) => {
    setView(k);
    if (k === "jobs") {
      const p = new URLSearchParams(searchParams);
      p.delete("report");
      p.delete("project");
      p.delete("conversation");
      setSearchParams(p, { replace: true });
    }
  };

  useEffect(() => { setVisibleCount(40); }, [search, segment]);

  // Duplicate records (same customer + address) are shown as one job; weaker
  // matches stay separate and are flagged for review. Read-only, see jobDedupe.js.
  // Calendar events and notes supply field-report evidence for "Needs report".
  const { groups, groupByJobId, evidenceAvailable, stats: jobStats, counts } = useMemo(
    () => buildJobsOverview({ jobs, feeLines, events: calEvents, notes: jobNotes }),
    [jobs, feeLines, calEvents, jobNotes]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (j) => jobMatchesSearch(j, q);
    let base = !q ? groups : groups.filter((g) => g.members.some(matches));
    const key = (g) => jobStats[g.id]?.status.key;
    if (segment === "active") base = base.filter(g => ["active", "needs_report", "needs_review"].includes(key(g)));
    if (segment === "complete") base = base.filter(g => key(g) === "complete");
    if (segment === "needs_report") base = base.filter(g => key(g) === "needs_report");
    if (segment === "needs_review") base = base.filter(g => key(g) === "needs_review");
    if (segment === "duplicates") base = base.filter(g => g.review.length > 0);
    // Newest record in the group first, so a freshly added duplicate stays near the top.
    const newest = (g) => g.members.reduce((d, m) => ((m.created_date || "") > d ? m.created_date : d), "");
    return [...base].sort((a, b) => newest(b).localeCompare(newest(a)));
  }, [groups, search, segment, jobStats]);

  // Auto-select the first visible job for the desktop workspace.
  useEffect(() => {
    if (!filtered.length) { setSelectedJobId(null); return; }
    if (!selectedJobId || !filtered.some(g => g.id === selectedJobId)) {
      setSelectedJobId(filtered[0].id);
    }
  }, [filtered]);

  const pills = [
    { key: "all", label: "All", count: groups.length },
    // The Active view also lists jobs that need a report or a match review, so its count includes them.
    { key: "active", label: "Active", count: counts.active + counts.needs_report + counts.needs_review },
    { key: "complete", label: "Complete", count: counts.complete },
    { key: "needs_report", label: "Needs report", count: counts.needs_report },
    ...(counts.needs_review ? [{ key: "needs_review", label: "Needs review", count: counts.needs_review }] : []),
    ...(counts.duplicates ? [{ key: "duplicates", label: "Possible duplicates", count: counts.duplicates }] : []),
  ];
  const selectedGroup = selectedJobId ? groupByJobId.get(selectedJobId) || null : null;
  const handleJobCreated = (job) => {
    setJobs((current) => [job, ...current]);
    setSearch("");
    setSegment("all");
    setSelectedJobId(job.id);
  };

  const renderToggle = (onDark) => (
    <div className="inline-flex items-center gap-1 p-1 rounded-full" style={{ backgroundColor: onDark ? "rgba(255,255,255,.06)" : C.cardAlt, border: `1px solid ${onDark ? "rgba(255,255,255,.1)" : C.border}` }}>
      {[["jobs", "Jobs"], ["reports", "Field reports"]].map(([k, label]) => (
        <button key={k} onClick={() => switchView(k)} className="px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors"
          style={view === k
            ? (onDark ? { backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)" } : { backgroundColor: C.accent, color: "#fff" })
            : (onDark ? { color: "var(--gf-sidebar-text)" } : { color: C.textSecondary })}>{label}</button>
      ))}
    </div>
  );

  if (view === "reports" && owner) {
    return (
      <div style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }}>
        <div className="px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="font-heading text-[30px] font-bold" style={{ color: C.text, letterSpacing: "-0.03em" }}>Field reports</h1>
            {renderToggle(false)}
          </div>
        </div>
        <ProbuildReports />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.accent }} />
      </div>
    );
  }

  const visibleJobs = filtered.slice(0, visibleCount);
  const emptyMessage = loadError ? "Jobs could not load."
    : search.trim() ? `No jobs match "${search}".`
    : segment !== "all" ? "No jobs in this view."
    : "No jobs yet.";

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }} className="flex flex-col">
      {/* Dark-green hero */}
      <header className="shrink-0 px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-5" style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-[30px] font-bold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Jobs</h1>
            <span className="font-mono-num text-[14px]" style={{ color: "var(--gf-sidebar-muted)" }} title={counts.records !== groups.length ? `${counts.records.toLocaleString()} records; duplicates with the same customer and address are shown once` : undefined}>({groups.length.toLocaleString()})</span>
          </div>
          <div className="flex items-center gap-2">
            {owner && renderToggle(true)}
            <AddJobDialog jobs={jobs} onCreated={handleJobCreated} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="relative flex-1 max-w-[560px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--gf-sidebar-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, alias, address, PO, OE or ID"
              className="w-full pl-10 pr-4 rounded-[10px] text-[13px] focus:outline-none transition-colors placeholder:text-[#8F999B]"
              style={{ height: "40px", border: "1px solid rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.06)", color: "var(--gf-sidebar-text-on)" }}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto obsidian-scroll" style={{ scrollbarWidth: "none" }}>
            {pills.map((p) => (
              <button
                key={p.key}
                onClick={() => setSegment(p.key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors"
                style={segment === p.key
                  ? { backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)" }
                  : { backgroundColor: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", color: "var(--gf-sidebar-text)" }}
              >
                {p.label}<span className="font-mono-num text-[11px]" style={{ opacity: 0.7 }}>{p.count}</span>
              </button>
            ))}
          </div>
        </div>
      </header>
      {loadError && <p role="alert" className="mx-[26px] max-[699px]:mx-[18px] mt-4 rounded-lg border bg-white p-3 text-[13px] text-red-700">{loadError}</p>}
      {!loadError && !evidenceAvailable && jobs.length > 0 && (
        <p role="note" className="mx-[26px] max-[699px]:mx-[18px] mt-4 rounded-lg p-3 text-[13px]" style={{ backgroundColor: C.amberLight, color: C.amber }}>
          Calendar report statuses could not load, so &quot;Needs report&quot; is based on billing lines only and may include visits whose report is already complete.
        </p>
      )}

      {/* Desktop split workspace — large desktop only */}
      <div className="hidden xl:flex flex-1 min-h-0 px-[26px] max-[699px]:px-[18px] pb-6 gap-5 items-stretch">
        <aside className="w-[340px] shrink-0 min-h-0 flex flex-col rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          <div className="shrink-0 px-3.5 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: C.headerText }}>{filtered.length} job{filtered.length === 1 ? "" : "s"}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll">
            {visibleJobs.map((g) => (
              <JobBrowserRow key={g.id} job={g.job} group={g} stats={jobStats[g.id]} selected={g.id === selectedJobId} onSelect={() => setSelectedJobId(g.id)} />
            ))}
            {!visibleJobs.length && (
              <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>{emptyMessage}</div>
            )}
            {filtered.length > visibleCount && (
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.border}` }}>
                <span className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>{visibleCount} of {filtered.length}</span>
                <button onClick={() => setVisibleCount(c => c + 40)} className="px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Load more</button>
              </div>
            )}
          </div>
        </aside>
        <section className="flex-1 min-h-0 flex flex-col rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          {selectedJobId ? <JobWorkspacePanel jobId={selectedJobId} group={selectedGroup} /> : (
            <div className="flex items-center justify-center h-full text-[13px]" style={{ color: C.textMuted }}>Select a job to view its activity.</div>
          )}
        </section>
      </div>

      {/* Mobile/tablet card list + detail navigation */}
      <div className="xl:hidden px-[18px] pt-4 pb-10">
        <div className="flex flex-col gap-2.5">
          {visibleJobs.map((g) => {
            const job = g.job;
            const stats = jobStats[g.id];
            return (
              <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-center gap-3 rounded-[14px] p-4 transition-colors hover:bg-[#F6F3EC]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: stats?.status.text || C.textFaint }} />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-bold break-words" style={{ color: C.text }}>{sanitizeText(job.canonical_name)}</div>
                  <div className="text-[12px] break-words mt-0.5" style={{ color: C.textMuted }}>{job.builder ? `${sanitizeText(job.builder)} · ` : ""}{sanitizeText(job.address || "")}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="inline-block text-[10px] font-semibold tracking-[0.01em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: stats?.status.bg, border: `1px solid ${stats?.status.border || C.border}`, color: stats?.status.text }}>{stats?.status.label}</span>
                    <DuplicateTags group={g} />
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-mono-num text-[12px] whitespace-nowrap" style={{ color: C.textSecondary }}>{addedTimestamp(job.created_date)}</div>
                </div>
              </Link>
            );
          })}
          {!visibleJobs.length && (
            <div className="py-10 text-center text-[13px] break-words" style={{ color: C.textMuted }}>{emptyMessage}</div>
          )}
          {filtered.length > visibleCount && (
            <div className="pt-2 text-center">
              <button onClick={() => setVisibleCount(c => c + 20)} className="px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Load more</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
