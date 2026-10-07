// Compact Purchasing header: title + count bar on one line (wraps on mobile),
// quiet text reload on the right. No eyebrow or prose subtitle.
export default function PurchasingHeader({ counts, loading, onReload }) {
  return (
    <section className="rounded-[14px] px-5 py-3 max-[699px]:px-4" style={{ background: 'linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)' }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <h1 className="m-0 text-[22px] font-bold leading-[28px]" style={{ color: '#f2eee8', letterSpacing: '-0.03em' }}>Purchasing</h1>
        <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-0.5 text-[12.5px]" style={{ color: '#c9d0d1' }}>
          <span><strong className="text-white">{counts.jobs}</strong> jobs</span>
          <span><strong className="text-white">{counts.budgets}</strong> quotes</span>
          <span><strong className="text-white">{counts.orders}</strong> POs</span>
          <span><strong className="text-white">{counts.tracking}</strong> confirmations</span>
          <button type="button" disabled={loading} onClick={onReload} className="ml-auto text-[12px] font-medium underline disabled:opacity-60" style={{ color: '#aeb5b7', minHeight: 0 }}>{loading ? 'Reloading…' : 'Reload'}</button>
        </div>
      </div>
    </section>
  );
}