import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Link2, RefreshCw, Trash2, XCircle } from "lucide-react";
import { C } from "@/lib/feeUI";
import { OPEN_STATUSES, categoryLabel, categoryTone, draftState, needsJobPick, priorityColor, providerLabel, relativeTime, statusLabel } from "@/lib/inboxAgents";
import { btnBase, btnDanger, btnNeutral, btnPrimary } from "@/components/inbox/inboxApi";
import JobPickerInline from "@/components/inbox/JobPickerInline";

const TONES = { teal: C.tagBillable, amber: C.tagReview, neutral: C.tagNoCharge, faint: { bg: "#F4F1EA", text: "#8A8F93", border: "#E2DCD1" } };
export function Chip({ tone = "neutral", children, className = "" }) {
  const t = TONES[tone] || TONES.neutral;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${className}`} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }}>{children}</span>;
}

// One ledger entry: what the agent concluded about a thread and what it changed in the Hub.
// The mail itself is never here — "Open in Gmail/Outlook" is the way to read it.
export default function RelayRow({ entry: e, provider, onAction, busy }) {
  const [picking, setPicking] = useState(false);
  const draft = draftState(e, provider);
  const open = OPEN_STATUSES.includes(e.status);
  const act = (payload, patch) => onAction(payload, patch);
  const setStatus = (status) => act({ action: "set_status", id: e.id, status }, { status });
  const linkJob = (job) => { setPicking(false); act({ action: "link_job", id: e.id, job_id: job.id }, { job_id: job.id, job_name: job.name || e.job_name, job_match_confidence: "high" }); };
  const changes = Array.isArray(e.hub_changes) ? e.hub_changes : [];
  const pick = needsJobPick(e);

  return (
    <article className="card-shadow rounded-[14px] bg-white px-4 pt-3 pb-3 max-[699px]:px-3" style={{ border: `1px solid ${pick ? "var(--gf-amber-500)" : C.border}` }} aria-label={e.subject || "Email"}>
      <div className="flex items-start gap-3">
        <span className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: priorityColor(e.priority) }} title={`Priority: ${e.priority || "normal"}`} aria-label={`Priority ${e.priority || "normal"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="m-0 min-w-0 truncate text-[14.5px] font-bold" style={{ color: C.text }}>{e.subject || "(no subject)"}</h3>
            <span className="shrink-0 text-[11.5px] tabular-nums" style={{ color: C.textFaint }}>{relativeTime(e.last_message_at)}</span>
          </div>
          <p className="m-0 mt-0.5 truncate text-[12px]" style={{ color: C.textMuted }}>
            {e.from_name || e.from_email || "unknown sender"}{e.from_name && e.from_email ? ` · ${e.from_email}` : ""}{e.account_hint ? ` → ${e.account_hint}` : ""}
          </p>
          {e.summary ? <p className="m-0 mt-1.5 text-[13px] leading-snug" style={{ color: C.textSecondary }}>{e.summary}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip tone={categoryTone(e.category)}>{categoryLabel(e.category)}</Chip>
            <Chip tone={open ? "teal" : "neutral"}>{statusLabel(e.status) || "New"}</Chip>
            {e.job_id ? <Chip tone="teal"><Link2 className="h-3 w-3" />{e.job_name || "Linked job"}</Chip> : pick ? <Chip tone="amber">Which job?</Chip> : null}
            {draft ? <Chip tone={draft.tone}>{draft.label}</Chip> : null}
            {e.archived ? <Chip tone="faint">Archived</Chip> : null}
          </div>
          {changes.length ? (
            <ul className="m-0 mt-2 list-none space-y-0.5 p-0 text-[12px]" style={{ color: C.text }} aria-label="Hub changes">
              {changes.slice(-6).map((c, i) => <li key={i} className="flex items-start gap-1.5"><Check className="mt-[3px] h-3 w-3 shrink-0" style={{ color: "var(--gf-teal-600)" }} />{c}</li>)}
            </ul>
          ) : null}
          {Array.isArray(e.action_items) && e.action_items.length ? (
            <p className="m-0 mt-1.5 text-[12px]" style={{ color: C.textMuted }}>To do: {e.action_items.join(" · ")}</p>
          ) : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {e.web_link ? <a href={e.web_link} target="_blank" rel="noopener noreferrer" className={btnBase} style={btnPrimary}><ExternalLink className="h-3.5 w-3.5" />Open in {providerLabel(provider)}</a> : null}
            {e.job_id ? <Link to={`/jobs/${e.job_id}`} className={btnBase} style={btnNeutral}>Open job</Link> : null}
            <button type="button" disabled={busy} onClick={() => setPicking((v) => !v)} className={btnBase} style={btnNeutral}><Link2 className="h-3.5 w-3.5" />{e.job_id ? "Change job" : "Pick job"}</button>
            {e.job_id ? <button type="button" disabled={busy} onClick={() => act({ action: "unlink_job", id: e.id }, { job_id: null, job_name: "" })} className={btnBase} style={btnNeutral}>Unlink</button> : null}
            {open ? <button type="button" disabled={busy} onClick={() => setStatus("done")} className={btnBase} style={btnNeutral}><Check className="h-3.5 w-3.5" />Done</button> : <button type="button" disabled={busy} onClick={() => setStatus("new")} className={btnBase} style={btnNeutral}>Reopen</button>}
            {open && e.status !== "ignored" ? <button type="button" disabled={busy} onClick={() => setStatus("ignored")} className={btnBase} style={btnNeutral}><XCircle className="h-3.5 w-3.5" />Ignore</button> : null}
            {draft?.key === "drafted" ? <button type="button" disabled={busy} onClick={() => act({ action: "discard_draft", id: e.id }, { draft_status: "discarded" })} className={btnBase} style={btnDanger}><Trash2 className="h-3.5 w-3.5" />Discard draft</button> : null}
            {e.reply_needed && draft?.key !== "drafted" ? <button type="button" disabled={busy} onClick={() => act({ action: "regenerate_draft", id: e.id }, { draft_status: "drafted" })} className={btnBase} style={btnNeutral}><RefreshCw className="h-3.5 w-3.5" />Draft a reply</button> : null}
          </div>
          {picking ? <JobPickerInline candidates={e.job_candidates || []} onPick={linkJob} onClose={() => setPicking(false)} busy={busy} /> : null}
        </div>
      </div>
    </article>
  );
}
