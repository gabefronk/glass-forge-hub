import { FileText, Image as ImageIcon, Video, File, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { eventAttachments, isGmailAttachmentUrl } from "@/lib/eventDocuments";

export { eventAttachments, isGmailAttachmentUrl };

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
  const gmailOnlyCount = atts.filter((a) => !a.drive_url && isGmailAttachmentUrl(a.file_url)).length;
  return (
    <div className="space-y-1">
      {gmailOnlyCount > 0 && (
        <p className="text-[11px]" style={{ color: C.textMuted }}>
          {gmailOnlyCount} files are still in Israel&apos;s Gmail and can&apos;t be opened here yet.
        </p>
      )}
      {atts.map((a, i) => {
        const Icon = iconFor(a.title);
        const gmailOnly = !a.drive_url && isGmailAttachmentUrl(a.file_url);
        if (gmailOnly) {
          return (
            <div
              key={i}
              className="inline-flex items-center gap-1.5 text-[12px] py-0.5 break-words"
              style={{ color: C.textMuted }}
              title="Stored in Israel's Gmail - opens only in his account. A Drive copy is pending."
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="break-words">{sanitizeText(a.title)}</span>
              <span className="rounded px-1 py-0.5 text-[10px] bg-slate-100 text-slate-500 whitespace-nowrap">
                in Israel&apos;s Gmail
              </span>
            </div>
          );
        }
        return (
          <a key={i} href={a.drive_url || a.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }} title={a.title}>
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
            <span className="break-words">{sanitizeText(a.title)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        );
      })}
    </div>
  );
}
