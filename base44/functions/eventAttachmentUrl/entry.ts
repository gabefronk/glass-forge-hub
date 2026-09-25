import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

export default async function(req) {
  const client = createClientFromRequest(req);
  const user = await client.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const { event_id, attachment_index } = await req.json().catch(() => ({}));
  if (!event_id || !Number.isInteger(attachment_index) || attachment_index < 0) {
    return Response.json({ error: 'Invalid attachment.' }, { status: 400 });
  }
  // Deliberately use the caller-scoped entity client: its existing RLS proves
  // this login can see the event before service-role storage signs anything.
  const event = await client.entities.CalendarEvents.get(event_id).catch(() => null);
  const attachment = event?.event_attachments?.[attachment_index];
  if (!attachment?.hub_file_uri) return Response.json({ error: 'Attachment not found.' }, { status: 404 });
  const { signed_url } = await client.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: attachment.hub_file_uri, expires_in: 300 });
  return Response.json({ url: signed_url, mime_type: attachment.mime_type || '', expires_in: 300 }, { headers: { 'Cache-Control': 'no-store' } });
}
