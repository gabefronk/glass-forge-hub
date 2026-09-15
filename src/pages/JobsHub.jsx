import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { C, jobStatus, jobTotals } from "@/lib/feeUI";
import JobListRow, { refsLabel } from "@/components/jobs/JobListRow";

export default function JobsHub() {
  const [jobs, setJobs] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [search, setSearch] = useState("");
  const [segment, setSegment] = useState("all");
  const [loading, setLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(20);

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

  useEffect(() => { setVisibleCount(20); }, [search, segment]);

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
      const status = jobStatus(rows);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: "#DDE0DA", borderTopColor: C.accent }} />
      </div>
    );
  }

  const visibleJobs = filtered.slice(0, visibleCount);
  const pills = [
    { key: "all", label: "All", count: jobs.length },
    { key: "active", label: "Active", count: counts.active },
    { key: "complete", label: "Complete", count: counts.complete },
    { key: "needs_report", label: "Needs report", count: counts.needsReport },
  ];

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="hero-glow px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-10">
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <h1 className="font-heading text-[24px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>Jobs</h1>
          <span className="font-mono-num text-[14px]" style={{ color: C.textMuted }}>({jobs.length.toLocaleString()})</span>
        </div>

        <div className="flex flex-col gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: C.textFaint }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, alias, address, PO or OE"
              className="w-full pl-10 pr-16 rounded-[12px] text-[13px] focus:outline-none transition-colors"
              style={{ height: "40px", border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: C.mutedBg, color: C.textFaint }}>⌘K</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto obsidian-scroll" style={{ scrollbarWidth: "none" }}>
            {pills.map((p) => (
              <button
                key={p.key}
                onClick={() => setSegment(p.key)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors"
                style={
                  segment === p.key
                    ? { backgroundColor: C.accent, color: C.accentDark }
                    : { backgroundColor: C.cardAlt, border: `1px solid ${C.border}`, color: C.textSecondary }
                }
              >
                {p.label}
                <span className="font-mono-num text-[11px]" style={{ opacity: 0.7 }}>{p.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="hidden xl:block rounded-[14px] overflow-hidden card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="overflow-x-auto obsidian-scroll" role="region" aria-label="Jobs table" tabIndex={0}>
          <div className="min-w-[620px]">
          <div style={{
            display: "grid", gridTemplateColumns: JobListRow.COLS, alignItems: "center",
            gap: 12, padding: "12px 16px", background: C.headerBg,
            fontFamily: "'Archivo',sans-serif", fontSize: 10, fontWeight: 600,
            letterSpacing: ".01em", color: C.headerText, whiteSpace: "nowrap",
          }}>
            <span>JOB</span>
            <span>BUILDER</span>
            <span style={{ textAlign: "right" }}>LATEST VISIT</span>
            <span>STATUS</span>
            <span />
          </div>
          <div>
            {visibleJobs.map((job) => (
              <JobListRow key={job.id} job={job} stats={jobStats[job.id]} />
            ))}
            {!visibleJobs.length && (
              <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No jobs match "{search}".</div>
            )}
          </div>
          </div>
          </div>
          {filtered.length > visibleCount && (
            <div className="px-4 py-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.border}` }}>
              <span className="font-mono-num text-[12px] whitespace-nowrap" style={{ color: C.textMuted }}>Showing {visibleCount} of {filtered.length.toLocaleString()}</span>
              <button onClick={() => setVisibleCount(c => c + 20)} className="px-3.5 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors hover:bg-[#F8F9F6]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Load more</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:hidden">
          {visibleJobs.map((job) => {
            const stats = jobStats[job.id];
            const refs = refsLabel(job.po_numbers || [], job.oe_numbers || []);
            return (
              <Link key={job.id} to={`/jobs/${job.id}`} className="block rounded-[14px] p-4 transition-colors hover:bg-[#F8F9F6]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                <div className="text-[14px] font-semibold break-words" style={{ color: C.text }}>{job.canonical_name}</div>
                <div className="text-[11px] break-words mt-0.5" style={{ color: C.textMuted }}>{job.builder ? `${job.builder} · ` : ""}{job.address || ""}</div>
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