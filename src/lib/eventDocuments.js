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
// skipJobFolder: leave out files already copied into the job's Drive folder
// (the folder list shows them). Indexes stay the event's real indexes.
export function eventAttachments(events, { skipJobFolder = false } = {}) {
  const seen = new Set();
  const out = [];
  for (const ev of events || []) {
    for (let attachmentIndex = 0; attachmentIndex < (ev.event_attachments || []).length; attachmentIndex++) {
      const attachment = ev.event_attachments[attachmentIndex];
      if (!attachment?.file_url || seen.has(attachment.file_url)) continue;
      if (skipJobFolder && attachment.job_folder_file_id) continue;
      seen.add(attachment.file_url);
      const view = {
        title: attachment.title || "Attachment",
        file_url: attachment.file_url,
        mime_type: attachment.mime_type || "",
        drive_file_id: attachment.drive_file_id || "",
        drive_url: attachment.drive_url || "",
      };
      if (attachment.job_folder_file_id) view.in_job_folder = true;
      if (attachment.hub_file_uri) Object.assign(view, { has_hub_copy: true, event_id: ev.id, attachment_index: attachmentIndex });
      if (attachment.hub_error) view.hub_error = attachment.hub_error;
      out.push(view);
    }
  }
  return out;
}

export function preferredAttachmentSource(attachment) {
  if (attachment?.has_hub_copy || attachment?.hub_file_uri) return "hub";
  if (attachment?.drive_url) return "drive";
  return attachment?.file_url ? "file" : "";
}
