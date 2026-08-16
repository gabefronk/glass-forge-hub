import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Search, MapPin, FileText, Briefcase, ChevronRight, Upload } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";
import { fetchAllPages } from "@/lib/pagination";

function formatReportDate(yyyyMmDd) {
  if (!yyyyMmDd) return "";
  const [y, m, d] = yyyyMmDd.split("-");
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function JobsHub() {
  const [jobs, setJobs] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

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

  const visitCounts = useMemo(() => {
    const m = {};
    for (const r of feeLines) {
      if (!r.job_id) continue;
      m[r.job_id] = (m[r.job_id] || 0) + 1;
    }
    return m;
  }, [feeLines]);

  // Most recent Probuild report upload date per job (YYYY-MM-DD).
  // Jobs with no Probuild report sort after those that have one.
  const lastReportDate = useMemo(() => {
    const m = {};
    for (const r of feeLines) {
      if (!r.job_id || r.source !== "probuild") continue;
      const d = r.job_date;
      if (!d) continue;
      if (!m[r.job_id] || d > m[r.job_id]) m[r.job_id] = d;
    }
    return m;
  }, [feeLines]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = !q ? jobs : jobs.filter((j) => {
      const name = (j.canonical_name || "").toLowerCase();
      const aliases = (j.aliases || []).join(" ").toLowerCase();
      const addr = (j.address || "").toLowerCase();
      const pos = (j.po_numbers || []).join(" ").toLowerCase();
      const oes = (j.oe_numbers || []).join(" ").toLowerCase();
      return [name, aliases, addr, pos, oes].some((s) => s.includes(q));
    });
    // Sort by most recent Probuild report first, then by job created_date.
    return [...base].sort((a, b) => {
      const da = lastReportDate[a.id] || "";
      const db = lastReportDate[b.id] || "";
      if (da !== db) return db.localeCompare(da);
      return (b.created_date || "").localeCompare(a.created_date || "");
    });
  }, [jobs, search, lastReportDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 pt-6 pb-16">
      <div className="flex items-center gap-3 mb-6">
        <Briefcase className="h-6 w-6 text-foreground" />
        <h1 className="font-heading text-2xl font-bold uppercase tracking-tight">Jobs</h1>
        <span className="text-sm text-muted-foreground">({filtered.length})</span>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, alias, address, PO, or OE..."
          className="w-full pl-10 pr-4 py-3 rounded-lg border border-border bg-white text-sm focus:outline-none focus:border-foreground transition-colors"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((job) => (
          <Link
            key={job.id}
            to={`/jobs/${job.id}`}
            className="block rounded-lg border border-border bg-white hover:border-foreground transition-colors p-4"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-heading text-sm font-bold uppercase tracking-wide truncate">
                    {job.canonical_name}
                  </span>
                  {job.builder && (
                    <span className="text-xs text-muted-foreground shrink-0">{job.builder}</span>
                  )}
                </div>
                {job.address && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{job.address}</span>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {visitCounts[job.id] || 0} visit{(visitCounts[job.id] || 0) === 1 ? "" : "s"}
                  </span>
                  {lastReportDate[job.id] && (
                    <span className="flex items-center gap-1 text-accent font-medium">
                      <Upload className="h-3 w-3" />
                      Report {formatReportDate(lastReportDate[job.id])}
                    </span>
                  )}
                  {(job.po_numbers || []).length > 0 && (
                    <span>PO: {job.po_numbers.join(", ")}</span>
                  )}
                  {(job.oe_numbers || []).length > 0 && (
                    <span>OE: {job.oe_numbers.join(", ")}</span>
                  )}
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
            </div>
          </Link>
        ))}
        {!filtered.length && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            No jobs match "{search}".
          </div>
        )}
      </div>
    </div>
  );
}