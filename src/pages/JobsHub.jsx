import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { C, formatShort } from "@/lib/feeUI";
import { jobsStatus, sanitizeText } from "@/lib/jobsSanitize";
import { refsLabel } from "@/components/jobs/JobListRow";
import JobBrowserRow from "@/components/jobs/JobBrowserRow";
import JobWorkspacePanel from "@/components/jobs/JobWorkspacePanel";
import ProbuildReports from "@/pages/ProbuildReports";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";

export default function JobsHub() {
  const [jobs, setJobs] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(40);
  const [owner, setOwner] = useState(false);
  const [view, setView] = useState("jobs");
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const load = async () => {
      try {
        const [jb, fl] = await Promise.all([
          fetchAllPages(base44.entities.Jobs, '-created_date', 1000),
          fetchAllPages(base44.entities.FeeLines, '-created_date', 1000),
        ]);
        setJobs(jb);
        setFeeLines(fl);
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

  const feeLinesByJob = useMemo(() => {
    const m = {};
    for (const r of feeLines) {
      if (!r.job_id) continue;
      (m[r.job_id] ||= []).push(r);
    }
    return m;
  }, [feeLines]);

  const jobStats = useMemo(() => {
    const m = {};
    for (const job of jobs) {
      const rows = feeLinesByJob[job.id] || [];
      const status = jobsStatus(rows);
      const probuildDates = rows.filter(r => r.source === "probuild" || r.source === "both").map(r => r.job_date).filter(Boolean).sort();
      const lastReport = probuildDates.length ? probuildDates[probuildDates.length - 1] : null;
      m[job.id] = { status, lastReport };
    }
    return m;
  }, [jobs, feeLinesByJob]);

  const counts = useMemo(() => {
    let needsReport = 0, active = 0, complete = 0;
    for (const job of jobs) {
      const s = jobStats[job.id]?.status.key;
      if (s === "needs_report") needsReport++;
      if (s === "active") active++;
      if (s === "complete") complete++;
    }
    return { needsReport, active, complete };
  }, [jobs, jobStats]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = !q ? jobs : jobs.filter((j) => {
      const name = (j.canonical_name || "").toLowerCase();
      const aliases = (j.aliases || []).join(" ").toLowerCase();
      const addr = (j.address || "").toLowerCase();
      const pos = (j.po_numbers || []).join(" ").toLowerCase();
      const oes = (j.oe_numbers || []).join(" ").toLowerCase();
      return [name, aliases, addr, pos, oes].some((s) => s.includes(q));
    });
    if (segment === "active") base = base.filter(j => ["active", "needs_report"].includes(jobStats[j.id]?.status.key));
    if (segment === "complete") base = base.filter(j => jobStats[j.id]?.status.key === "complete");
    if (segment === "needs_report") base = base.filter(j => jobStats[j.id]?.status.key === "needs_report");
    return [...base].sort((a, b) => {
      const da = jobStats[a.id]?.lastReport || "";
      const db = jobStats[b.id]?.lastReport || "";
      if (da !== db) return db.localeCompare(da);
      return (b.created_date || "").localeCompare(a.created_date || "");
    });
  }, [jobs, search, segment, jobStats]);

  // Auto-select the first visible job for the desktop workspace.
  useEffect(() => {
    if (!filtered.length) { setSelectedJobId(null); return; }
    if (!selectedJobId || !filtered.some(j => j.id === selectedJobId)) {
      setSelectedJobId(filtered[0].id);
    }
  }, [filtered]); // eslint-disable-line react-hooks/exhaustive-deps

  const pills = [
    { key: "all", label: "All", count: jobs.length },
    { key: "active", label: "Active", count: counts.active },
    { key: "complete", label: "Complete", count: counts.complete },
    { key: "needs_report", label: "Needs report", count: counts.needsReport },
  ];

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

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }} className="flex flex-col">
      {/* Dark-green hero */}
      <header className="shrink-0 px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-5" style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-[30px] font-bold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Jobs</h1>
            <span className="font-mono-num text-[14px]" style={{ color: "var(--gf-sidebar-muted)" }}>({jobs.length.toLocaleString()})</span>
          </div>
          {owner && renderToggle(true)}
        </div>
        <div className="flex flex-col gap-3">
          <div className="relative flex-1 max-w-[560px]">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "var(--gf-sidebar-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, alias, address, PO or OE"
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

      {/* Desktop split workspace — large desktop only */}
      <div className="hidden xl:flex flex-1 min-h-0 px-[26px] max-[699px]:px-[18px] pb-6 gap-5 items-stretch">
        <aside className="w-[340px] shrink-0 min-h-0 flex flex-col rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          <div className="shrink-0 px-3.5 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: C.headerText }}>{filtered.length} job{filtered.length === 1 ? "" : "s"}</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto obsidian-scroll">
            {visibleJobs.map((job) => (
              <JobBrowserRow key={job.id} job={job} stats={jobStats[job.id]} selected={job.id === selectedJobId} onSelect={() => setSelectedJobId(job.id)} />
            ))}
            {!visibleJobs.length && (
              <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No jobs match "{search}".</div>
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
          {selectedJobId ? <JobWorkspacePanel jobId={selectedJobId} /> : (
            <div className="flex items-center justify-center h-full text-[13px]" style={{ color: C.textMuted }}>Select a job to view its activity.</div>
          )}
        </section>
      </div>

      {/* Mobile/tablet card list + detail navigation */}
      <div className="xl:hidden px-[18px] pt-4 pb-10">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visibleJobs.map((job) => {
            const stats = jobStats[job.id];
            const refs = refsLabel(job.po_numbers || [], job.oe_numbers || []);
            return (
              <Link key={job.id} to={`/jobs/${job.id}`} className="block rounded-[14px] p-4 transition-colors hover:bg-[#F6F3EC]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                <div className="text-[15px] font-bold break-words" style={{ color: C.text }}>{sanitizeText(job.canonical_name)}</div>
                <div className="text-[11px] break-words mt-0.5" style={{ color: C.textMuted }}>{job.builder ? `${sanitizeText(job.builder)} · ` : ""}{sanitizeText(job.address || "")}</div>
                <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                  <span className="text-[9px] font-semibold tracking-[0.01em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: stats?.status.bg, border: `1px solid ${stats?.status.border || C.border}`, color: stats?.status.text }}>{stats?.status.label}</span>
                  {stats?.lastReport && <span className="text-[9px] tracking-[0.01em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.mutedBg, border: `1px solid ${C.border}`, color: C.textSecondary }}>Last {formatShort(stats.lastReport)}</span>}
                  {refs && <span className="max-w-full break-all text-[9px] tracking-[0.01em] px-2 py-0.5 rounded-full" style={{ backgroundColor: C.mutedBg, border: `1px solid ${C.border}`, color: C.textSecondary }}>{refs}</span>}
                </div>
              </Link>
            );
          })}
          {!visibleJobs.length && (
            <div className="col-span-full py-10 text-center text-[13px] break-words" style={{ color: C.textMuted }}>No jobs match "{search}".</div>
          )}
          {filtered.length > visibleCount && (
            <div className="col-span-full pt-2 text-center">
              <button onClick={() => setVisibleCount(c => c + 20)} className="px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Load more</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}