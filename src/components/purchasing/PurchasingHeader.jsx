import { MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { money } from '@/components/budgets/ProcurementForms';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';

// Purchasing header band (declutter, Oct 24): title, then Sold · Customers owe · We owe
// suppliers · Est. profit over exactly the jobs shown (headerFigures in
// purchasingSummary.js), and one ⋯ menu. On phones the figures sit in a 2 x 2 card.
// How each figure is worked out is in its hover title, not in caption text.
const BAND = '#0B3F3B', TITLE = '#F2EEE8', LABEL = '#C3CBCC', DIVIDER = 'rgba(242,238,232,.18)';

function Figure({ label, value, title, color = TITLE }) {
  return (
    <div title={title} className="min-w-0 px-5 max-[1023px]:px-3 max-[1023px]:py-2" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="whitespace-nowrap text-[13px] font-medium" style={{ color: LABEL }}>{label}</div>
      <div className="whitespace-nowrap text-[18px] font-bold tabular-nums max-[1023px]:text-[17px]" style={{ color, letterSpacing: '-0.01em' }}>{money(value)}</div>
    </div>
  );
}

export default function PurchasingHeader({ figures, onExport, onReload, reloading }) {
  const navigate = useNavigate();
  const partial = [
    figures.partialScopes > 0 && `${figures.partialScopes} multi-scope job(s) have a scope with no figure`,
    figures.apMissing > 0 && `${figures.apMissing} unpaid supplier record(s) have no amount`,
  ].filter(Boolean).join('; ');
  return (
    <section className="rounded-[12px]" style={{ backgroundColor: BAND }}>
      <div className="flex flex-wrap items-center gap-y-2" style={{ minHeight: '68px', padding: '10px 12px 10px 20px' }}>
        <h1 className="m-0 text-[24px] font-bold max-[1023px]:text-[22px]" style={{ color: TITLE, letterSpacing: '-0.03em' }}>Purchasing</h1>
        <div style={{ flex: 1 }} />
        <div className="grid grid-cols-4 max-[1023px]:order-last max-[1023px]:w-full max-[1023px]:grid-cols-2 max-[1023px]:overflow-hidden max-[1023px]:rounded-[10px]" style={{ borderColor: DIVIDER }}>
          <Figure label="Sold" value={figures.sold} title={`Total sale price of the ${figures.jobs} jobs shown (the Sale column)`} />
          <Figure label="Customers owe" value={figures.customersOwe} title="Sale less payments by stage: half down owes half, full payment owes nothing, any other stage owes the whole sale" />
          <Figure label="We owe suppliers" value={figures.weOwe} title={`Unpaid POs at the raw PO amount, before the 7.45% use tax${partial ? `. Partial: ${partial}` : ''}`} />
          <Figure label="Est. profit" value={figures.profit} title={`The Est. profit column${partial ? `. Partial: ${partial}` : ''}`} color="#E0C994" />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button aria-label="More purchasing actions" className="ml-2" style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid rgba(242,238,232,.3)', background: 'none', color: TITLE, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <MoreHorizontal style={{ width: '18px', height: '18px' }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px] p-1">
            <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={() => navigate('/purchasing/supplier-eta')}>Supplier ETA links</DropdownMenuItem>
            <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={onExport}>Export shown jobs (CSV)</DropdownMenuItem>
            <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" disabled={reloading} onSelect={onReload}>{reloading ? 'Reloading…' : 'Reload'}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </section>
  );
}
