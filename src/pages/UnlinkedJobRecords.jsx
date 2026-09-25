import { useCallback, useEffect, useState } from 'react';
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
  const [message, setMessage] = useState('');
  const load = useCallback(async () => {
    const res = await base44.functions.invoke('repairJobLinks', { action: 'list' });
    setData(res?.data ?? res);
  }, []);
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);
  const section = (title, items) => <section className="rounded-xl border bg-white p-5" style={{ borderColor: C.border }}><h2 className="text-lg font-bold">{title} ({items.length})</h2><div className="mt-4 space-y-3">{items.map((item) => <article key={`${item.kind}:${item.row.id}`} className="rounded-lg border p-4" style={{ borderColor: C.border }}><div className="font-medium">{item.row.job_name || '(untitled)'}</div><div className="text-xs mt-1" style={{ color: C.textMuted }}>{item.row.job_date || item.row.event_date || ''} · {item.row.po_number || item.row.oe_number || item.row.project_id || 'No hard identifier'}</div><div className="mt-3 flex flex-wrap gap-2">{item.suggestions.length ? item.suggestions.map((candidate) => <div key={candidate.job_id} className="rounded-lg border px-3 py-2 text-left text-xs"><strong className="block">Possible job · {candidate.job_name}</strong><span style={{ color: C.textMuted }}>{candidate.reasons.join(', ')}</span></div>) : <span className="text-xs" style={{ color: C.textMuted }}>No confident suggestions. Record repair is not enabled.</span>}</div></article>)}</div></section>;
  return <div className="min-h-dvh p-6" style={{ background: C.pageBg }}><header className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold">Unlinked job records</h1><p className="text-sm mt-1" style={{ color: C.textMuted }}>Owner review queue. Existing records are read-only.</p></div></header>{message && <p className="mb-4 rounded-lg border bg-white p-3 text-sm">{message}</p>}<div className="grid gap-5 xl:grid-cols-2">{section('Field reports', data.field_reports || [])}{section('Calendar events', data.calendar_events || [])}</div></div>;
}
