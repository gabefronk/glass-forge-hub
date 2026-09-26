import { useCallback, useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchaseOrderOwner } from '@/lib/purchaseOrderAccess';
import PageNotFound from '@/lib/PageNotFound';
import { C } from '@/lib/feeUI';
import { PageShell, PageHero, heroBtn, heroPrimary, heroSecondary } from '@/components/PageShell';

export default function UnlinkedJobRecords() {
  const { user } = useAuth();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  return <RepairPage />;
}

const fnError = (res) => res?.data?.error || res?.error || '';

function RepairPage() {
  const [data, setData] = useState({ field_reports: [], calendar_events: [] });
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await base44.functions.invoke('repairJobLinks', { action: 'list' });
    setData(res?.data ?? res);
  }, []);
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);

  // Additive backfill: copy the job from a confident invoicing line onto the calendar
  // event / field report it came from, only where that record has no job yet.
  const runBackfill = async (dryRun) => {
    setBusy(true);
    setMessage('');
    try {
      const res = await base44.functions.invoke('repairJobLinks', { action: 'backfill_links', dry_run: dryRun });
      const err = fnError(res);
      if (err) throw new Error(err);
      if (dryRun) setPreview(res.data);
      else {
        const d = res.data;
        setPreview(null);
        setMessage(`Linked ${d.calendar_events.linked_now} calendar events and ${d.field_reports.linked_now} field reports to their jobs.`);
        await load();
      }
    } catch (e) {
      setMessage(e?.response?.data?.error || e.message || 'Backfill failed.');
    } finally {
      setBusy(false);
    }
  };

  const section = (title, items) => (
    <section className="rounded-[14px] bg-white p-5 card-shadow" style={{ border: `1px solid ${C.border}` }}>
      <h2 className="text-[16px] font-bold" style={{ color: C.text }}>{title} ({items.length})</h2>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <article key={`${item.kind}:${item.row.id}`} className="rounded-lg p-4" style={{ border: `1px solid ${C.rowBorder}` }}>
            <div className="font-medium" style={{ color: C.text }}>{item.row.job_name || '(untitled)'}</div>
            <div className="mt-1 text-xs" style={{ color: C.textMuted }}>{item.row.job_date || item.row.event_date || ''} · {item.row.po_number || item.row.oe_number || item.row.project_id || 'No hard identifier'}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {item.suggestions.length ? item.suggestions.map((candidate) => (
                <div key={candidate.job_id} className="rounded-lg px-3 py-2 text-left text-xs" style={{ border: `1px solid ${C.rowBorder}`, background: C.cardAlt }}>
                  <strong className="block" style={{ color: C.text }}>Possible job · {candidate.job_name}</strong>
                  <span style={{ color: C.textMuted }}>{candidate.reasons.join(', ')}</span>
                </div>
              )) : <span className="text-xs" style={{ color: C.textMuted }}>No confident suggestions.</span>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  return (
    <PageShell>
      <PageHero
        eyebrow="Glass Forge · Admin"
        title="Unlinked job records"
        sub="Calendar events and field reports with no job. Confident matches from invoicing lines can be linked in one step; nothing already linked is ever changed."
        actions={<button type="button" disabled={busy} onClick={() => runBackfill(true)} className={`${heroBtn} disabled:opacity-50`} style={heroSecondary}><Link2 className="h-4 w-4" />Check confident links</button>}
      />
      <div className="mt-5 flex flex-col gap-5">
        {message && <p role="status" className="rounded-[14px] bg-white p-3 text-sm" style={{ border: `1px solid ${C.border}`, color: C.text }}>{message}</p>}
        {preview && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white p-4 card-shadow" style={{ border: `1px solid ${C.border}` }}>
            <p className="m-0 text-sm" style={{ color: C.text }}>
              Ready to link <strong>{preview.calendar_events.linked_now}</strong> of {preview.calendar_events.unlinked} unlinked calendar events and <strong>{preview.field_reports.linked_now}</strong> of {preview.field_reports.unlinked} unlinked field reports.
              {preview.skipped_ambiguous ? ` ${preview.skipped_ambiguous} skipped (lines disagree on the job).` : ''}
            </p>
            <button type="button" disabled={busy || !(preview.calendar_events.linked_now + preview.field_reports.linked_now)} onClick={() => runBackfill(false)} className={`${heroBtn} disabled:opacity-50`} style={heroPrimary}>Link them</button>
          </div>
        )}
        <div className="grid gap-5 xl:grid-cols-2">
          {section('Field reports', data.field_reports || [])}
          {section('Calendar events', data.calendar_events || [])}
        </div>
      </div>
    </PageShell>
  );
}
