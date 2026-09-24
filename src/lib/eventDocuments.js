export function isGmailAttachmentUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "mail-attachment.googleusercontent.com") return true;
    return parsed.hostname === "mail.google.com" && parsed.searchParams.get("view") === "att";
  } catch {
    return false;
  }
}

// Collect attachment links from the calendar events linked to a job, deduped
// by file_url. Re-host metadata is retained so the UI can prefer Drive copies.
export function eventAttachments(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    for (const attachment of ev.event_attachments || []) {
      if (!attachment?.file_url || seen.has(attachment.file_url)) continue;
      seen.add(attachment.file_url);
      out.push({
        title: attachment.title || "Attachment",
        file_url: attachment.file_url,
        mime_type: attachment.mime_type || "",
        drive_file_id: attachment.drive_file_id || "",
        drive_url: attachment.drive_url || "",
      });
    }
  }
  return out;
}
