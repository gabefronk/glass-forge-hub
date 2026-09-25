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
    for (let attachmentIndex = 0; attachmentIndex < (ev.event_attachments || []).length; attachmentIndex++) {
      const attachment = ev.event_attachments[attachmentIndex];
      if (!attachment?.file_url || seen.has(attachment.file_url)) continue;
      seen.add(attachment.file_url);
      const view = {
        title: attachment.title || "Attachment",
        file_url: attachment.file_url,
        mime_type: attachment.mime_type || "",
        drive_file_id: attachment.drive_file_id || "",
        drive_url: attachment.drive_url || "",
      };
      if (attachment.hub_file_uri) Object.assign(view, { hub_file_uri: attachment.hub_file_uri, event_id: ev.id, attachment_index: attachmentIndex });
      if (attachment.hub_error) view.hub_error = attachment.hub_error;
      out.push(view);
    }
  }
  return out;
}

export function preferredAttachmentSource(attachment) {
  if (attachment?.hub_file_uri) return "hub";
  if (attachment?.drive_url) return "drive";
  return attachment?.file_url ? "file" : "";
}
