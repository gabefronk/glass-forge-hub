import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';
import { rehostEventAttachments } from '../../shared/rehostEventAttachments.js';

const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);

export default async function(req) {
  const client = createClientFromRequest(req);
  const user = await client.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' || !OWNERS.has(String(user.email || '').toLowerCase())) {
    return Response.json({ error: 'Owner access required.' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    return Response.json(await rehostEventAttachments({ client, eventIds: body.event_ids, limit: body.limit }));
  } catch (error) {
    console.error('event attachment backfill failed', error);
    return Response.json({ error: 'Attachment backfill failed.' }, { status: 500 });
  }
}
