import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchaseOrderOwner } from '@/lib/purchaseOrderAccess';
import PageNotFound from '@/lib/PageNotFound';
import { C } from '@/lib/feeUI';

export default function UnlinkedJobRecords() {
  const { user } = useAuth();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  return <RepairPage />;
}

function RepairPage() {
  const [data, setData] = useState({ field_reports: [], calendar_events: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const res = await base44.functions.invoke('repairJobLinks', { action: 'list' });
    setData(res?.data ?? res);
  }, []);
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);
  async function link(item, jobId) {
    setBusy(true);
    try { await base44.functions.invoke('repairJobLinks', { action: 'link', kind: item.kind, id: item.row.id, job_id: jobId }); await load(); }
    finally { setBusy(false); }
  }
  async function backfill() {
    setBusy(true);
    try { const res = await base44.functions.invoke('repairJobLinks', { action: 'backfill' }); const c = (res?.data ?? res).counts; setMessage(`Scanned ${c.scanned}; linked ${c.linked}; ambiguous ${c.ambiguous}; unmatched ${c.unmatched}; remaining ${c.remaining}.`); await load(); }
    finally { setBusy(false); }
  }
  const section = (title, items) => <section className="rounded-xl border bg-white p-5" style={{ borderColor: C.border }}><h2 className="text-lg font-bold">{title} ({items.length})</h2><div className="mt-4 space-y-3">{items.map((item) => <article key={`${item.kind}:${item.row.id}`} className="rounded-lg border p-4" style={{ borderColor: C.border }}><div className="font-medium">{item.row.job_name || '(untitled)'}</div><div className="text-xs mt-1" style={{ color: C.textMuted }}>{item.row.job_date || item.row.event_date || ''} · {item.row.po_number || item.row.oe_number || item.row.project_id || 'No hard identifier'}</div><div className="mt-3 flex flex-wrap gap-2">{item.suggestions.length ? item.suggestions.map((s) => <button disabled={busy} key={s.job_id} onClick={() => link(item, s.job_id)} className="rounded-lg border px-3 py-2 text-left text-xs"><strong className="block">Link · {s.job_name}</strong><span style={{ color: C.textMuted }}>{s.reasons.join(', ')}</span></button>) : <span className="text-xs" style={{ color: C.textMuted }}>No confident suggestions. Find or update the job identity first.</span>}</div></article>)}</div></section>;
  return <div className="min-h-dvh p-6" style={{ background: C.pageBg }}><header className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold">Unlinked job records</h1><p className="text-sm mt-1" style={{ color: C.textMuted }}>Owner repair queue. Automatic links use only unique exact evidence.</p></div><button disabled={busy} onClick={backfill} className="flex items-center gap-2 rounded-lg px-4 py-2 text-white" style={{ background: C.accent }}><RefreshCw className="h-4 w-4" />Run backfill</button></header>{message && <p className="mb-4 rounded-lg border bg-white p-3 text-sm">{message}</p>}<div className="grid gap-5 xl:grid-cols-2">{section('Field reports', data.field_reports || [])}{section('Calendar events', data.calendar_events || [])}</div></div>;
}
