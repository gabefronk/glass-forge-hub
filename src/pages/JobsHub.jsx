import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search, X, ArrowUpDown, Building2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import JobBrowserRow, { DuplicateTags, StatusChip, VisitInfo } from "@/components/jobs/JobBrowserRow";
import JobWorkspacePanel from "@/components/jobs/JobWorkspacePanel";
import ProbuildReports from "@/pages/ProbuildReports";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { buildJobsOverview, sortJobGroups, builderOptions, JOB_SORTS } from "@/lib/jobsOverview";
import AddJobDialog from "@/components/jobs/AddJobDialog";
import { jobMatchesSearch } from "@/lib/jobSearch";

export default function JobsHub() {
  const [jobs, setJobs] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [calEvents, setCalEvents] = useState(null);
  const [jobNotes, setJobNotes] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  // Search, view, sort and builder live in the URL so Back and shared links keep them.
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [segment, setSegment] = useState(() => searchParams.get("show") || "all");
  const [sort, setSort] = useState(() => (JOB_SORTS.some((o) => o.key === searchParams.get("sort")) ? searchParams.get("sort") : "recent"));
  const [builder, setBuilder] = useState(() => searchParams.get("builder") || "");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [visibleCount, setVisibleCount] = useState(40);
  const [owner, setOwner] = useState(false);
  const [view, setView] = useState("jobs");
  const [selectedJobId, setSelectedJobId] = useState(null);

  useEffect(() => {
    const p = new URLSearchParams(searchParams);
    const put = (k, v, dflt) => { if (v && v !== dflt) p.set(k, v); else p.delete(k); };
    put("q", search.trim(), "");
    put("show", segment, "all");
    put("sort", sort, "recent");
    put("builder", builder, "");
    if (p.toString() !== searchParams.toString()) setSearchParams(p, { replace: true });
  }, [search, segment, sort, builder]);

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

  useEffect(() => { setVisibleCount(40); }, [search, segment, sort, builder]);

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
    if (segment === "this_week") base = base.filter(g => jobStats[g.id]?.thisWeek);
    if (builder) base = base.filter(g => sanitizeText(String(g.job?.builder || "").trim()) === builder);
    return sortJobGroups(base, jobStats, sort);
  }, [groups, search, segment, jobStats, sort, builder]);

  const builders = useMemo(() => builderOptions(groups, sanitizeText), [groups]);
  const filtersActive = Boolean(search.trim() || segment !== "all" || builder);
  const clearFilters = () => { setSearch(""); setSegment("all"); setBuilder(""); };

  // Auto-select the first visible job for the desktop workspace.
  useEffect(() => {
    if (!filtered.length) { setSelectedJobId(null); return; }
    if (!selectedJobId || !filtered.some(g => g.id === selectedJobId)) {
      setSelectedJobId(filtered[0].id);
    }
  }, [filtered]);

  const pills = [
    { key: "all", label: "All", count: groups.length },
    { key: "this_week", label: "Visits this week", count: counts.this_week },
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
    clearFilters();
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
    : search.trim() ? `No jobs match "${search.trim()}".`
    : segment !== "all" || builder ? "No jobs match these filters."
    : "No jobs yet.";

  const darkField = { height: "40px", border: "1px solid rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.06)", color: "var(--gf-sidebar-text-on)" };
  const summary = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "job" : "jobs"}${builder ? ` · ${builder}` : ""}`;

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }} className="flex flex-col">
      {/* Graphite header: title, search, filters */}
      <header className="shrink-0 px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-5" style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <h1 className="font-heading text-[30px] font-bold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Jobs</h1>
            <span className="font-mono-num text-[14px]" style={{ color: "var(--gf-sidebar-muted)" }} title={counts.records !== groups.length ? `${counts.records.toLocaleString()} records; duplicates with the same customer and address are shown once` : undefined}>{groups.length.toLocaleString()} total</span>
          </div>
          <div className="flex items-center gap-2">
            {owner && renderToggle(true)}
            <AddJobDialog jobs={jobs} onCreated={handleJobCreated} />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px] max-w-[560px]">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none" style={{ color: "var(--gf-sidebar-muted)" }} />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, alias, address, PO, OE or ID"
                aria-label="Search jobs"
                className="w-full pl-10 pr-9 rounded-[10px] text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8955A] transition-colors placeholder:text-[#8F999B]"
                style={darkField}
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ color: "var(--gf-sidebar-muted)" }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <label className="relative inline-flex items-center">
              <span className="sr-only">Builder</span>
              <Building2 className="absolute left-3 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--gf-sidebar-muted)" }} />
              <select value={builder} onChange={(e) => setBuilder(e.target.value)} className="pl-8 pr-3 rounded-[10px] text-[13px] max-w-[220px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8955A]" style={darkField}>
                <option value="" style={{ color: "#101617" }}>All builders</option>
                {builders.map((b) => <option key={b.name} value={b.name} style={{ color: "#101617" }}>{b.name} ({b.count})</option>)}
              </select>
            </label>
            <label className="relative inline-flex items-center">
              <span className="sr-only">Sort</span>
              <ArrowUpDown className="absolute left-3 h-3.5 w-3.5 pointer-events-none" style={{ color: "var(--gf-sidebar-muted)" }} />
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="pl-8 pr-3 rounded-[10px] text-[13px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#B8955A]" style={darkField}>
                {JOB_SORTS.map((o) => <option key={o.key} value={o.key} style={{ color: "#101617" }}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto obsidian-scroll" style={{ scrollbarWidth: "none" }}>
            {pills.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setSegment(p.key)}
                aria-pressed={segment === p.key}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors"
                style={segment === p.key
                  ? { backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)" }
                  : { backgroundColor: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", color: "var(--gf-sidebar-text)" }}
              >
                {p.label}<span className="font-mono-num text-[11px]" style={{ opacity: 0.75 }}>{p.count}</span>
              </button>
            ))}
            {filtersActive && (
              <button type="button" onClick={clearFilters} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap shrink-0 underline-offset-2 hover:underline" style={{ color: "var(--gf-brass-300)" }}>
                <X className="h-3 w-3" />Clear filters
              </button>
            )}
          </div>
        </div>
      </header>
      {loadError && <p role="alert" className="mx-[26px] max-[699px]:mx-[18px] mt-4 rounded-lg border bg-white p-3 text-[13px] text-red-700">{loadError}</p>}
      {!loadError && !evidenceAvailable && jobs.length > 0 && (
        <p role="note" className="mx-[26px] max-[699px]:mx-[18px] mt-4 rounded-lg p-3 text-[13px]" style={{ backgroundColor: C.amberLight, color: C.amber }}>
          Calendar report statuses could not load, so &quot;Needs report&quot; is based on billing lines only and may include visits whose report is already complete. Visit dates come from billing lines only.
        </p>
      )}

      {/* Desktop split workspace — large desktop only */}
      <div className="hidden xl:flex flex-1 min-h-0 px-[26px] pt-5 pb-6 gap-5 items-stretch">
        <aside className="w-[380px] shrink-0 min-h-0 flex flex-col rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          <div className="shrink-0 px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
            <span className="text-[12px] font-medium" style={{ color: C.headerText }}>{summary}</span>
            <span className="text-[11px]" style={{ color: C.textMuted }}>{JOB_SORTS.find((o) => o.key === sort)?.label}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll">
            {visibleJobs.map((g) => (
              <JobBrowserRow key={g.id} job={g.job} group={g} stats={jobStats[g.id]} selected={g.id === selectedJobId} onSelect={() => setSelectedJobId(g.id)} />
            ))}
            {!visibleJobs.length && (
              <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>
                {emptyMessage}
                {filtersActive && !loadError && <div className="mt-3"><button type="button" onClick={clearFilters} className="px-3 py-1.5 rounded-full text-[12px] font-medium" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Clear filters</button></div>}
              </div>
            )}
            {filtered.length > visibleCount && (
              <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.border}` }}>
                <span className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>{visibleCount} of {filtered.length}</span>
                <button type="button" onClick={() => setVisibleCount(c => c + 40)} className="px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Load more</button>
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
      <div className="xl:hidden px-[26px] max-[699px]:px-[18px] pt-4 pb-10">
        <div className="mb-2.5 text-[12px] font-medium" style={{ color: C.textMuted }}>{summary}</div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {visibleJobs.map((g) => {
            const job = g.job;
            const stats = jobStats[g.id];
            return (
              <Link key={job.id} to={`/jobs/${job.id}`} className="flex items-start gap-3 rounded-[12px] p-4 transition-colors hover:bg-[#F6F3EC] card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold break-words" style={{ color: C.text, letterSpacing: "-0.01em" }}>{sanitizeText(job.canonical_name)}</div>
                  <div className="text-[12px] break-words mt-0.5" style={{ color: C.textMuted }}>{[job.builder && sanitizeText(job.builder), job.address && sanitizeText(job.address)].filter(Boolean).join(" · ") || "No builder or address"}</div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <StatusChip status={stats?.status} />
                    <DuplicateTags group={g} />
                  </div>
                </div>
                <div className="shrink-0 pt-0.5"><VisitInfo stats={stats} /></div>
              </Link>
            );
          })}
        </div>
        {!visibleJobs.length && (
          <div className="py-10 text-center text-[13px] break-words" style={{ color: C.textMuted }}>
            {emptyMessage}
            {filtersActive && !loadError && <div className="mt-3"><button type="button" onClick={clearFilters} className="min-h-11 px-4 rounded-full text-[13px] font-medium" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Clear filters</button></div>}
          </div>
        )}
        {filtered.length > visibleCount && (
          <div className="pt-3 text-center">
            <button type="button" onClick={() => setVisibleCount(c => c + 20)} className="min-h-11 px-4 rounded-full text-[13px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary, backgroundColor: C.card }}>Load more · {visibleCount} of {filtered.length}</button>
          </div>
        )}
      </div>
    </div>
  );
}
