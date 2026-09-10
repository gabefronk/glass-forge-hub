const STYLES = {
  queued: { label: "Queued", cls: "bg-slate-100 text-slate-600" },
  running: { label: "Running", cls: "bg-blue-50 text-blue-700" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700" },
  blocked: { label: "Blocked", cls: "bg-amber-50 text-amber-800" },
  skipped: { label: "Skipped", cls: "bg-slate-100 text-slate-500" },
};
export default function RunStateBadge({ state }) {
  const s = STYLES[state] || STYLES.queued;
  return (
    <span className={"inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " + s.cls}>
      {state === "running" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {s.label}
    </span>
  );
}