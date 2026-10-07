// Compact Purchasing header: title + count bar (wraps on mobile, min-w-0 so
// the header stays contained). The Reload control lives OUTSIDE the header
// (desktop, right) and inside the More section on mobile — never in the band.
export default function PurchasingHeader({ counts }) {
  return (
    <section className="rounded-[12px] px-4 py-2 max-[699px]:px-3" style={{ background: 'linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)' }}>
      <div className="flex items-center gap-x-4 gap-y-1 max-[699px]:flex-wrap">
        <h1 className="m-0 shrink-0 text-[19px] font-bold leading-[24px]" style={{ color: '#f2eee8', letterSpacing: '-0.03em' }}>Purchasing</h1>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px]" style={{ color: '#c9d0d1' }}>
          <span><strong className="text-white">{counts.jobs}</strong> jobs</span>
          <span><strong className="text-white">{counts.budgets}</strong> quotes</span>
          <span><strong className="text-white">{counts.orders}</strong> POs</span>
          <span><strong className="text-white">{counts.tracking}</strong> confirmations</span>
        </div>
      </div>
    </section>
  );
}