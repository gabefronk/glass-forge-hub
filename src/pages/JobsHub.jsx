import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, ChevronDown, Upload, Plus } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { C, JOBS_GRID, CARD_SHADOW, ROW_SHADOW, jobTotals, jobStatus, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";
import JobListRow from "@/components/jobs/JobListRow";
import { cn } from "@/lib/utils";

export default function JobsHub() {
  const [jobs, setJobs] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [chipFilter, setChipFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(10);

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

  useEffect(() => { setVisibleCount(10); }, [search, segment, chipFilter]);

  const feeLinesByJob = useMemo(() => {
    const m = {};
    for (const r of feeLines) {
      if (!r.job_id) continue;
      if (!m[r.job_id]) m[r.job_id] = [];
      m[r.job_id].push(r);
    }
    return m;
  }, [feeLines]);

  const jobStats = useMemo(() => {
    const m = {};
    for (const job of jobs) {
      const rows = feeLinesByJob[job.id] || [];
      const totals = jobTotals(rows);
      const status = jobStatus(rows);
      const probuildDates = rows.filter(r => r.source === "probuild" || r.source === "both").map(r => r.job_date).filter(Boolean).sort();
      const lastReport = probuildDates.length ? probuildDates[probuildDates.length - 1] : null;
      const unbilled = rows.some(r => !r.billed_to_bfs && Number(r.labor_amt) > 0);
      m[job.id] = { ...totals, status, lastReport, unbilled };
    }
    return m;
  }, [jobs, feeLinesByJob]);

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
    if (segment === "active") base = base.filter(j => jobStats[j.id]?.status.key !== "complete");
    if (segment === "complete") base = base.filter(j => jobStats[j.id]?.status.key === "complete");
    if (chipFilter === "needs_report") base = base.filter(j => jobStats[j.id]?.status.key === "needs_report");
    if (chipFilter === "unbilled") base = base.filter(j => jobStats[j.id]?.unbilled);
    return [...base].sort((a, b) => {
      const da = jobStats[a.id]?.lastReport || "";
      const db = jobStats[b.id]?.lastReport || "";
      if (da !== db) return db.localeCompare(da);
      return (b.created_date || "").localeCompare(a.created_date || "");
    });
  }, [jobs, search, segment, chipFilter, jobStats]);

  const counts = useMemo(() => {
    let needsReport = 0, unbilled = 0;
    for (const job of jobs) {
      if (jobStats[job.id]?.status.key === "needs_report") needsReport++;
      if (jobStats[job.id]?.unbilled) unbilled++;
    }
    return { needsReport, unbilled };
  }, [jobs, jobStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-8 h-8 border-4 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.accentDark }} />
      </div>
    );
  }

  const visibleJobs = filtered.slice(0, visibleCount);

  return (
    <div className="px-4 sm:px-8 pt-6 pb-16" style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: C.accentDark }}>Jobs</h1>
        <span style={{ fontSize: "13px", color: C.text, opacity: 0.62 }}>({jobs.length.toLocaleString()})</span>
        <div className="ml-auto flex items-center gap-2">
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors hover:bg-[#f6f8f6]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }}>
            <Upload className="h-3.5 w-3.5" />Import
          </button>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm whitespace-nowrap" style={{ backgroundColor: C.accentDark, color: "#eef2f0" }}>
            <Plus className="h-3.5 w-3.5" />New job
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: C.text, opacity: 0.4 }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, alias, address, PO or OE"
            className="w-full pl-10 pr-16 rounded-md text-sm focus:outline-none transition-colors"
            style={{ height: "38px", border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: C.mutedBg, color: C.text, opacity: 0.5 }}>⌘K</span>
        </div>
        <div className="flex items-center rounded-md p-0.5" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          {["all", "active", "complete"].map(seg => (
            <button
              key={seg}
              onClick={() => setSegment(seg)}
              className="px-3 py-1.5 rounded text-xs font-medium capitalize whitespace-nowrap transition-colors"
              style={segment === seg ? { backgroundColor: C.accentDark, color: "#eef2f0" } : { color: C.text, opacity: 0.68 }}
            >
              {seg}
            </button>
          ))}
        </div>
        <button
          onClick={() => setChipFilter(chipFilter === "needs_report" ? null : "needs_report")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors"
          style={chipFilter === "needs_report" ? { backgroundColor: C.amberLight, color: C.amber } : { border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text, opacity: 0.68 }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.amber }} />
          Needs report {counts.needsReport}
        </button>
        <button
          onClick={() => setChipFilter(chipFilter === "unbilled" ? null : "unbilled")}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors"
          style={chipFilter === "unbilled" ? { backgroundColor: C.accent12, color: C.accent } : { border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text, opacity: 0.68 }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: C.accent }} />
          Unbilled {counts.unbilled}
        </button>
        <button className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text, opacity: 0.68 }}>
          Sort: Recent activity <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Desktop table card */}
      <div className="hidden md:block rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
        <div
          className={cn(JOBS_GRID, "px-4 py-2.5 sticky top-0 z-10")}
          style={{ backgroundColor: C.headerBg, color: C.headerText, fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}
        >
          <div>Job</div>
          <div className="text-right">Visits</div>
          <div className="text-right">Last report</div>
          <div className="text-right">Labor</div>
          <div className="text-right">Fee</div>
          <div className="text-right">Status</div>
          <div />
        </div>
        <div>
          {visibleJobs.map((job) => (
            <JobListRow key={job.id} job={job} stats={jobStats[job.id]} />
          ))}
          {!visibleJobs.length && (
            <div className="px-4 py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>No jobs match "{search}".</div>
          )}
        </div>
        {filtered.length > visibleCount && (
          <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.border}` }}>
            <span className="text-xs whitespace-nowrap" style={{ color: C.text, opacity: 0.62 }}>Showing {visibleCount} of {filtered.length.toLocaleString()}</span>
            <button onClick={() => setVisibleCount(c => c + 20)} className="px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors hover:bg-[#f6f8f6]" style={{ border: `1px solid ${C.border}`, color: C.text }}>Load more</button>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {visibleJobs.map((job) => {
          const stats = jobStats[job.id];
          const isZero = stats?.labor === 0;
          const barColor = isZero ? C.leftBarZero : C.accent;
          return (
            <Link key={job.id} to={`/jobs/${job.id}`} className="block rounded-lg p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
              <div className="flex items-center gap-2">
                <div className="w-[3px] h-10 rounded-full shrink-0" style={{ backgroundColor: barColor }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate" style={{ fontSize: "14px", fontWeight: 600, color: C.accentDark }}>{job.canonical_name}</span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap ml-auto" style={{ backgroundColor: stats?.status.bg, color: stats?.status.text }}>{stats?.status.label}</span>
                  </div>
                  {job.address && <div className="text-xs truncate mt-0.5" style={{ color: C.text, opacity: 0.68 }}>{job.address}</div>}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs mt-2 pl-2" style={{ color: C.text, opacity: 0.68 }}>
                <span className="whitespace-nowrap">{stats?.visits || 0} visit{(stats?.visits || 0) === 1 ? "" : "s"}</span>
                <span>·</span>
                <span className="whitespace-nowrap">{stats?.lastReport ? formatShort(stats.lastReport) : "No report"}</span>
                <span className="ml-auto font-semibold whitespace-nowrap" style={{ color: isZero ? C.text : C.accent, opacity: isZero ? 0.5 : 1 }}>{isZero ? "—" : `$${formatMoney(stats.fee)}`}</span>
              </div>
            </Link>
          );
        })}
        {!visibleJobs.length && (
          <div className="py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>No jobs match "{search}".</div>
        )}
        {filtered.length > visibleCount && (
          <div className="pt-2 text-center">
            <button onClick={() => setVisibleCount(c => c + 20)} className="px-3 py-1.5 rounded-md text-xs whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.text }}>Load more</button>
          </div>
        )}
      </div>
    </div>
  );
}