import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Mail, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import { canViewEmail, categoryLabel, categoryTone, errorText, relativeTime, statusLabel, threadsForJob } from "@/lib/emailInbox";
import { emailCall } from "@/components/email/emailApi";
import { Chip } from "@/components/email/ThreadRow";

// Owner/manager card on the job page: email threads the inbox agents linked to this
// job (or any of its duplicate records). The list is asked for by job_id and filtered
// again here, so it is right whether or not the backend honors that parameter.
export default function JobEmailThreads({ jobId, memberIds }) {
  const { user } = useAuth();
  const allowed = canViewEmail(user);
  const memberKey = [...new Set([jobId, ...(memberIds || [])])].filter(Boolean).sort().join(",");
  const [state, setState] = useState({ loading: allowed, error: "", threads: [] });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    if (!allowed) return () => { active = false; };
    const ids = memberKey.split(",").filter(Boolean);
    setState((s) => ({ ...s, loading: true, error: "" }));
    emailCall({ action: "list", job_id: jobId, limit: 300 })
      .then((r) => { if (active) setState({ loading: false, error: "", threads: threadsForJob(r.threads || [], ids) }); })
      .catch((e) => { if (active) setState({ loading: false, error: errorText(e, "Email threads could not be loaded."), threads: [] }); });
    return () => { active = false; };
  }, [jobId, memberKey, allowed, tick]);

  if (!allowed) return null;
  const { loading, error, threads } = state;

  return (
    <section aria-labelledby="job-email-heading" className="mt-5 overflow-hidden rounded-[14px] card-shadow" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ background: C.headerBg, borderBottom: `1px solid ${C.border}` }}>
        <div>
          <div className="flex items-center gap-2"><Mail className="h-4 w-4" style={{ color: C.accentText }} /><h2 id="job-email-heading" className="font-heading text-[16px] font-bold" style={{ color: C.text }}>Email</h2></div>
          <p className="mt-1 text-[11px]" style={{ color: C.textMuted }}>Threads the inbox agents linked to this job.</p>
        </div>
        <button type="button" onClick={() => setTick((n) => n + 1)} disabled={loading} aria-label="Refresh email threads" className="inline-flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-50" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
      </div>
      <div className="p-4">
        {error ? <p role="alert" className="text-[13px]" style={{ color: "var(--gf-error)" }}>{error}</p> : null}
        {loading ? <p className="text-[12px]" style={{ color: C.textMuted }}>Loading…</p> : null}
        {!loading && !error && !threads.length ? <p className="text-[12px]" style={{ color: C.textFaint }}>No email threads are linked to this job yet. Link one from the <Link to="/email" className="underline" style={{ color: C.accentText }}>Email tab</Link>.</p> : null}
        <ul className="space-y-1.5">
          {threads.map((t) => (
            <li key={t.id}>
              <Link to={`/email?thread=${encodeURIComponent(t.id)}`} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--gf-hover)]" style={{ border: `1px solid ${C.rowBorder}` }}>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium" style={{ color: C.text }}>{t.subject || "(no subject)"}</span>
                  <span className="block truncate text-[11px]" style={{ color: C.textMuted }}>{t.from_name || t.from_email || "Unknown sender"} · {relativeTime(t.last_message_at)}{t.status && t.status !== "new" ? ` · ${statusLabel(t.status)}` : ""}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2"><Chip tone={categoryTone(t.category)}>{categoryLabel(t.category)}</Chip><ArrowUpRight className="h-3.5 w-3.5" style={{ color: C.textMuted }} /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
