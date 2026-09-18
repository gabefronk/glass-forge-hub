import { invoicingStats } from "@/lib/invoicingStats";
import { denverDate } from "../../base44/shared/billingCore.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { formatMoney, withComputedAmounts } from "@/lib/feeMath";
import { buildSupersededSet, isReady, withCompanions } from "@/lib/invoicingFilters";
import { C } from "@/lib/feeUI";
import { useTodoAccess } from "@/hooks/use-todo-access";
import { dueState, laneKey, laneLabel, sortByUrgency } from "@/lib/todoBoard";
import { Download, Plus, Check, ListTodo } from "lucide-react";
import OutstandingReports from "@/components/dashboard/OutstandingReports";
import ComplianceSettings from "@/components/dashboard/ComplianceSettings";

function todayStr() {
  return denverDate(); // YYYY-MM-DD
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function dateHeader() {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "long" }).toUpperCase();
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  return `${day} · ${date} · ${time}`;
}

function eventTag(ev) {
  const text = `${ev.job_name || ""} ${ev.scope_notes || ""}`.toLowerCase();
  if (/install/.test(text)) return "INSTALL";
  if (/measure|measurement/.test(text)) return "MEASURE";
  if (/pickup|pick up|pick-up/.test(text)) return "PICKUP";
  if (/deliver|delivery/.test(text)) return "DELIVER";
  if (/bill|invoice|quote/.test(text)) return "BILLING";
  if (/service|warranty/.test(text)) return "SERVICE";
  return "INSTALL";
}

function crewForEvent(ev) {
  if (!ev.created_by) return "";
  if (ev.created_by === "iryedra@gmail.com") return "Ragen";
  if (ev.created_by === "gabriel.fronk.wd@gmail.com") return "Gabe";
  return ev.created_by.split("@")[0];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [calendarError, setCalendarError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reportStatusMap, setReportStatusMap] = useState(new Map());
  const [profits, setProfits] = useState([]);
  const [todayEvents, setTodayEvents] = useState([]);
  const [tomorrowEvents, setTomorrowEvents] = useState([]);
  const [feeLines, setFeeLines] = useState([]);
  const [allCalendarEvents, setAllCalendarEvents] = useState([]);
  const [unmatchedEvents, setUnmatchedEvents] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(new Set());
  const [complianceStartDate, setComplianceStartDate] = useState(null);

  const today = todayStr();
  const tomorrow = denverDate(new Date(Date.now() + 86400000));
  const currentMonth = today.slice(0, 7);

  const load = async () => {
    try {
      const [mp, reconciliation, fl, me, settings, calSource] = await Promise.all([
        base44.entities.MonthlyProfit.list("-month", 500),
        base44.functions.invoke("ownedCalendar", {}).catch(error => ({ data: { error: error?.response?.data?.error || "Calendar could not refresh." } })),
        base44.entities.FeeLines.filter({ invoice_month: currentMonth }, "-job_date", 5000),
        base44.auth.me().catch(() => null),
        base44.entities.AppSettings.list("-created_date", 10).catch(() => []),
        base44.entities.CalendarEvents.list("-event_date", 5000),
      ]);
      // The run sheet is operational only: the reconciliation function returns
      // sales-tracker-verified jobs and leaves unmatched source events in review.
      setCalendarError(reconciliation?.data?.error || "");
      // Groups include unverified events (ownership: null) as their own groups; admins also get
      // them again as excluded_events. Split on ownership so each event appears exactly once:
      // verified visits on the run sheet, unverified ones in the review list (for every role).
      const allEvents = (reconciliation?.data?.groups || []).map(group => group[0]).filter(Boolean);
      const verified = allEvents.filter((e) => e.ownership);
      setUnmatchedEvents(allEvents.filter((e) => !e.ownership));
      setReportStatusMap(new Map(calSource.filter(e => e.google_event_id).map(e => [e.google_event_id, e.report_status])));
      setProfits(Array.isArray(mp) ? mp : []);
      setAllCalendarEvents(allEvents);
      setTodayEvents(verified.filter((e) => (e.event_date || "").slice(0, 10) === today));
      setTomorrowEvents(allEvents.filter((e) => (e.event_date || "").slice(0, 10) === tomorrow));
      // Same display rows as Invoicing (companion lines resolved) so the totals agree.
      setFeeLines(withCompanions(withComputedAmounts(fl), calSource));
      if (me) setUser(me);
      if (Array.isArray(settings) && settings.length > 0) setComplianceStartDate(settings[0].compliance_start_date);
      setLoadError("");
    } catch (e) {
      setLoadError("Dashboard data could not load; figures below may be incomplete. " + (e?.message || ""));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  // Year to date: only this calendar year's months (the list holds every month on record).
  const ytdMonths = useMemo(() => profits.filter((p) => String(p.month || "").startsWith(currentMonth.slice(0, 4))), [profits, currentMonth]);
  const ytdProfit = useMemo(() => {
    return ytdMonths.reduce((s, p) => s + (Number(p.ya_windows_profit) || 0) + (Number(p.glass_forge_profit) || 0), 0);
  }, [ytdMonths]);

  const billing = useMemo(() => invoicingStats(feeLines, reportStatusMap), [feeLines, reportStatusMap]);
  const unbilled = { total: billing.readyTotal, count: billing.readyCount };

  // Exports the same population as the "Ready to bill" KPI (this month's ready lines).
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportStatement = async () => {
    setExporting(true);
    setExportError("");
    try {
      const { exportInvoicePdf } = await import("@/lib/exportInvoicePdf");
      const superseded = buildSupersededSet(feeLines);
      const rows = feeLines.filter((r) => isReady(r, reportStatusMap, superseded));
      await exportInvoicePdf(currentMonth, rows);
    } catch (e) {
      setExportError("Statement export failed. " + (e?.message || ""));
    } finally {
      setExporting(false);
    }
  };

  const onHold = useMemo(() => {
    // Jobs with needs_report status — approximate from fee lines
    const jobMap = {};
    for (const r of feeLines) {
      if (!r.job_id) continue;
      if (!jobMap[r.job_id]) jobMap[r.job_id] = { needsReview: false, name: r.job_name_norm };
      if (r.needs_review) jobMap[r.job_id].needsReview = true;
    }
    const held = Object.entries(jobMap).filter(([, v]) => v.needsReview);
    return { count: held.length, name: held[0]?.[1]?.name || "" };
  }, [feeLines]);

  const sortedToday = useMemo(() => {
    return [...todayEvents].sort((a, b) => (a.start_time || "99").localeCompare(b.start_time || "99"));
  }, [todayEvents]);

  const unmatchedToday = useMemo(() => {
    return unmatchedEvents
      .filter((e) => (e.event_date || "").slice(0, 10) === today)
      .sort((a, b) => (a.start_time || "99").localeCompare(b.start_time || "99"));
  }, [unmatchedEvents, today]);

  const firstUp = sortedToday[0] || null;
  const doneCount = sortedToday.filter((e) => checked.has(e.id)).length;

  const toggleCheck = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Mini bar chart data — last 8 months
  const chartData = useMemo(() => {
    const sorted = profits.filter((p) => p.month).sort((a, b) => String(a.month).localeCompare(String(b.month)));
    return sorted.slice(-8).map((p) => ({
      month: p.month,
      value: (Number(p.ya_windows_profit) || 0) + (Number(p.glass_forge_profit) || 0),
    }));
  }, [profits]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: C.pageBg }}>
        <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: C.borderStrong, borderTopColor: C.accent }} />
      </div>
    );
  }

  const userName = user?.full_name || user?.email?.split("@")[0] || "there";

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      {/* Hero glow */}
      <div className="hero-glow px-[26px] pt-[26px] pb-4 max-[699px]:px-[18px] max-[699px]:pt-[18px]">
        {/* Header row */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="min-w-0 flex-1 basis-[300px]">
            <div className="mono-label mb-1.5">{dateHeader()}</div>
            <h1 className="font-heading text-[24px] sm:text-[28px] font-semibold break-words" style={{ color: C.text, letterSpacing: "-0.03em" }}>
              {greeting()}, {userName}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={exportStatement} disabled={exporting} title={`PDF of ${currentMonth} lines that are ready to bill`} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-[#F8F9F6] disabled:opacity-60" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              <Download className="h-3.5 w-3.5" />
              {exporting ? "Generating…" : "Export statement"}
            </button>
            <button onClick={() => navigate("/window-quotes?new=1")} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
              <Plus className="h-3.5 w-3.5" />
              New quote
            </button>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 xl:grid-cols-4 gap-3">
          <KpiCard label="Profit YTD" value={`$${formatMoney(ytdProfit)}`} sub={`${ytdMonths.length} ${ytdMonths.length === 1 ? "month" : "months"} recorded in ${currentMonth.slice(0, 4)}`} />
          <KpiCard label={`${currentMonth} recorded fees`} value={`$${formatMoney(billing.monthEarnedTotal)}`} valueColor={C.accent} sub={`${formatMoney(billing.heldTotal)} held · excludes scheduled`} />
          <KpiCard label="Ready to bill" value={`$${formatMoney(unbilled.total)}`} sub={`${unbilled.count} eligible lines this month`} />
          <KpiCard label="On hold" value={String(onHold.count)} valueColor={C.amber} sub={onHold.name || "—"} subColor={C.amber} />
        </div>
      </div>

      {/* Body */}
      <div className="px-[26px] max-[699px]:px-[18px] pb-10">
        {calendarError && <p role="alert" className="mb-4 rounded-lg border bg-white p-3 text-red-700">{calendarError}</p>}
        {loadError && <p role="alert" className="mb-4 rounded-lg border bg-white p-3 text-red-700">{loadError}</p>}
        {exportError && <p role="alert" className="mb-4 rounded-lg border bg-white p-3 text-red-700">{exportError}</p>}
        <OutstandingReports events={allCalendarEvents} user={user} onChanged={load} complianceStartDate={complianceStartDate} />
        {user?.role === "admin" && (
          <ComplianceSettings value={complianceStartDate} onChanged={load} />
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5">
          {/* Left: Run sheet */}
          <div className="rounded-[14px] overflow-hidden card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
              <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>Today's run sheet</h2>
              <span className="font-mono-num text-[12px]" style={{ color: C.textSecondary }}>
                {doneCount} of {sortedToday.length} done
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-[3px]" style={{ backgroundColor: C.rowBorder }}>
              <div className="h-full transition-all duration-300" style={{ width: `${sortedToday.length ? (doneCount / sortedToday.length) * 100 : 0}%`, backgroundColor: C.accent }} />
            </div>
            <div>
              {sortedToday.length === 0 && unmatchedToday.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <div className="mono-label mb-1">Nothing scheduled</div>
                  <p className="text-[13px]" style={{ color: C.textMuted }}>No calendar events for today.</p>
                </div>
              )}
              {sortedToday.map((ev) => {
                const isDone = checked.has(ev.id);
                const tag = eventTag(ev);
                return (
                  <div
                    key={ev.id}
                    className="flex items-center gap-0 px-3 sm:px-5 py-3 transition-colors"
                    style={{ minHeight: "56px", borderTop: `1px solid ${C.rowBorder}`, opacity: isDone ? 0.4 : 1 }}
                  >
                    {/* Time gutter */}
                    <div className="w-[48px] sm:w-[58px] shrink-0 text-right pr-2 sm:pr-3">
                      <span className="font-mono-num text-[13px]" style={{ color: C.textSecondary }}>
                        {ev.start_time || "—"}
                      </span>
                    </div>
                    {/* Divider */}
                    <div className="w-px self-stretch shrink-0" style={{ backgroundColor: C.border }} />
                    {/* Content */}
                    <div className="flex-1 min-w-0 px-2 sm:px-4">
                      <div
                        className="text-[14px] font-medium break-words"
                        style={{
                          color: C.text,
                          textDecoration: isDone ? "line-through" : "none",
                        }}
                      >
                        {ev.job_name || "(untitled)"}
                      </div>
                      <div className="text-[12px] break-words" style={{ color: C.textMuted }}>
                        {ev.address || ev.scope_notes?.slice(0, 80) || ""}
                      </div>
                      <span className="mt-1 inline-flex sm:hidden text-[9px] font-semibold px-2 py-1 rounded-full" style={{ backgroundColor: C.accent18, border: `1px solid ${C.tagBillable.border}`, color: C.accentText }}>{tag}</span>
                    </div>
                    {/* Tag */}
                    <span
                      className="hidden sm:inline-flex text-[9px] font-semibold tracking-[0.01em] px-2 py-1 rounded-full whitespace-nowrap shrink-0"
                      style={{ backgroundColor: C.accent18, border: `1px solid ${C.tagBillable.border}`, color: C.accentText }}
                    >
                      {tag}
                    </span>
                    {/* Checkbox */}
                    <button
                      onClick={() => toggleCheck(ev.id)}
                      title="Checkmarks are for this screen only and are not saved"
                      aria-label={`Mark ${ev.job_name || "event"} ${isDone ? "incomplete" : "done"}`}
                      aria-pressed={isDone}
                      className="ml-1 sm:ml-3 h-10 w-10 rounded-full shrink-0 flex items-center justify-center transition-all"
                      style={{
                        border: isDone ? "none" : `1.5px solid ${C.borderStrong}`,
                        backgroundColor: isDone ? C.accent : "transparent",
                      }}
                    >
                      {isDone && <Check className="h-3.5 w-3.5" style={{ color: C.accentDark }} strokeWidth={3} />}
                    </button>
                  </div>
                );
              })}

              {/* Events synced from the calendars that did not verify against the Sales Tracker.
                  Shown for review instead of hidden, so Today matches the real calendar. */}
              {unmatchedToday.length > 0 && (
                <div>
                  <div className="px-3 sm:px-5 py-2" style={{ borderTop: `1px solid ${C.rowBorder}`, backgroundColor: C.amberLight }}>
                    <span className="mono-label-sm" style={{ color: C.amber }}>
                      Also on today&apos;s calendar &mdash; not matched to the Sales Tracker
                    </span>
                  </div>
                  {unmatchedToday.map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center gap-0 px-3 sm:px-5 py-3"
                      style={{ minHeight: "56px", borderTop: `1px solid ${C.rowBorder}` }}
                    >
                      <div className="w-[48px] sm:w-[58px] shrink-0 text-right pr-2 sm:pr-3">
                        <span className="font-mono-num text-[13px]" style={{ color: C.textSecondary }}>
                          {ev.start_time || "All day"}
                        </span>
                      </div>
                      <div className="w-px self-stretch shrink-0" style={{ backgroundColor: C.border }} />
                      <div className="flex-1 min-w-0 px-2 sm:px-4">
                        <div className="text-[14px] font-medium break-words" style={{ color: C.text }}>
                          {ev.job_name || "(untitled)"}
                        </div>
                        {ev.address && (
                          <div className="text-[12px] break-words" style={{ color: C.textMuted }}>{ev.address}</div>
                        )}
                      </div>
                      <span
                        className="text-[9px] font-semibold tracking-[0.01em] px-2 py-1 rounded-full whitespace-nowrap shrink-0"
                        style={{ backgroundColor: C.tagReview.bg, border: `1px solid ${C.tagReview.border}`, color: C.tagReview.text }}
                      >
                        REVIEW
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right rail */}
          <div className="min-w-0 space-y-4">
            {/* First-up card */}
            {firstUp && (
              <div className="rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.accent, color: "#FFFFFF" }}>
                <div className="mono-label-sm mb-2" style={{ color: "rgba(255,255,255,.60)" }}>First up</div>
                <div className="font-mono-num-bold text-[32px] mb-1" style={{ letterSpacing: "-0.03em" }}>
                  {firstUp.start_time || "All day"}
                </div>
                <div className="text-[15px] font-semibold mb-1 break-words">{firstUp.job_name}</div>
                <div className="text-[12px] mb-3" style={{ color: "rgba(255,255,255,.60)" }}>
                  {crewForEvent(firstUp) ? `Crew: ${crewForEvent(firstUp)}` : ""}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                {firstUp.job_id && (
                  <button type="button" onClick={() => navigate(`/jobs/${firstUp.job_id}`)} className="text-[10px] font-semibold tracking-[0.01em] px-3 py-1.5 rounded-full whitespace-nowrap" style={{ backgroundColor: "rgba(255,255,255,.15)", color: "#FFFFFF" }}>
                    Open job
                  </button>
                )}
                {firstUp.address ? (
                  <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(firstUp.address)}`} target="_blank" rel="noreferrer" className="text-[10px] font-semibold tracking-[0.01em] px-3 py-1.5 rounded-full whitespace-nowrap" style={{ backgroundColor: "#FFFFFF", color: C.accent }}>
                    Directions
                  </a>
                ) : (
                  <button disabled title="No address on file for this event" className="text-[10px] font-semibold tracking-[0.01em] px-3 py-1.5 rounded-full whitespace-nowrap" style={{ backgroundColor: "rgba(255,255,255,.15)", color: "rgba(255,255,255,.45)", cursor: "not-allowed" }}>
                    Directions
                  </button>
                )}
                </div>
              </div>
            )}

            {/* To-do list (server-side access enforced by the todos function; hidden unless this login is allowed) */}
            <DashboardTodos user={user} navigate={navigate} />

            {/* Mini bar chart */}
            <div className="rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-heading text-[13px] font-semibold" style={{ color: C.text }}>Monthly profit</h3>
                <span className="mono-label-sm">8 mo</span>
              </div>
              <div className="flex items-end gap-2 h-[80px]">
                {chartData.length === 0 && (
                  <div className="flex-1 text-center text-[12px] flex items-center justify-center" style={{ color: C.textMuted }}>No data</div>
                )}
                {chartData.map((d, i) => {
                  const max = Math.max(...chartData.map((x) => x.value), 1);
                  const h = (d.value / max) * 100;
                  const opacity = 0.25 + (i / Math.max(chartData.length - 1, 1)) * 0.75;
                  return (
                    <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                      <div className="w-full rounded-[3px] transition-all" style={{ height: `${h}%`, backgroundColor: C.accent, opacity, minHeight: "4px" }} />
                      <span className="text-[8px] tracking-[0.01em] whitespace-nowrap" style={{ color: C.textFaint }}>
                        {d.month.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tomorrow card */}
            <div className="rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-heading text-[13px] font-semibold" style={{ color: C.text }}>Tomorrow</h3>
                <span className="font-mono-num text-[11px]" style={{ color: C.textSecondary }}>
                  {tomorrowEvents.length} {tomorrowEvents.length === 1 ? "item" : "items"}
                </span>
              </div>
              {tomorrowEvents.length === 0 ? (
                <p className="text-[12px]" style={{ color: C.textMuted }}>Nothing scheduled</p>
              ) : (
                <div className="space-y-2">
                  {tomorrowEvents.slice(0, 3).map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2">
                      <span className="font-mono-num text-[12px] w-[52px] shrink-0" style={{ color: C.textSecondary }}>
                        {ev.start_time || "—"}
                      </span>
                      <span className="text-[13px] truncate" style={{ color: C.text }}>{ev.job_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardTodos({ user, navigate }) {
  // Access is enforced server-side by the todos function; useTodoAccess only
  // decides whether this card renders. Other logins never receive the data.
  const allowed = useTodoAccess(user);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const r = await base44.functions.invoke("todos", { action: "board", member_id: "mine" });
      if (r.data?.error) throw new Error(r.data.error);
      setData(r.data);
      setError("");
    } catch (e2) {
      setError(e2?.response?.data?.error || e2?.message || "To-do list could not load.");
    }
  }, [allowed]);

  useEffect(() => { load(); }, [load]);

  if (!allowed) return null;

  // Same urgency order as the board: overdue, due today, due soon, then oldest first.
  const todoToday = denverDate();
  const tasks = sortByUrgency((data?.tasks || []).filter((t) => t.status !== "done" && !t.archived_at), todoToday);
  const overdueCount = tasks.filter((t) => dueState(t, todoToday) === "overdue").length;
  const shown = tasks.slice(0, 6);

  const markDone = async (t) => {
    setBusyId(t.id);
    setError("");
    try {
      const r = await base44.functions.invoke("todos", { action: "update_task", id: t.id, expected_revision: t.revision, patch: { status: "done" } });
      if (r.data?.error) throw new Error(r.data.error);
      await load();
    } catch (e2) {
      setError(e2?.response?.data?.error || e2?.message || "Could not update the task. Reload before retrying.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="rounded-[14px] overflow-hidden card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
        <h3 className="font-heading text-[13px] font-semibold flex items-center gap-2" style={{ color: C.text }}>
          <ListTodo className="h-4 w-4" />
          To-do
          {overdueCount > 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ backgroundColor: "#A43432" }}>{overdueCount} overdue</span>}
        </h3>
        <button
          onClick={() => navigate("/todos")}
          className="text-[11px] font-semibold"
          style={{ color: C.accent }}
        >
          Open full list
        </button>
      </div>
      <div className="px-5 py-3">
        {error && <p role="alert" className="mb-2 text-[12px] text-red-700">{error}</p>}
        {!data && !error && <p className="text-[12px] py-2" style={{ color: C.textMuted }}>Loading tasks...</p>}
        {data && shown.length === 0 && (
          <p className="text-[12px] py-2" style={{ color: C.textMuted }}>No open tasks. Add one from the full list.</p>
        )}
        <div className="space-y-1">
          {shown.map((t) => (
            <div key={t.id} className="flex items-start gap-2.5 py-1.5">
              <button
                onClick={() => markDone(t)}
                disabled={busyId === t.id}
                aria-label={`Mark ${t.title} done`}
                className="mt-0.5 h-5 w-5 rounded-full shrink-0 flex items-center justify-center transition-all disabled:opacity-40"
                style={{ border: `1.5px solid ${C.borderStrong}`, backgroundColor: "transparent" }}
              >
                {busyId === t.id && <div className="h-2.5 w-2.5 border rounded-full animate-spin" style={{ borderColor: C.borderStrong, borderTopColor: C.accent }} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium break-words" style={{ color: C.text }}>{t.title}</div>
                <div className="text-[11px]" style={{ color: dueState(t, todoToday) === "overdue" ? "#A43432" : C.textMuted }}>
                  {[laneLabel(laneKey(t)), t.status === "in_progress" ? "In progress" : "", t.due_date ? `${dueState(t, todoToday) === "overdue" ? "Overdue · was due" : "Due"} ${t.due_date}` : ""].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
        {data && tasks.length > shown.length && (
          <button onClick={() => navigate("/todos")} className="mt-1 text-[11px] font-medium" style={{ color: C.textSecondary }}>
            +{tasks.length - shown.length} more on the full list
          </button>
        )}
      </div>
    </div>
  );
}

function KpiCard({ label, value, valueColor, sub, subColor }) {
  return (
    <div className="min-w-0 rounded-[14px] p-3 sm:p-4 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="mono-label-sm mb-2">{label}</div>
      <div className="font-mono-num-bold text-[20px] sm:text-[24px] mb-1 [overflow-wrap:anywhere]" style={{ color: valueColor || C.text, letterSpacing: "-0.025em" }}>
        {value}
      </div>
      {sub && (
        <div className="text-[11px] break-words" style={{ color: subColor || C.textMuted }}>
          {sub}
        </div>
      )}
    </div>
  );
}
