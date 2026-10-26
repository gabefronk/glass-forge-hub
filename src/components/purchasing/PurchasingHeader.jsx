import { MoreHorizontal } from 'lucide-react';
import { money } from '@/components/budgets/ProcurementForms';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

// Purchasing header band: title and the scope the figures cover (e.g. "Active · 16 jobs"), then
// Sold · Customers owe · Job cost · Est. profit, all from the canonical job ledger (jobLedger.js)
// over exactly the jobs in the grid, and one ⋯ menu. Sold, Job cost and Est. profit cover the
// same jobs (those with a sale price); a job with no sale yet is named on the line below instead
// of adding cost with no profit. Customers owe is the sale less payments on file (bank feed and
// QuickBooks), not an estimate from the job stage. Job cost is money out, so it reads negative.
// On phones the figures sit in a 2 x 2 card.
const BAND = '#0B3F3B', TITLE = '#F2EEE8', LABEL = '#C3CBCC', DIVIDER = 'rgba(242,238,232,.18)';

function Figure({ label, value, title, color = TITLE }) {
  return (
    <div title={title} className="min-w-0 px-5 max-[1023px]:px-3 max-[1023px]:py-2" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="whitespace-nowrap text-[13px] font-medium" style={{ color: LABEL }}>{label}</div>
      <div className="whitespace-nowrap text-[18px] font-bold tabular-nums max-[1023px]:text-[17px]" style={{ color, letterSpacing: '-0.01em' }}>{value == null ? '—' : money(value)}</div>
    </div>
  );
}

export default function PurchasingHeader({ figures, onExport, onReload, reloading }) {
  const notes = [
    figures.noSale.jobs.length > 0 && `No sale yet, not in Job cost or Est. profit: ${figures.noSale.jobs.join(', ')} (${money(-figures.noSale.cost)})`,
    figures.incomplete.jobs.length > 0 && `Crew cost unknown on ${figures.incomplete.jobs.length}: their profit is before crew`,
    !figures.receiptsKnown && 'Bank lines did not load: Customers owe is not shown',
  ].filter(Boolean);
  return (
    <section className="rounded-[12px]" style={{ backgroundColor: BAND }}>
      <div className="flex flex-wrap items-center gap-y-2" style={{ minHeight: '68px', padding: '10px 12px 10px 20px' }}>
        <div className="min-w-0">
          <h1 className="m-0 text-[24px] font-bold max-[1023px]:text-[22px]" style={{ color: TITLE, letterSpacing: '-0.03em' }}>Purchasing</h1>
          <div className="text-[13px] font-medium" style={{ color: LABEL }}>{figures.scope} · from the job ledger</div>
        </div>
        <div style={{ flex: 1 }} />
        <div className="grid grid-cols-4 max-[1023px]:order-last max-[1023px]:w-full max-[1023px]:grid-cols-2 max-[1023px]:overflow-hidden max-[1023px]:rounded-[10px]" style={{ borderColor: DIVIDER }}>
          <Figure label="Sold" value={figures.sale} title={`Sale price of the ${figures.priced} jobs with a sale (the Sale column)`} />
          <Figure label="Customers owe" value={figures.receiptsKnown ? figures.leftToCollect : null} title="Sale less customer payments on file: bank deposits matched to the job and QuickBooks payments (a combined deposit or one after the bank data). Each payment counts once" />
          <Figure label="Job cost" value={figures.cost ? -figures.cost : 0} title="All-in job cost (materials + sub/crew labor + install material) on the same jobs as Sold, as money out" />
          <Figure label="Est. profit" value={figures.profit} title="Sale less all-in job cost, split 50/50 between YA and Glass Forge. No 10% fee and no overhead on these jobs" color="#E0C994" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="More purchasing actions" className="ml-2" style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid rgba(242,238,232,.3)', background: 'none', color: TITLE, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <MoreHorizontal style={{ width: '18px', height: '18px' }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px] p-1">
            <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={onExport}>Export shown jobs (CSV)</DropdownMenuItem>
            <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" disabled={reloading} onSelect={onReload}>{reloading ? 'Reloading…' : 'Reload'}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {notes.length > 0 && (
        <div className="text-[13px]" style={{ padding: '0 20px 10px', color: LABEL }}>{notes.join(' · ')}</div>
      )}
    </section>
  );
}
