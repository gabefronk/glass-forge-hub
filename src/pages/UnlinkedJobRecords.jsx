import { useCallback, useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchaseOrderOwner } from '@/lib/purchaseOrderAccess';
import PageNotFound from '@/lib/PageNotFound';
import { C } from '@/lib/feeUI';
import { PageShell, PageHero, heroBtn, heroPrimary, heroSecondary } from '@/components/PageShell';
import UnlinkedMoneyRecords from '@/components/jobs/UnlinkedMoneyRecords';
import JobPicker from '@/components/invoicing/JobPicker';

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
  const [moneyRefresh, setMoneyRefresh] = useState(0);
  const [jobs, setJobs] = useState(null);
  const [searching, setSearching] = useState(null);

  const load = useCallback(async () => {
    const res = await base44.functions.invoke('repairJobLinks', { action: 'list' });
    setData(res?.data ?? res);
  }, []);
  useEffect(() => { load().catch((e) => setMessage(e.message)); }, [load]);

  // Additive backfill (repairJobLinks): links billing lines, calendar events and field
  // reports whose evidence all agrees on one job, only where the record has no job yet.
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
        setMessage(`Linked ${d.fee_lines?.linked_now || 0} billing lines, ${d.calendar_events.linked_now} calendar events and ${d.field_reports.linked_now} field reports to their jobs.`);
        setMoneyRefresh((n) => n + 1);
        await load();
      }
    } catch (e) {
      setMessage(e?.response?.data?.error || e.message || 'Backfill failed.');
    } finally {
      setBusy(false);
    }
  };

  // Owner pick from the record's suggestions (or any job): sets the job on a record that has
  // none. Owner links are never re-evaluated by ingest.
  const linkRecord = async (item, jobId) => {
    const entity = item.kind === 'field_report' ? 'FieldReports' : 'CalendarEvents';
    const list = item.kind === 'field_report' ? 'field_reports' : 'calendar_events';
    setBusy(true);
    setMessage('');
    try {
      await base44.entities[entity].update(item.row.id, { job_id: jobId, job_link_source: 'owner', job_linked_at: new Date().toISOString() });
      setData((d) => ({ ...d, [list]: (d[list] || []).filter((x) => x.row.id !== item.row.id) }));
      setSearching(null);
    } catch (e) {
      setMessage(`${item.row.job_name || 'Record'} was not linked. ${e?.message || ''}`.trim());
    } finally {
      setBusy(false);
    }
  };

  const pick = async (item, value) => {
    if (value !== 'search') return value && linkRecord(item, value);
    setSearching(item.row.id);
    if (!jobs) setJobs(await base44.entities.Jobs.list('canonical_name', 5000).catch(() => []));
  };

  const section = (title, items) => (
    <section className="rounded-[14px] bg-white p-5 card-shadow" style={{ border: `1px solid ${C.border}` }}>
      <h2 className="text-[16px] font-bold" style={{ color: C.text }}>{title} ({items.length})</h2>
      <div className="mt-4 max-h-[560px] space-y-3 overflow-y-auto">
        {items.map((item) => (
          <article key={`${item.kind}:${item.row.id}`} className="rounded-lg p-3" style={{ border: `1px solid ${C.rowBorder}` }}>
            <div className="font-medium break-words" style={{ color: C.text }}>{item.row.job_name || '(untitled)'}</div>
            <div className="mt-0.5 text-[13px]" style={{ color: C.textMuted }}>{item.row.job_date || item.row.event_date || ''} · {item.row.po_number || item.row.oe_number || item.row.project_id || 'No hard identifier'}</div>
            {searching === item.row.id ? (
              <div className="mt-2">{jobs ? <JobPicker jobs={jobs} currentJobId={null} onCancel={() => setSearching(null)} onConfirm={(job) => linkRecord(item, job.id)} /> : <span className="text-[13px]" style={{ color: C.textMuted }}>Loading jobs…</span>}</div>
            ) : (
              <select aria-label={`Job for ${item.row.job_name || 'this record'}`} disabled={busy} value="" onChange={(e) => pick(item, e.target.value)} className="mt-2 min-h-9 w-full max-w-[28rem] rounded-lg border border-slate-300 bg-white px-2 text-[13px]">
                <option value="">{item.suggestions.length ? 'Link to job…' : 'Link to job… (no confident suggestion)'}</option>
                {item.suggestions.map((c) => <option key={c.job_id} value={c.job_id}>{c.job_name} · {c.reasons.join(', ')}</option>)}
                <option value="search">Search all jobs…</option>
              </select>
            )}
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
        sub="Money records, calendar events and field reports with no job. Every record should belong to a job so budgets, purchasing and invoices stay in sync; nothing already linked is ever changed."
        actions={<button type="button" disabled={busy} onClick={() => runBackfill(true)} className={`${heroBtn} disabled:opacity-50`} style={heroSecondary}><Link2 className="h-4 w-4" />Check confident links</button>}
      />
      <div className="mt-5 flex flex-col gap-5">
        {message && <p role="status" className="rounded-[14px] bg-white p-3 text-sm" style={{ border: `1px solid ${C.border}`, color: C.text }}>{message}</p>}
        {preview && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-white p-4 card-shadow" style={{ border: `1px solid ${C.border}` }}>
            <p className="m-0 text-sm" style={{ color: C.text }}>
              Ready to link <strong>{preview.fee_lines?.linked_now || 0}</strong> of {preview.fee_lines?.unlinked || 0} billing lines, <strong>{preview.calendar_events.linked_now}</strong> of {preview.calendar_events.unlinked} calendar events and <strong>{preview.field_reports.linked_now}</strong> of {preview.field_reports.unlinked} field reports with no job.
              {preview.skipped_ambiguous ? ` ${preview.skipped_ambiguous} skipped because their evidence points at more than one job.` : ''}
            </p>
            <button type="button" disabled={busy || !((preview.fee_lines?.linked_now || 0) + preview.calendar_events.linked_now + preview.field_reports.linked_now)} onClick={() => runBackfill(false)} className={`${heroBtn} disabled:opacity-50`} style={heroPrimary}>Link them</button>
          </div>
        )}
        <UnlinkedMoneyRecords refreshSignal={moneyRefresh} />
        <div className="grid gap-5 xl:grid-cols-2">
          {section('Field reports', data.field_reports || [])}
          {section('Calendar events', data.calendar_events || [])}
        </div>
      </div>
    </PageShell>
  );
}
