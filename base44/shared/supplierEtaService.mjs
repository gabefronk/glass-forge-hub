import { fetchCompleteEntity } from './jobCatalog.js';
import { assertOwner } from './purchaseOrderService.mjs';
import { validDate, text } from './procurementCore.js';
import { supplierEtaCandidates, supplierEtaReview, supplierEtaFollowUp, linkedEtaSupplier, publicEtaOrder, effectiveSupplierEta } from './supplierEtaCore.mjs';
import { supplierEtaHTML } from './supplierEtaPage.mjs';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
const newToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
const safeLink = row => ({ id: row.id, label: row.label, enabled: row.enabled, expires_at: row.expires_at, issued_at: row.issued_at, revoked_at: row.revoked_at || '', order_count: row.orders?.length || 0 });
const loadData = async api => {
  const [purchase_orders, vendor_orders, jobs] = await Promise.all([fetchCompleteEntity(api.PurchaseOrders), fetchCompleteEntity(api.VendorOrders), fetchCompleteEntity(api.Jobs)]);
  return { purchase_orders, vendor_orders, jobs };
};
const scopeOrders = (grant, data) => supplierEtaCandidates(data).filter(po => grant.orders.some(s => s.po_id === po.id && text(s.job_id) === text(po.job_id) && text(s.po_number) === text(po.po_number) && text(s.quote_number) === text(po.vendor_quote_ref)));
const validGrant = (grant, now) => grant?.enabled === true && Number.isFinite(Date.parse(grant.expires_at)) && Date.parse(grant.expires_at) > Date.parse(now);

export async function supplierEtaAction(api, body, user, deps = {}) {
  const now = deps.now || (() => new Date().toISOString());
  const action = body.action || 'read';
  if (['manage', 'preview', 'create', 'revoke'].includes(action)) {
    assertOwner(user);
    if (action === 'revoke') {
      const grant = await api.SupplierEtaLinks.get(text(body.link_id));
      if (!grant) fail(404, 'Link not found.');
      await api.SupplierEtaLinks.updateMany({ id: grant.id }, { $set: { enabled: false, revoked_at: now() } });
      return { ok: true };
    }
    const data = await loadData(api);
    const candidates = supplierEtaCandidates(data);
    if (action === 'manage') return { orders: candidates.map(po => ({ ...publicEtaOrder(po, data), follow_up_reason: supplierEtaFollowUp(po, data, now()) })), review: supplierEtaReview(data).filter(r => r.reason && !['Test, sample or merged record', 'Completed, cancelled or received'].includes(r.reason)).map(r => ({ id: r.po.id, po_number: r.po.po_number, reason: r.reason })), links: (await fetchCompleteEntity(api.SupplierEtaLinks)).map(safeLink) };
    const ids = body.order_ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length) fail(400, 'Select between 1 and 50 distinct orders.');
    const selected = ids.map(id => candidates.find(po => po.id === id));
    if (selected.some(po => !po)) fail(409, 'An order is no longer eligible. Refresh and review the selection.');
    if (action === 'preview') return { orders: selected.map(po => publicEtaOrder(po, data)), preview: true };
    if (body.review_confirmed !== true) fail(400, 'Review the selected orders before creating the link.');
    const days = Number(body.expires_days);
    if (![7, 14, 30].includes(days)) fail(400, 'Choose a 7, 14 or 30 day expiry.');
    const token = newToken();
    const stamp = now();
    const grant = await api.SupplierEtaLinks.create({ label: text(body.label).slice(0, 100) || 'Steve · AMSCO', vendor: 'AMSCO',
      token_hash: await digest(token), enabled: true, issued_at: stamp, expires_at: new Date(Date.parse(stamp) + days * 86400000).toISOString(),
      created_by_email: user.email, lock_token: '', revision: 0,
      orders: selected.map(po => ({ po_id: po.id, job_id: text(po.job_id), po_number: text(po.po_number), quote_number: text(po.vendor_quote_ref) })) });
    // Bearer secret is returned exactly once, never stored or logged.
    return { link: safeLink(grant), token };
  }
  if (!['read', 'save'].includes(action)) fail(400, 'Unknown action.');
  const allowed = action === 'read' ? ['action', 'token'] : ['action', 'token', 'order_id', 'response', 'eta_date', 'expected_version', 'request_id'];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'Unsupported response fields.');
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) fail(401, 'This link is unavailable or expired. Ask Glass Forge for a new link.');
  const grants = await api.SupplierEtaLinks.filter({ token_hash: await digest(body.token), enabled: true }, 'id', 2);
  let grant = grants.length === 1 ? grants[0] : null;
  if (!validGrant(grant, now())) fail(401, 'This link is unavailable or expired. Ask Glass Forge for a new link.');
  if (action === 'read') {
    const data = await loadData(api);
    return { supplier: 'AMSCO', expires_at: grant.expires_at, orders: scopeOrders(grant, data).map(po => publicEtaOrder(po, data)) };
  }
  if (!['eta', 'pending'].includes(body.response) || body.response === 'eta' && !validDate(body.eta_date) || body.response === 'pending' && text(body.eta_date)) fail(400, 'Choose an ETA date or still pending.');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(body.request_id || '')) fail(400, 'Refresh this page before saving.');
  const lock = crypto.randomUUID();
  const acquired = await api.SupplierEtaLinks.updateMany({ id: grant.id, enabled: true, revision: grant.revision, lock_token: '' }, { $set: { lock_token: lock }, $inc: { revision: 1 } });
  if (acquired?.updated !== 1) fail(409, 'Another response is saving. Refresh before trying again.');
  try {
    grant = await api.SupplierEtaLinks.get(grant.id);
    if (!validGrant(grant, now())) fail(401, 'This link is unavailable or expired.');
    const data = await loadData(api);
    const po = scopeOrders(grant, data).find(row => row.id === body.order_id);
    if (!po) fail(403, 'This order is not available through this link.');
    const history = po.supplier_eta?.history || [];
    const retry = history.find(h => h.request_id === body.request_id && h.link_id === grant.id);
    if (retry) {
      if (retry.response !== body.response || retry.eta_date !== (body.response === 'eta' ? body.eta_date : '')) fail(409, 'This response was already saved with different details. Refresh.');
      return { ok: true, duplicate: true, order: publicEtaOrder(po, data) };
    }
    if (!body.expected_version || publicEtaOrder(po, data).version !== body.expected_version) fail(409, 'This order changed. Refresh and review its latest ETA before saving.');
    if (history.length >= 1000) fail(409, 'This order needs review by Glass Forge before another response.');
    const supplier = linkedEtaSupplier(po, data.vendor_orders, data.purchase_orders);
    const previous = effectiveSupplierEta(po, supplier);
    const entry = { response: body.response, eta_date: body.response === 'eta' ? body.eta_date : '',
      responded_at: now(), previous_eta_date: previous.date || previous.previous_eta_date || '',
      request_id: body.request_id, link_id: grant.id, source: 'AMSCO supplier link' };
    // One atomic record update. No finance, status, received date, job links or calendar records are writable.
    const result = await api.PurchaseOrders.updateMany({ id: po.id, updated_date: po.updated_date, job_id: po.job_id, vendor: po.vendor, status: po.status },
      { $set: { supplier_eta: { ...entry, history: [...history, entry] } } });
    if (result?.updated !== 1) fail(409, 'This order changed. Refresh before saving.');
    const fresh = await api.PurchaseOrders.get(po.id);
    return { ok: true, order: publicEtaOrder(fresh, { ...data, purchase_orders: data.purchase_orders.map(p => p.id === fresh.id ? fresh : p) }) };
  } finally {
    await api.SupplierEtaLinks.updateMany({ id: grant.id, lock_token: lock }, { $set: { lock_token: '' } });
  }
}
export function createSupplierEtaHandler(getClient) {
  return async req => {
    const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
    if (req.method === 'GET') {
      const nonce = crypto.randomUUID().replaceAll('-', '');
      return new Response(supplierEtaHTML({ nonce }), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
    }
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed.' }, { status: 405, headers });
    try {
      const raw = await req.text();
      if (raw.length > 16000) fail(413, 'Request too large.');
      let body; try { body = JSON.parse(raw); } catch { fail(400, 'Invalid request.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request.');
      const client = getClient(req);
      const ownerAction = ['manage', 'preview', 'create', 'revoke'].includes(body.action);
      const user = ownerAction ? await client.auth.me().catch(() => null) : null;
      if (ownerAction) assertOwner(user);
      return Response.json(await supplierEtaAction(client.asServiceRole.entities, body, user), { headers });
    } catch (error) {
      return Response.json({ error: error.status ? error.message : 'The response could not be completed. Refresh before trying again.' }, { status: error.status || 500, headers });
    }
  };
}
