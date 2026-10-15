import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

// Streams a Google Drive file's image bytes back to the signed-in owner, so
// Drive-backed job photos render inline. A Drive view link
// (drive.google.com/file/d/<id>/view) is an HTML page - it can never work as
// <img src>. Thumbnails come from Drive's own generated thumbnailLink (small
// and fast); when a file has no thumbnail, the original bytes are streamed.
// Only the two owner logins may call this, same gate as eventAttachmentUrl.
export default async function(req) {
  const client = createClientFromRequest(req);
  const user = await client.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const owners = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
  if (user.role !== 'admin' || !owners.has(String(user.email || '').trim().toLowerCase())) {
    return Response.json({ error: 'Owner access required.' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const file_id = String(body.file_id || '');
  const size = body.size === 'full' ? 'full' : 'thumb';
  if (!/^[\w-]{10,100}$/.test(file_id)) {
    return Response.json({ error: 'Invalid file id.' }, { status: 400 });
  }
  const conn = await client.asServiceRole.connectors.getConnection('googledrive').catch(() => null);
  const token = conn?.accessToken;
  if (!token) return Response.json({ error: 'Drive not connected.' }, { status: 502 });
  const auth = { Authorization: 'Bearer ' + token };
  const meta = await fetch(`https://www.googleapis.com/drive/v3/files/${file_id}?fields=thumbnailLink,mimeType,name`, { headers: auth })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!meta) return Response.json({ error: 'Drive file not found.' }, { status: 404 });
  let src = null;
  if (meta.thumbnailLink) src = String(meta.thumbnailLink).replace(/=s\d+$/, size === 'full' ? '=s2048' : '=s400');
  if (!src) src = `https://www.googleapis.com/drive/v3/files/${file_id}?alt=media`;
  const res = await fetch(src, { headers: auth }).catch(() => null);
  if (!res || !res.ok) return Response.json({ error: 'Drive fetch failed.' }, { status: 502 });
  const type = res.headers.get('content-type') || meta.mimeType || 'application/octet-stream';
  const buf = await res.arrayBuffer();
  return new Response(buf, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=300' } });
}
