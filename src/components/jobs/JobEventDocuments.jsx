import { FileText, Image as ImageIcon, Video, File, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";

// Collect attachment links from the calendar events linked to a job, deduped
// by file_url. Gmail-sourced attachment links require the owner's Google
// session to open; Drive-sourced links open for anyone with file access.
export function eventAttachments(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    for (const a of ev.event_attachments || []) {
      if (!a || !a.file_url) continue;
      if (seen.has(a.file_url)) continue;
      seen.add(a.file_url);
      out.push({ title: a.title || "Attachment", file_url: a.file_url, mime_type: a.mime_type || "" });
    }
  }
  return out;
}

function iconFor(title) {
  const t = String(title || "").toLowerCase();
  if (/\.(jpg|jpeg|png|gif|heic|webp)$/.test(t)) return ImageIcon;
  if (/\.(mov|mp4|m4v|avi|wmv)$/.test(t)) return Video;
  if (/\.(pdf|doc|docx|txt|csv)$/.test(t)) return FileText;
  return File;
}

export default function JobEventDocuments({ events }) {
  const atts = eventAttachments(events);
  if (!atts.length) return null;
  return (
    <div className="space-y-1">
      {atts.map((a, i) => {
        const Icon = iconFor(a.title);
        return (
          <a key={i} href={a.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }} title={a.title}>
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
            <span className="break-words">{sanitizeText(a.title)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      })}
    </div>
  );
}