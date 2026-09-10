import { Activity, Pause, Play, RefreshCw, Loader2 } from "lucide-react";
import { formatTime } from "@/lib/agentDailyRuns";

export default function AutonomousBanner({ enabled, paused, nextRun, lastRunAt, busy, onTogglePause, onRunAll }) {
  const state = !enabled
    ? { label: "Autonomous operations disabled", cls: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" }
    : paused
    ? { label: "Autonomous operations paused", cls: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" }
    : { label: "Autonomous operations enabled", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" };
  return (
    <div className={"flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 " + state.cls}>
      <div className="flex items-center gap-3">
        <span className={"h-2.5 w-2.5 rounded-full " + state.dot + (enabled && !paused ? " animate-pulse" : "")} />
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Activity className="h-4 w-4" />{state.label}</p>
          <p className="mt-0.5 text-xs opacity-80">Scheduled daily at 07:00 MT · next run {nextRun.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{lastRunAt ? <> · last run {formatTime(lastRunAt)}</> : ""}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={onTogglePause} disabled={!!busy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-current/20 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">
          {paused ? <><Play className="h-3.5 w-3.5" />Resume</> : <><Pause className="h-3.5 w-3.5" />Pause</>}
        </button>
        <button onClick={onRunAll} disabled={!!busy} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#2A5EA8] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {busy === "all" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Run all now
        </button>
      </div>
    </div>
  );
}