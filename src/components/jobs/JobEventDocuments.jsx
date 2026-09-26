import { FileText, Image as ImageIcon, Video, File, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { eventAttachments, isGmailAttachmentUrl } from "@/lib/eventDocuments";
import { base44 } from "@/api/base44Client";

export { eventAttachments, isGmailAttachmentUrl };

function iconFor(title) {
  const t = String(title || "").toLowerCase();
  if (/\.(jpg|jpeg|png|gif|heic|webp)$/.test(t)) return ImageIcon;
  if (/\.(mov|mp4|m4v|avi|wmv)$/.test(t)) return Video;
  if (/\.(pdf|doc|docx|txt|csv)$/.test(t)) return FileText;
  return File;
}

export default function JobEventDocuments({ events, skipJobFolder = false }) {
  const atts = eventAttachments(events, { skipJobFolder });
  if (!atts.length) return null;
  const gmailOnlyCount = atts.filter((a) => !a.has_hub_copy && !a.drive_url && (a.hub_error === "gmail_only" || isGmailAttachmentUrl(a.file_url))).length;
  const openAttachment = async (attachment) => {
    const tab = window.open("about:blank", "_blank");
    try {
      if (attachment.has_hub_copy) {
        const response = await base44.functions.invoke("eventAttachmentUrl", {
          event_id: attachment.event_id,
          attachment_index: attachment.attachment_index,
        });
        const url = response.data?.url;
        if (!url) throw new Error("No signed URL returned");
        if (tab) tab.location.href = url; else window.location.assign(url);
        return;
      }
      const fallback = attachment.drive_url || attachment.file_url;
      if (tab) tab.location.href = fallback; else window.location.assign(fallback);
    } catch {
      if (tab) tab.close();
      const fallback = attachment.drive_url || attachment.file_url;
      if (fallback && !isGmailAttachmentUrl(fallback)) window.open(fallback, "_blank", "noopener,noreferrer");
    }
  };
  return (
    <div className="space-y-1">
      {gmailOnlyCount > 0 && (
        <p className="text-[11px]" style={{ color: C.textMuted }}>
          {gmailOnlyCount} files are still in Israel&apos;s Gmail and can&apos;t be opened here yet.
        </p>
      )}
      {atts.map((a, i) => {
        const Icon = iconFor(a.title);
        const gmailOnly = !a.has_hub_copy && !a.drive_url && (a.hub_error === "gmail_only" || isGmailAttachmentUrl(a.file_url));
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
          <button key={i} type="button" onClick={() => openAttachment(a)} className="inline-flex items-center gap-1.5 text-left text-[12px] py-0.5 break-words hover:underline" style={{ color: C.accentText }} title={a.title}>
            <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
            <span className="break-words">{sanitizeText(a.title)}</span>
            {a.in_job_folder && <span className="rounded px-1 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 whitespace-nowrap">In job folder</span>}
            {!a.in_job_folder && a.has_hub_copy && <span className="rounded px-1 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 whitespace-nowrap">Hub copy</span>}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </button>
        );
      })}
    </div>
  );
}
