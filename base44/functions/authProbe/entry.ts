// ONE-SHOT AUTH PROBE — temporary, deleted after a single run.
// Returns ONLY three booleans describing the caller's auth context. No entity,
// provider, mail, or Drive reads or writes; no ids / emails / roles / tokens in
// the response. Exists solely to determine whether a scheduled workflow invokes
// its function as the workflow creator (has_user=true) or as a null-user service
// call (has_user=false, is_service=true). Not wired to sync or any mailbox.
//
// Definitions:
//   has_user  = base44.auth.me() resolved to a user object
//   is_owner  = that user is one of the configured Gabriel owner auth ids
//   is_service = no authenticated user (null / threw) — a platform scheduler call
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const OWNER_IDS = new Set(['6a7f0d834a5f825c724273ea', '6a8229a9801b2aef9278ff47']);

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const has_user = !!user;
    const is_owner = has_user && OWNER_IDS.has(user.id);
    const is_service = !has_user;
    return Response.json({ ok: true, has_user, is_owner, is_service });
  } catch (e) {
    return Response.json({ ok: false, has_user: false, is_owner: false, is_service: true, error: String(e?.message || e).slice(0, 120) });
  }
}