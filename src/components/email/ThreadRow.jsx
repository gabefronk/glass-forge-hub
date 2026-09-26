import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Clock, ExternalLink, Link2, Paperclip, RefreshCw, RotateCcw, Send, Trash2, X, XCircle } from "lucide-react";
import { C } from "@/lib/feeUI";
import { OPEN_STATUSES, categoryLabel, categoryTone, draftState, priorityColor, providerLabel, relativeTime, statusLabel } from "@/lib/emailInbox";
import { btnBase, btnDanger, btnNeutral, btnPrimary } from "@/components/email/emailApi";
import JobPickerInline from "@/components/email/JobPickerInline";
import ThreadDetail from "@/components/email/ThreadDetail";

const TONES = { teal: C.tagBillable, amber: C.tagReview, neutral: C.tagNoCharge, faint: { bg: "#F4F1EA", text: "#8A8F93", border: "#E2DCD1" }, blocked: C.tagBlocked };
export function Chip({ tone = "neutral", children, className = "" }) {
  const t = TONES[tone] || TONES.neutral;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold whitespace-nowrap ${className}`} style={{ backgroundColor: t.bg, color: t.text, border: `1px solid ${t.border}` }}>{children}</span>;
}

// One thread in the inbox list. The top block toggles the conversation; the buttons
// under it act on the thread (job link, draft, status, open in the mail client).
export default function ThreadRow({ thread: t, provider, expanded, onToggle, onAction, busy, isAdmin, rowRef }) {
  const [picking, setPicking] = useState(false);
  const draft = draftState(t);
  const open = OPEN_STATUSES.includes(t.status);
  const stop = (e) => e.stopPropagation();
  const act = (payload, patch) => onAction(payload, patch);
  const setStatus = (status) => act({ action: "set_status", id: t.id, status }, { status });
  const linkJob = (job) => { setPicking(false); act({ action: "link_job", id: t.id, job_id: job.id }, { job_id: job.id, job_name: job.name || t.job_name }); };
  const sendDraft = () => {
    if (!window.confirm(`Send the drafted reply to ${t.from_name || t.from_email || "this thread"}?\n\n"${(t.draft_preview || "").slice(0, 240)}${(t.draft_preview || "").length > 240 ? "…" : ""}"`)) return;
    act({ action: "send_draft", id: t.id }, { draft_status: "sent", status: "waiting" });
  };
  const keyToggle = (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onToggle(); } };

  return (
    <article ref={rowRef} className="card-shadow rounded-[14px] bg-white" style={{ border: `1px solid ${expanded ? "var(--gf-teal-500)" : C.border}` }} aria-label={t.subject || "Email thread"}>
      <div role="button" tabIndex={0} aria-expanded={expanded} onClick={onToggle} onKeyDown={keyToggle} className="cursor-pointer px-4 pt-3 pb-2 max-[699px]:px-3">
        <div className="flex items-start gap-3">
          <span className="mt-[7px] h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: priorityColor(t.priority) }} title={`Priority: ${t.priority || "normal"}`} aria-label={`Priority ${t.priority || "normal"}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="m-0 min-w-0 truncate text-[14.5px] font-bold" style={{ color: C.text }}>{t.subject || "(no subject)"}</h3>
              <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] tabular-nums" style={{ color: C.textFaint }}>{relativeTime(t.last_message_at)}<ChevronDown className="h-3.5 w-3.5 transition-transform" style={{ transform: expanded ? "rotate(180deg)" : "none" }} /></span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px]" style={{ color: C.textMuted }}>
              <span className="truncate">{t.from_name || t.from_email || "Unknown sender"}{t.account_hint ? ` · ${t.account_hint}` : ""}{t.message_count > 1 ? ` · ${t.message_count} msgs` : ""}</span>
              {t.has_attachments ? <Paperclip className="h-3 w-3 shrink-0" /> : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Chip tone={categoryTone(t.category)}>{categoryLabel(t.category)}</Chip>
              {!open ? <Chip tone={t.status === "done" ? "teal" : "faint"}>{statusLabel(t.status)}</Chip> : t.status === "waiting" ? <Chip tone="neutral"><Clock className="h-3 w-3" />Waiting</Chip> : null}
              {draft ? <Chip tone={draft.tone}>{draft.label}</Chip> : null}
              {t.job_id ? (
                <span className="inline-flex items-center gap-0.5">
                  <Link to={`/jobs/${t.job_id}`} onClick={stop} className="inline-flex min-h-7 items-center gap-1 rounded-full pl-2 pr-2.5 text-[11px] font-semibold hover:underline" style={{ backgroundColor: "var(--gf-teal-050)", color: C.accentText, border: `1px solid ${C.tagBillable.border}` }}><Link2 className="h-3 w-3" />{t.job_name || "Linked job"}</Link>
                  <button type="button" onClick={(e) => { stop(e); act({ action: "unlink_job", id: t.id }, { job_id: null, job_name: null }); }} disabled={busy} aria-label="Unlink job" title="Unlink job" className="inline-flex h-7 w-7 items-center justify-center rounded-full disabled:opacity-50" style={{ color: C.textFaint }}><X className="h-3 w-3" /></button>
                </span>
              ) : (
                <button type="button" onClick={(e) => { stop(e); setPicking((v) => !v); }} disabled={busy} className="inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold disabled:opacity-50" style={{ backgroundColor: C.cardAlt, color: C.accentText, border: `1px dashed ${C.border}` }}><Link2 className="h-3 w-3" />{t.job_candidates?.length ? `Link job (${t.job_candidates.length} suggested)` : "Link job"}</button>
              )}
            </div>
            {t.summary ? <p className="m-0 mt-1.5 text-[13px] leading-[19px]" style={{ color: C.textSecondary }}>{t.summary}</p> : t.snippet ? <p className="m-0 mt-1.5 truncate text-[12.5px]" style={{ color: C.textMuted }}>{t.snippet}</p> : null}
            {t.action_items?.length ? (
              <ul className="m-0 mt-1.5 list-disc space-y-0.5 pl-5 text-[12.5px]" style={{ color: C.text }}>{t.action_items.slice(0, 5).map((a, i) => <li key={i}>{typeof a === "string" ? a : a?.text || a?.title || JSON.stringify(a)}</li>)}</ul>
            ) : null}
            {draft && t.draft_preview && !expanded ? <p className="m-0 mt-1.5 truncate text-[12px] italic" style={{ color: C.textMuted }}>Draft: {t.draft_preview}</p> : null}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 max-[699px]:px-3" onClick={stop}>
        {draft?.key === "drafted" ? (
          <>
            {t.web_link ? <a href={t.web_link} target="_blank" rel="noreferrer" className={btnBase} style={btnNeutral}><ExternalLink className="h-3.5 w-3.5" />Open draft</a> : null}
            {isAdmin ? <button type="button" disabled={busy} onClick={sendDraft} className={btnBase} style={btnPrimary}><Send className="h-3.5 w-3.5" />Send</button> : null}
            <button type="button" disabled={busy} onClick={() => act({ action: "regenerate_draft", id: t.id }, {})} className={btnBase} style={btnNeutral}><RefreshCw className="h-3.5 w-3.5" />Regenerate</button>
            <button type="button" disabled={busy} onClick={() => act({ action: "discard_draft", id: t.id }, { draft_status: "discarded", draft_preview: "" })} className={btnBase} style={btnDanger}><Trash2 className="h-3.5 w-3.5" />Discard</button>
          </>
        ) : open && (t.reply_needed || draft?.key === "discarded") ? (
          <button type="button" disabled={busy} onClick={() => act({ action: "regenerate_draft", id: t.id }, {})} className={btnBase} style={btnNeutral}><RefreshCw className="h-3.5 w-3.5" />{draft ? "Regenerate draft" : "Draft reply"}</button>
        ) : null}
        {open ? (
          <>
            <button type="button" disabled={busy} onClick={() => setStatus("done")} className={btnBase} style={btnNeutral}><Check className="h-3.5 w-3.5" />Done</button>
            {t.status !== "waiting" ? <button type="button" disabled={busy} onClick={() => setStatus("waiting")} className={btnBase} style={btnNeutral}><Clock className="h-3.5 w-3.5" />Waiting</button> : null}
            <button type="button" disabled={busy} onClick={() => setStatus("ignored")} className={btnBase} style={btnNeutral}><XCircle className="h-3.5 w-3.5" />Ignore</button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => setStatus("new")} className={btnBase} style={btnNeutral}><RotateCcw className="h-3.5 w-3.5" />Reopen</button>
        )}
        {t.web_link ? <a href={t.web_link} target="_blank" rel="noreferrer" className={`${btnBase} ml-auto`} style={{ ...btnNeutral, border: "none", color: C.accentText }}><ExternalLink className="h-3.5 w-3.5" />Open in {providerLabel(provider)}</a> : null}
      </div>
      {picking ? <div className="px-4 pb-3 max-[699px]:px-3"><JobPickerInline candidates={t.job_candidates || []} busy={busy} onPick={linkJob} onClose={() => setPicking(false)} /></div> : null}
      {expanded ? <div className="px-4 pb-4 max-[699px]:px-3"><ThreadDetail thread={t} onAction={onAction} busy={busy} /></div> : null}
    </article>
  );
}
