import { useEffect, useState, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { Search, RefreshCw, Play, Pause, Ban, ChevronDown, ChevronRight, LockKeyhole, FlaskConical, AlertCircle, CheckCircle2, Clock3 } from "lucide-react";

const STATUS_TONE = {
  queued: { bg: "var(--gf-tile-slate)", ink: "var(--gf-tile-slate-ink)", label: "Queued" },
  claimed: { bg: "var(--gf-tile-sand)", ink: "var(--gf-tile-sand-ink)", label: "Claimed" },
  cancel_requested: { bg: "var(--gf-amber-100)", ink: "var(--gf-amber-700)", label: "Cancel requested" },
  review_ready: { bg: "var(--gf-tile-teal)", ink: "var(--gf-tile-teal-ink)", label: "Review ready" },
  failed: { bg: "var(--gf-error-bg)", ink: "var(--gf-error)", label: "Failed" },
  cancelled: { bg: "var(--gf-tile-stone)", ink: "var(--gf-tile-stone-ink)", label: "Cancelled" },
};
const tone = s => STATUS_TONE[s] || { bg: "var(--gf-tile-stone)", ink: "var(--gf-tile-stone-ink)", label: s || "Unknown" };
const when = v => v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export default function ResearchQueue() {
  const { user } = useAuth();
  const owner = isAgentCenterOwner(user);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await base44.functions.invoke("research-queue", { action: "status" });
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Queue unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (owner) refresh(); }, [owner, refresh]);

  const action = async (payload, label) => {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const r = await base44.functions.invoke("research-queue", payload);
      const d = r.data || {};
      if (d.task) setNotice(`Task ${d.task.task_id?.slice(0, 8)}… is now ${d.task.status}.`);
      else if (typeof d.paused === "boolean") setNotice(d.paused ? "Queue paused." : "Queue resumed.");
      else if (d.duplicate) setNotice("Canary already queued (duplicate).");
      else setNotice("Done.");
      await refresh();
    } catch (e) {
      setError(e.response?.data?.error || e.message || "Request failed.");
    } finally {
      setBusy("");
    }
  };

  if (!owner) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <LockKeyhole className="mb-4 h-6 w-6" style={{ color: "var(--gf-ink-2)" }} />
        <h1 className="text-xl font-semibold" style={{ color: "var(--gf-ink)" }}>Owner access required</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--gf-ink-2)" }}>The research queue is private to authorized Glass Forge accounts.</p>
      </div>
    );
  }

  const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
  const paused = !!data?.paused;
  const canaryCount = tasks.filter(t => t.purpose === "synthetic" || t.job_name === "Synthetic queue verification").length;

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-32 sm:p-6" style={{ color: "var(--gf-ink)" }}>
      {/* Header */}
      <header className="rounded-2xl p-5 sm:p-6" style={{ backgroundColor: "var(--gf-sidebar-top)", boxShadow: "var(--shadow-float)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-widest" style={{ color: "var(--gf-sidebar-muted)" }}>
              <LockKeyhole className="h-3.5 w-3.5" /> Private · Owner access
            </p>
            <h1 className="mt-2.5 text-2xl font-semibold sm:text-3xl" style={{ color: "var(--gf-sidebar-text-on)" }}>Research Queue</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: "var(--gf-sidebar-text)" }}>
              Durable, review-only work queue for the local Hermes worker. Supplied-context only — no messages, source mutation, or external retrieval. Results are untrusted owner-review drafts.
            </p>
          </div>
          <button onClick={refresh} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl border px-4 text-sm disabled:opacity-50" style={{ borderColor: "rgba(255,255,255,.15)", color: "var(--gf-sidebar-text-on)" }}>
            <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} /> {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 border-t pt-4 sm:grid-cols-4" style={{ borderColor: "rgba(255,255,255,.08)" }}>
          {[
            { label: "Protocol", value: data?.protocol_version?.slice(0, 20) || "—" },
            { label: "Worker", value: data?.worker_id || "—" },
            { label: "State", value: paused ? "Paused" : "Active" },
            { label: "Retained", value: `${data?.retained_tasks ?? 0} / ${data?.capacity ?? 20}` },
          ].map(s => (
            <div key={s.label}>
              <p className="text-[11px] uppercase tracking-wider" style={{ color: "var(--gf-sidebar-muted)" }}>{s.label}</p>
              <p className="mt-1 text-sm font-medium font-ref break-all" style={{ color: "var(--gf-sidebar-text-on)" }}>{s.value}</p>
            </div>
          ))}
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border p-4 text-sm" style={{ borderColor: "var(--gf-error-border)", backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)" }}>
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-3 rounded-xl border p-4 text-sm" style={{ borderColor: "var(--gf-ready-border)", backgroundColor: "var(--gf-ready-bg)", color: "var(--gf-ready)" }}>
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> {notice}
        </div>
      )}

      {/* Controls */}
      <section className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: "var(--gf-card)", borderColor: "var(--gf-border)", boxShadow: "var(--shadow-card)" }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Controls</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--gf-ink-2)" }}>
              {paused ? "Queue is paused — worker claims are held." : "Queue is active — worker may claim queued tasks."}
              {data?.active_task_id ? ` Active assignment: ${data.active_task_id.slice(0, 8)}…` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => action({ action: "enqueue_canary" }, "canary")}
              disabled={!!busy}
              className="flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: "var(--gf-card)", borderColor: "var(--gf-border)", color: "var(--gf-ink)" }}
            >
              <FlaskConical className="h-4 w-4" style={{ color: "var(--gf-teal-600)" }} /> Enqueue canary
            </button>
            <button
              onClick={() => action({ action: "set_paused", paused: !paused }, paused ? "resume" : "pause")}
              disabled={!!busy}
              className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: paused ? "var(--gf-teal-600)" : "var(--gf-amber-500)" }}
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />} {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
        {data?.last_worker_seen_at && (
          <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: "var(--gf-ink-3)" }}>
            <Clock3 className="h-3.5 w-3.5" /> Last worker seen {when(data.last_worker_seen_at)}
          </p>
        )}
      </section>

      {/* Task list */}
      <section className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: "var(--gf-card)", borderColor: "var(--gf-border)", boxShadow: "var(--shadow-card)" }}>
        <h2 className="mb-4 text-base font-semibold">Tasks ({tasks.length})</h2>
        {!tasks.length && (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm" style={{ borderColor: "var(--gf-border)", color: "var(--gf-ink-3)" }}>
            No tasks queued. Enqueue a canary to verify the worker connection.
          </div>
        )}
        <div className="space-y-2.5">
          {tasks.map(t => {
            const st = tone(t.status);
            const isOpen = expanded === t.task_id;
            const isCanary = t.purpose === "synthetic" || t.job_name === "Synthetic queue verification";
            const terminal = ["review_ready", "failed", "cancelled"].includes(t.status);
            return (
              <div key={t.task_id} className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--gf-border)", backgroundColor: "var(--gf-card-band)", boxShadow: "var(--shadow-row)" }}>
                <div className="flex items-center gap-3 p-3.5">
                  <button onClick={() => setExpanded(isOpen ? null : t.task_id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: "var(--gf-ink-3)" }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--gf-ink-3)" }} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isCanary && <FlaskConical className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--gf-brass-400)" }} />}
                        <span className="truncate text-sm font-medium">{t.job_name || "Unknown job"}</span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs" style={{ color: "var(--gf-ink-3)" }}>
                        <span className="font-ref">{t.task_id?.slice(0, 12)}…</span>
                        <span>·</span>
                        <span>{t.purpose || "—"}</span>
                        <span>·</span>
                        <span>{when(t.created_at)}</span>
                      </div>
                    </div>
                  </button>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" style={{ backgroundColor: st.bg, color: st.ink }}>{st.label}</span>
                  {!terminal && (
                    <button
                      onClick={() => action({ action: "cancel", task_id: t.task_id }, "cancel:" + t.task_id)}
                      disabled={!!busy}
                      className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium disabled:opacity-50"
                      style={{ borderColor: "var(--gf-border)", color: "var(--gf-ink-2)" }}
                    >
                      <Ban className="h-3.5 w-3.5" /> Cancel
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="border-t p-4 space-y-3" style={{ borderColor: "var(--gf-hairline)", backgroundColor: "var(--gf-card)" }}>
                    <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                      {[
                        ["Task ID", t.task_id],
                        ["Request key", t.request_key?.slice(0, 16) + "…"],
                        ["Job ID", t.job_id || "—"],
                        ["Lease expires", when(t.lease_expires_at)],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <p className="font-medium" style={{ color: "var(--gf-ink-3)" }}>{k}</p>
                          <p className="mt-0.5 font-ref break-all" style={{ color: "var(--gf-ink)" }}>{v}</p>
                        </div>
                      ))}
                    </div>
                    {t.result && (
                      <div>
                        <p className="text-xs font-medium mb-1" style={{ color: "var(--gf-ink-3)" }}>Result</p>
                        <pre className="rounded-lg p-3 text-xs overflow-x-auto" style={{ backgroundColor: "var(--gf-field)", color: "var(--gf-ink)" }}>{JSON.stringify(t.result, null, 2)}</pre>
                      </div>
                    )}
                    {t.error && (
                      <div>
                        <p className="text-xs font-medium mb-1" style={{ color: "var(--gf-error)" }}>Error</p>
                        <pre className="rounded-lg p-3 text-xs overflow-x-auto" style={{ backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)" }}>{JSON.stringify(t.error, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <p className="text-center text-xs" style={{ color: "var(--gf-ink-3)" }}>
        {data?.protocol_version || "research-queue-20260913-v1"} · automatic_send_allowed: false · owner review only
      </p>
    </div>
  );
}