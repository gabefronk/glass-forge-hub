import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";

const dateLabel = value => new Date(value + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export default function PersonalWorkContext() {
  const { user } = useAuth();
  const [state, setState] = useState({ data: null, error: "", loading: true });
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++sequence.current;
    try {
      const response = await base44.functions.invoke("todos", { action: "home_context" });
      if (response.data?.error) throw new Error(response.data.error);
      if (run === sequence.current) setState({ data: response.data, error: "", loading: false, userId: user?.id });
    } catch (error) {
      if (run === sequence.current) setState({ data: null, error: error?.response?.data?.error || error.message || "Your job context could not load.", loading: false, userId: user?.id });
    }
  }, [user?.id]);
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("personal-tasks-updated", onFocus);
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 60000);
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("personal-tasks-updated", onFocus); };
  }, [refresh]);
  const data = state.userId === user?.id ? state.data : null;
  const visits = [...(data?.visits || [])].sort((a,b) => (a.event_date + (a.start_time || "00:00")).localeCompare(b.event_date + (b.start_time || "00:00")));
  const jobs = (data?.jobs || []).filter(j => j.stage !== "closed");
  return <section aria-label="Your job context" className="rounded-2xl border border-[#d3cabb] bg-white p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-[#0B3F3B]">Your week</h2><Link to="/calendar" className="min-h-10 py-2 text-sm font-medium text-[#0B3F3B] hover:underline">Calendar →</Link></div>
    <p className="mb-3 text-xs text-slate-500">Next seven days for jobs assigned to you or linked to your active tasks.</p>
    {state.loading && <p className="py-3 text-sm text-slate-500">Loading your linked jobs…</p>}
    {state.userId === user?.id && state.error && <div role="alert" className="flex flex-wrap gap-3 text-sm text-red-700">{state.error}<button onClick={refresh} className="underline">Try again</button></div>}
    {data && <><ul className="divide-y divide-slate-100">{visits.slice(0,8).map(visit => <li key={visit.id}><Link to={"/jobs/"+encodeURIComponent(visit.job_id)} className="flex min-h-14 items-center gap-4 py-3 hover:bg-slate-50"><span className="w-28 shrink-0 text-xs text-slate-500">{dateLabel(visit.event_date)}<span className="block">{visit.start_time || "All day"}</span></span><span className="min-w-0 flex-1 break-words text-sm font-medium">{visit.summary || jobs.find(j=>j.id===visit.job_id)?.canonical_name || "Open job"}</span><span aria-hidden="true">→</span></Link></li>)}</ul>
    {!visits.length && <p className="py-4 text-sm text-slate-500">No visits on your linked jobs this week.</p>}
    {visits.length > 8 && <p className="text-xs text-slate-500">{visits.length-8} more visits are listed in Calendar.</p>}
    {(data.jobs_truncated || data.visits_truncated) && <p className="mt-2 text-xs text-amber-800">The loading limit was reached. This list may be incomplete; use Jobs or Calendar to review more.</p>}
    <details className="mt-3 border-t border-slate-100 pt-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Your active jobs ({jobs.length})</summary><ul className="grid gap-x-5 sm:grid-cols-2">{jobs.map(job => <li key={job.id}><Link to={"/jobs/"+encodeURIComponent(job.id)} className="block min-h-10 py-2 text-sm text-[#0B3F3B] hover:underline">{job.canonical_name || "Open job"}<span className="ml-2 text-xs text-slate-400">{String(job.stage || "").replaceAll("_"," ")}</span></Link></li>)}</ul>{!jobs.length&&<p className="py-2 text-xs text-slate-500">Link a task to a job to keep its visits here.</p>}</details></>}
    {isAgentCenterOwner(user) && <div className="mt-3 flex flex-wrap gap-x-5 border-t border-slate-100 pt-3 text-sm"><Link to="/" className="min-h-10 py-2 font-medium text-[#0B3F3B] hover:underline">Review billing →</Link><Link to="/operations/overview" className="min-h-10 py-2 text-slate-500 hover:underline">Company overview →</Link></div>}
  </section>;
}

