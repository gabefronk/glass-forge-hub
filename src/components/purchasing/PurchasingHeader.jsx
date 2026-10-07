// Compact Purchasing header: title + count bar on one line (wraps on mobile),
// quiet text reload on the right. No eyebrow or prose subtitle.
export default function PurchasingHeader({ counts, loading, onReload }) {
  return (
    <section className="rounded-[12px] px-4 py-2 max-[699px]:px-3" style={{ background: 'linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)' }}>
      <div className="flex items-center gap-x-4 gap-y-0 max-[699px]:flex-wrap">
        <h1 className="m-0 shrink-0 text-[19px] font-bold leading-[24px]" style={{ color: '#f2eee8', letterSpacing: '-0.03em' }}>Purchasing</h1>
        <div className="flex min-w-0 flex-1 items-center gap-x-3.5 text-[12px]" style={{ color: '#c9d0d1' }}>
          <span><strong className="text-white">{counts.jobs}</strong> jobs</span>
          <span><strong className="text-white">{counts.budgets}</strong> quotes</span>
          <span><strong className="text-white">{counts.orders}</strong> POs</span>
          <span><strong className="text-white">{counts.tracking}</strong> confirmations</span>
          <button type="button" disabled={loading} onClick={onReload} className="ml-auto shrink-0 text-[11.5px] font-medium underline disabled:opacity-60" style={{ color: '#aeb5b7', minHeight: 0 }}>{loading ? 'Reloading…' : 'Reload'}</button>
        </div>
      </div>
    </section>
  );
}