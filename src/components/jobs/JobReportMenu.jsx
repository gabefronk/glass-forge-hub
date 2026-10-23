import { useMemo, useState } from "react";
import { EllipsisVertical, Mail, Copy, Check, X } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { composeJobReport, classifyReportEntry, REPORT_OPT_IN } from "@/lib/jobReportEmail";

// Three-dot "Email report" menu for a job: builds the timeline + photos email
// for the whole job or one day and opens a review sheet. Recipient is chosen
// here and every line is reviewed before anything leaves; there is deliberately
// no send action - the Outlook draft path waits on Gabriel's send-path choice,
// so for now the report copies to the clipboard for him to paste.
export default function JobReportMenu({ job, entries, tone = "hero" }) {
  const [open, setOpen] = useState(false);
  const days = useMemo(() => {
    const set = new Set();
    for (const e of entries || []) if (classifyReportEntry(e) !== "private") set.add(e.date);
    return [...set].sort();
  }, [entries]);
  const [scope, setScope] = useState({ kind: "job" });
  const [picked, setPicked] = useState(() => new Set());
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);

  const optInNotes = useMemo(() => (entries || []).filter((e) => e.kind === "note" && classifyReportEntry(e) === REPORT_OPT_IN && (scope.kind === "day" ? e.date === scope.date : true)), [entries, scope]);
  const report = useMemo(() => composeJobReport({ job, entries, scope, selectedNoteIds: [...picked] }), [job, entries, scope, picked]);
  const [editedText, setEditedText] = useState(null);
  const text = editedText ?? report.text;
  const regenerate = (fn) => { fn(); setEditedText(null); };

  const toggleNote = (id) => regenerate(() => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }));
  const copy = async () => {
    try { await navigator.clipboard.writeText(`To: ${to}\nSubject: ${report.subject}\n\n${text}`); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard denied: text stays selected */ }
  };

  const triggerCls = tone === "hero"
    ? "inline-flex h-9 w-9 items-center justify-center rounded-[9px]"
    : "inline-flex h-7 w-7 items-center justify-center rounded-[7px]";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label="Job report options" className={triggerCls}
            style={tone === "hero" ? { backgroundColor: "rgba(255,255,255,.09)", color: "#c9d0d1", border: "1px solid rgba(255,255,255,.12)" } : { backgroundColor: "rgba(8,47,44,.06)", color: "#3e5a55", border: "1px solid rgba(8,47,44,.12)" }}>
            <EllipsisVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setOpen(true)}><Mail className="mr-2 h-4 w-4" />Email report</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[560px] max-h-[85vh] overflow-y-auto" aria-describedby={undefined}>
          <div className="flex items-center justify-between">
            <h3 className="m-0 text-[17px] font-bold" style={{ color: "#082f2c" }}>Email report</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-[7px]" style={{ color: "#53615B" }}><X className="h-4 w-4" /></button>
          </div>

          <label className="block text-[12px] font-semibold" style={{ color: "#53615B" }}>To
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" inputMode="email" className="mt-1 h-10 w-full rounded-[9px] px-3 text-[14px] outline-none" style={{ border: "1px solid #DDE0DA" }} />
          </label>

          <label className="block text-[12px] font-semibold" style={{ color: "#53615B" }}>Scope
            <select value={scope.kind === "day" ? scope.date : "job"} onChange={(e) => regenerate(() => setScope(e.target.value === "job" ? { kind: "job" } : { kind: "day", date: e.target.value }))} className="mt-1 h-10 w-full rounded-[9px] px-2 text-[14px] outline-none" style={{ border: "1px solid #DDE0DA", backgroundColor: "#fff" }}>
              <option value="job">Whole job timeline</option>
              {days.map((d) => <option key={d} value={d}>{d.slice(5).replace("-", "/")}/{d.slice(0, 4)} only</option>)}
            </select>
          </label>

          {optInNotes.length ? (
            <fieldset className="text-[12px] font-semibold" style={{ color: "#53615B" }}>Notes you can add (off by default)
              <div className="mt-1 flex flex-col gap-1.5">
                {optInNotes.map((e) => (
                  <label key={e.note.id} className="flex items-start gap-2 rounded-[9px] px-2.5 py-2 text-[13px] font-medium" style={{ border: "1px solid #E7E2D8", color: "#1d2a27" }}>
                    <input type="checkbox" className="mt-0.5" checked={picked.has(e.note.id)} onChange={() => toggleNote(e.note.id)} />
                    <span className="min-w-0"><span style={{ color: "#53615B" }}>{e.date.slice(5)} · </span>{String(e.note.body || "").slice(0, 120)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <label className="block text-[12px] font-semibold" style={{ color: "#53615B" }}>Subject
            <input value={report.subject} readOnly className="mt-1 h-10 w-full rounded-[9px] px-3 text-[14px] outline-none" style={{ border: "1px solid #DDE0DA", backgroundColor: "#F7F5F0" }} />
          </label>

          <label className="block text-[12px] font-semibold" style={{ color: "#53615B" }}>Report (editable)
            <textarea value={text} onChange={(e) => setEditedText(e.target.value)} rows={12} className="mt-1 w-full rounded-[9px] p-3 font-mono text-[12.5px] leading-relaxed outline-none" style={{ border: "1px solid #DDE0DA" }} />
          </label>

          <div className="text-[12.5px]" style={{ color: "#53615B" }}>
            Photos: {report.counts.photos} included{report.counts.excludedPrivate ? ` · ${report.counts.excludedPrivate} internal note${report.counts.excludedPrivate === 1 ? "" : "s"} kept private` : ""}
            {report.warnings.map((w) => <div key={w} role="alert" style={{ color: "#A43432" }}>{w}</div>)}
          </div>

          <div className="rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "#F4F1E9", color: "#5c5237", border: "1px solid #E4DCC6" }}>
            Sending is not wired up yet. The planned path creates a draft in the Outlook mailbox, where the From line defaults to the account primary (gabefronk@gmail.com) - Gabriel then picks YAWindowinstall@outlook.com as From in Outlook himself before sending. Draft capability still has to be confirmed live. For now, copy the report.
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={copy} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-[9px] text-[14px] font-semibold" style={{ backgroundColor: "#0b3f3b", color: "#fff" }}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? "Copied" : "Copy report"}
            </button>
            <button type="button" disabled title="Waiting on the send-path decision" className="inline-flex h-10 flex-1 cursor-not-allowed items-center justify-center rounded-[9px] text-[14px] font-semibold opacity-50" style={{ backgroundColor: "#E7E2D8", color: "#53615B" }}>Create Outlook draft</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
