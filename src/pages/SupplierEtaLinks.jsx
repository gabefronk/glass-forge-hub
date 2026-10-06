import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchaseOrderOwner } from '@/lib/purchaseOrderAccess';
import PageNotFound from '@/lib/PageNotFound';
import { supplierEtaHTML } from '../../base44/shared/supplierEtaPage.mjs';

async function request(body) {
  const res = await base44.functions.invoke('supplierEta', body);
  if (res.data?.error) throw new Error(res.data.error);
  return res.data;
}
const message = error => error?.response?.data?.error || error.message || 'Unable to load supplier links.';
export default function SupplierEtaLinks() {
  const { user } = useAuth();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  return <Workspace />;
}
function Workspace() {
  const [data, setData] = useState(null), [selected, setSelected] = useState([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [days, setDays] = useState('14');
  const [reviewed, setReviewed] = useState(false), [created, setCreated] = useState(null);
  const previewHost = window.location.hostname.startsWith('preview-sandbox--');
  const load = async (initial = false) => {
    setError('');
    try {
      const next = await request({ action: 'manage' }); setData(next);
      setSelected(current => initial ? next.orders.map(o => o.id) : current.filter(id => next.orders.some(o => o.id === id)));
    } catch (e) { setError(message(e)); }
  };
  useEffect(() => { load(true); }, []);
  const chosen = useMemo(() => (data?.orders || []).filter(o => selected.includes(o.id)), [data, selected]);
  const preview = useMemo(() => supplierEtaHTML({ previewOrders: chosen }), [chosen]);
  const create = async () => {
    setBusy(true); setError('');
    try {
      const result = await request({ action: 'create', order_ids: selected, expires_days: Number(days), label: 'Steve · AMSCO', review_confirmed: reviewed });
      setCreated({ ...result.link, url: 'https://glass-forge-hub.base44.app/functions/supplierEta#key=' + result.token });
      setReviewed(false); await load();
    } catch (e) { setError(message(e) + ' Refresh the link list before retrying if the save outcome is uncertain.'); }
    finally { setBusy(false); }
  };
  const revoke = async id => {
    setBusy(true);
    try { await request({ action: 'revoke', link_id: id }); if (created?.id === id) setCreated(null); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return <main className="mx-auto max-w-[1300px] space-y-5 p-4 sm:p-6">
    <Link to="/purchasing?section=tracking" className="text-sm font-semibold underline">← Back to Purchasing</Link>
    <div className="rounded-2xl bg-[#123d38] p-6 text-white"><p className="text-xs uppercase tracking-widest text-emerald-100">Supplier ETA link · owner review</p><h1 className="mt-2 text-2xl font-bold">See what Steve will see</h1><p className="mt-2 max-w-3xl text-sm text-emerald-50">Choose the AMSCO orders to share, then try the page below. Preview responses stay in the preview. Creating a private link is a separate step; nothing sends an email.</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {!data && !error && <p>Loading eligible AMSCO orders…</p>}
    {data && <div className="grid items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-xl border bg-white p-5"><h2 className="font-bold">Orders on this link</h2><p className="text-xs text-slate-600">All outstanding AMSCO orders are selected, including confirmed future ETAs. Each stays available for corrections until pickup, delivery or installation.</p>
        <p className="text-xs text-slate-600">Unnamed jobs use verified PO/order references. Completed, cancelled, test and merged records are excluded; unresolved record conflicts are shown below.</p>{data.review?.length > 0 && <div className="rounded-lg bg-amber-50 p-3 text-xs"><strong>Link review needed — excluded</strong>{data.review.map(row => <p key={row.id} className="mt-1">{row.po_number}: {row.reason}</p>)}</div>}<div className="space-y-3">{data.orders.map(order => <label key={order.id} className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" className="mt-1" checked={selected.includes(order.id)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, order.id] : ids.filter(id => id !== order.id)); setReviewed(false); }} /><span><strong className="block">{order.job_name}</strong><span className="text-xs text-slate-500">{order.po_number} · Quote {order.quote_number || 'not recorded'}<br />{order.follow_up_reason || 'Upcoming ETA: ' + order.eta_date}</span></span></label>)}</div>
        {!data.orders.length && <p className="text-sm">No eligible AMSCO orders.</p>}
        <p className="text-xs text-slate-500">Steve sees job names and order references, ETA, and his response time. No prices, payment links, notes, or general Hub access.</p>
        <div className="border-t pt-4"><h3 className="font-semibold">Create a private link</h3><label className="mt-3 block text-sm">Expires after<select value={days} onChange={e => setDays(e.target.value)} className="mt-1 block w-full rounded-lg border p-2">{[7,14,30].map(n => <option key={n} value={n}>{n} days</option>)}</select></label>
          <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /><span>I reviewed these {chosen.length} orders. Anyone holding the link can update their ETAs until it expires or I revoke it.</span></label>
          <button type="button" disabled={busy || !reviewed || !chosen.length || previewHost} onClick={create} className="mt-3 w-full rounded-lg bg-[#174d3f] p-3 text-sm font-semibold text-white disabled:opacity-40">Create private link</button>
          {previewHost && <p className="mt-2 text-xs text-amber-800">Preview only. Publish and verify the supplier endpoint before creating a live link.</p>}
        </div>
        {created && <div className="rounded-lg bg-emerald-50 p-3 text-xs"><strong>Link created — not sent</strong><p className="my-2">Copy it now; the secret is shown only once.</p><input aria-label="Private supplier link" readOnly value={created.url} className="w-full rounded border p-2" /><button className="mt-2 underline" onClick={() => navigator.clipboard.writeText(created.url).catch(() => setError('Select and copy the link above.'))}>Copy link</button></div>}
        <details><summary className="cursor-pointer text-sm font-semibold">Existing links ({data.links.length})</summary>{data.links.map(link => <div key={link.id} className="mt-3 border-t pt-2 text-xs"><strong>{link.label}</strong><p>{link.order_count} orders · {link.enabled ? 'Expires ' + link.expires_at.slice(0,10) : 'Revoked'}</p>{link.enabled && <button type="button" disabled={busy} onClick={() => revoke(link.id)} className="mt-2 rounded border px-3 py-2">Revoke link</button>}</div>)}</details>
      </aside>
      <div><iframe title="Supplier ETA page preview" sandbox="allow-scripts" srcDoc={preview} className="h-[1250px] w-full rounded-xl border bg-[#f4f1e9]" /><p className="mt-2 text-xs text-slate-600">The supplier page above uses the same layout and fields as the private link. Try saving an ETA or marking it pending; no real order changes.</p></div>
    </div>}
  </main>;
}