import { CheckCircle2, Clock3 } from 'lucide-react';
import { packageProgress } from './packageProgress';
const money = value => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value) : '—';

export default function WindowPackageProgress({ quote }) {
  const progress = packageProgress(quote); if (!progress) return null;
  return <section className="mt-4 min-w-0 rounded-xl border border-[#d9e2e8] bg-[#fafcfd] p-3 sm:p-4" aria-label="Window pricing progress">
    <div className="flex flex-wrap items-center justify-between gap-2" role="status"><h3 className="text-sm font-semibold text-[#263c49]">{progress.summary}</h3><span className="text-xs font-medium text-[#526d7d]">{progress.complete ? 'Quote complete' : progress.canResume ? 'Paused' : progress.needsRevision ? 'Review needed' : 'Pricing in progress'}</span></div>
    <progress className="mt-3 h-2 w-full accent-[#286a54]" value={progress.priced_count} max={Math.max(1, progress.total_count)} aria-label={progress.summary} />
    {!progress.complete && typeof progress.priced_subtotal === 'number' && <p className="mt-2 text-xs leading-relaxed text-[#526d7d]">Priced items subtotal: <strong>{money(progress.priced_subtotal)}</strong>. Remaining items are excluded until their prices are verified.</p>}
    <details className="mt-2" open={!progress.complete}><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[#526d7d]">Prices by window</summary>
      <ul className="divide-y divide-[#d9e2e8]">{progress.lines.map(line => <li key={line.id || line.index} className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:justify-between">
        <div className="min-w-0"><p className="break-words text-sm font-medium text-[#263c49]">{line.index + 1}. {line.room ? line.room + ' · ' : ''}{line.style}</p><p className="mt-1 text-xs text-[#687e8b]">{line.width} × {line.height} in · Qty {line.qty}</p></div>
        <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-[#526d7d]">{line.progress.status === 'priced' ? <><CheckCircle2 size={15} className="text-[#286a54]" /><span>{money(line.progress.total)} · priced</span></> : <><Clock3 size={15} /><span>{line.progress.status === 'online_pending' ? 'AMSCO online quote' : 'Calculating price'}</span></>}</div>
      </li>)}</ul>
    </details>
    {['needs_details', 'needs_sign_in', 'failed'].includes(quote.worker_status) && quote.missing_details?.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-relaxed text-[#8a5a10]">{quote.missing_details.map((question, index) => <li key={index} className="break-words">{question}</li>)}</ul>}
  </section>;
}
