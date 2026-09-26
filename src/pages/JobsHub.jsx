import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import JobBrowserRow from "@/components/jobs/JobBrowserRow";
import JobWorkspacePanel from "@/components/jobs/JobWorkspacePanel";
import ProbuildReports from "@/pages/ProbuildReports";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { buildJobsOverview, sortJobGroups, builderOptions, needsYou, JOB_SORTS } from "@/lib/jobsOverview";
import { denverDate } from "../../base44/shared/billingCore.js";
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
    if (segment === "needs_you") base = base.filter(g => needsYou(jobStats[g.id]?.status, g));
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

  // Four main views; the less common ones sit in the "More" menu.
  const segments = [
    { key: "needs_you", label: "Needs you", count: counts.needs_you, attention: true },
    { key: "this_week", label: "This week", count: counts.this_week },
    // The Active view also lists jobs that need a report or a match review, so its count includes them.
    { key: "active", label: "Active", count: counts.active + counts.needs_report + counts.needs_review },
    { key: "all", label: "All", count: groups.length },
  ];
  const moreViews = [
    { key: "complete", label: "Complete", count: counts.complete },
    { key: "needs_report", label: "Needs report", count: counts.needs_report },
    { key: "needs_review", label: "Needs review", count: counts.needs_review },
    { key: "duplicates", label: "Possible duplicates", count: counts.duplicates },
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
  const todayLabel = new Date(`${denverDate()}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const summary = `${filtered.length.toLocaleString()} ${filtered.length === 1 ? "job" : "jobs"}${builder ? ` · ${builder}` : ""}`;
  const moreValue = moreViews.some((m) => m.key === segment) ? segment : "";
  const selectCls = "h-9 min-w-0 rounded-[10px] border-0 bg-white px-2.5 text-[12.5px] text-[#34403f] shadow-[0_1px_2px_rgba(16,22,23,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3f3b]";

  const listHeader = (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-[28px] font-extrabold" style={{ color: "#101617", letterSpacing: "-0.04em" }} title={counts.records !== groups.length ? `${counts.records.toLocaleString()} records; duplicates with the same customer and address are shown once` : undefined}>Jobs</h1>
        <span className="text-[13px]" style={{ color: "#566063" }}>{todayLabel} · {counts.today} {counts.today === 1 ? "visit" : "visits"} today</span>
      </div>
      {owner && <div>{renderToggle(false)}</div>}
      <div className="flex gap-2">
        <label className="relative flex flex-1 items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4" style={{ color: "#616a6d" }} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search job, address, PO"
            aria-label="Search jobs"
            className="h-[42px] w-full rounded-[11px] border-0 bg-white pl-[38px] pr-9 text-[14px] shadow-[0_1px_2px_rgba(16,22,23,.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0b3f3b]"
            style={{ color: "#101617" }}
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-1 inline-flex h-8 w-8 items-center justify-center rounded-full" style={{ color: "#616a6d" }}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
        <AddJobDialog jobs={jobs} onCreated={handleJobCreated} label="New job" triggerClassName="inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-[11px] bg-[#0b3f3b] px-3.5 text-[14px] font-semibold text-white" />
      </div>
      <div role="group" aria-label="Show" className="grid grid-cols-4 gap-0.5 rounded-[12px] p-1" style={{ backgroundColor: "#e9e4d9" }}>
        {segments.map((v) => {
          const on = segment === v.key;
          return (
            <button key={v.key} type="button" onClick={() => setSegment(v.key)} aria-pressed={on}
              className="flex h-12 min-w-0 flex-col items-center justify-center rounded-[9px] px-1 text-[13px] leading-tight whitespace-nowrap"
              style={on ? { backgroundColor: "#ffffff", color: "#101617", fontWeight: 700, boxShadow: "0 1px 2px rgba(16,22,23,.1)" } : { color: "#566063", fontWeight: 500 }}>
              <span>{v.label}</span><span className="mt-0.5 text-[11.5px] font-semibold" style={{ color: v.attention ? "#8a5a12" : "#6b7477" }}>{v.count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_124px_96px] items-center gap-2">
        <select aria-label="Builder" value={builder} onChange={(e) => setBuilder(e.target.value)} className={`${selectCls} w-full`}>
          <option value="">All builders</option>
          {builders.map((b) => <option key={b.name} value={b.name}>{b.name} ({b.count})</option>)}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} className={`${selectCls} w-full`}>
          {JOB_SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <select aria-label="More views" value={moreValue} onChange={(e) => setSegment(e.target.value || "all")} className={`${selectCls} w-full`} style={moreValue ? { backgroundColor: "#0e2426", color: "#ffffff" } : undefined}>
          <option value="">More…</option>
          {moreViews.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.count})</option>)}
        </select>
      </div>
      <div className="flex items-center justify-between text-[12px]" style={{ color: "#6b7477" }}>
        <span>{summary}</span>
        {filtersActive && <button type="button" onClick={clearFilters} className="font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Clear filters</button>}
      </div>
    </div>
  );

  const notices = (
    <>
      {loadError && <p role="alert" className="mt-3 rounded-lg border bg-white p-3 text-[13px] text-red-700">{loadError}</p>}
      {!loadError && !evidenceAvailable && jobs.length > 0 && (
        <p role="note" className="mt-3 rounded-lg p-3 text-[12.5px]" style={{ backgroundColor: C.amberLight, color: C.amber }}>
          Calendar report statuses could not load, so &quot;Needs report&quot; is based on billing lines only and may include visits whose report is already complete.
        </p>
      )}
    </>
  );

  const emptyState = (
    <div className="px-4 py-10 text-center text-[13px]" style={{ color: "#566063" }}>
      {emptyMessage}
      {filtersActive && !loadError && <div className="mt-3"><button type="button" onClick={clearFilters} className="min-h-10 rounded-full bg-white px-4 text-[13px] font-medium" style={{ color: "#34403f" }}>Clear filters</button></div>}
    </div>
  );

  const loadMore = (step) => filtered.length > visibleCount && (
    <div className="flex items-center justify-between px-1 py-3">
      <span className="text-[12px]" style={{ color: "#6b7477" }}>{visibleCount} of {filtered.length.toLocaleString()}</span>
      <button type="button" onClick={() => setVisibleCount((c) => c + step)} className="min-h-10 rounded-full bg-white px-4 text-[13px] font-semibold shadow-[0_1px_2px_rgba(16,22,23,.08)]" style={{ color: "#0b3f3b" }}>Load more</button>
    </div>
  );

  return (
    <div style={{ backgroundColor: "#f4f1ea", minHeight: "100dvh" }} className="flex flex-col xl:h-[100dvh] xl:overflow-hidden">
      {/* Desktop: job list on the left, the selected job on the right */}
      <div className="hidden xl:flex flex-1 min-h-0">
        <section aria-label="Jobs" className="flex w-[404px] shrink-0 flex-col px-[18px] pt-[26px]">
          {listHeader}
          {notices}
          <div className="mt-3.5 flex-1 min-h-0 overflow-y-auto obsidian-scroll -mx-1 px-1 pb-6">
            <div className="flex flex-col gap-2">
              {visibleJobs.map((g) => (
                <JobBrowserRow key={g.id} job={g.job} group={g} stats={jobStats[g.id]} selected={g.id === selectedJobId} onSelect={() => setSelectedJobId(g.id)} />
              ))}
            </div>
            {!visibleJobs.length && emptyState}
            {loadMore(40)}
          </div>
        </section>
        <section aria-label="Job" className="mr-[18px] mt-[18px] flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden rounded-t-[20px] bg-white shadow-[0_1px_3px_rgba(16,22,23,.06)]">
          {selectedJobId ? <JobWorkspacePanel jobId={selectedJobId} group={selectedGroup} onJobChanged={(next) => setJobs((current) => current.map((j) => (j.id === next.id ? { ...j, ...next } : j)))} /> : (
            <div className="flex h-full items-center justify-center text-[13px]" style={{ color: "#566063" }}>Pick a job on the left.</div>
          )}
        </section>
      </div>

      {/* Phone and tablet: the same cards, each opens the job page */}
      <div className="xl:hidden px-[18px] pt-[18px] pb-10 lg:px-[26px]">
        {listHeader}
        {notices}
        <div className="mt-3.5 grid grid-cols-1 gap-2 lg:grid-cols-2">
          {visibleJobs.map((g) => (
            <JobBrowserRow key={g.id} job={g.job} group={g} stats={jobStats[g.id]} href={`/jobs/${g.job.id}`} />
          ))}
        </div>
        {!visibleJobs.length && emptyState}
        {loadMore(20)}
      </div>
    </div>
  );
}
