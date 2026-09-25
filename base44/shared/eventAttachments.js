export const HUB_ATTACHMENT_FIELDS = [
  'drive_file_id', 'drive_url', 'rehosted_at',
  'hub_file_uri', 'hub_uploaded_at', 'hub_size', 'hub_sha256', 'hub_error',
];

export function preserveAttachmentMetadata(incoming, existing = []) {
  const bySource = new Map(existing.filter(a => a?.file_url).map(a => [a.file_url, a]));
  return incoming.map(attachment => {
    const prior = bySource.get(attachment.file_url);
    if (!prior) return attachment;
    const preserved = {};
    for (const field of HUB_ATTACHMENT_FIELDS) {
      if (prior[field] !== undefined && prior[field] !== null) preserved[field] = prior[field];
    }
    return { ...attachment, ...preserved };
  });
}

export function isGmailOnlyAttachment(attachment) {
  if (attachment?.hub_file_uri || attachment?.drive_url || attachment?.drive_file_id) return false;
  try {
    const url = new URL(attachment?.file_url || '');
    return url.hostname === 'mail-attachment.googleusercontent.com'
      || (url.hostname === 'mail.google.com' && url.searchParams.get('view') === 'att');
  } catch { return false; }
}

export function driveFileId(attachment) {
  if (attachment?.drive_file_id) return attachment.drive_file_id;
  const value = attachment?.drive_url || attachment?.file_url || '';
  try {
    const url = new URL(value);
    if (!/(^|\.)drive\.google\.com$/.test(url.hostname) && !/(^|\.)docs\.google\.com$/.test(url.hostname)) return '';
    return url.searchParams.get('id') || url.pathname.match(/\/d\/([^/]+)/)?.[1] || '';
  } catch { return ''; }
}
