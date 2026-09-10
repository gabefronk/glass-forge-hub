export function packageProgress(quote) {
  const progress = quote?.pricing_progress;
  if (progress?.version !== 1 || progress.input_revision !== quote.input_revision || !Array.isArray(quote.lines) ||
      progress.total_count !== quote.lines.length || !Number.isInteger(progress.priced_count) || progress.priced_count < 0 || progress.priced_count > progress.total_count) return null;
  const priced = progress.priced_count, total = progress.total_count;
  const complete = quote.worker_status === 'ready' && quote.result?.verified === true && priced === total;
  return { ...progress, complete, total: complete ? quote.result?.totals?.customer_total ?? null : null,
    summary: `${priced} of ${total} items priced`,
    canResume: ['failed', 'needs_sign_in'].includes(quote.worker_status),
    needsRevision: quote.worker_status === 'needs_details',
    lines: quote.lines.map((line, index) => ({ ...line, index, progress: (progress.lines || []).find(item => item.index === index) || { status: 'pending' } })) };
}

export function packageStatus(quote) {
  const progress = packageProgress(quote); if (!progress) return null;
  if (progress.complete) return { label: 'Ready', text: 'Every window has a saved and verified AMSCO price.' };
  if (progress.needsRevision) return { label: 'Review window choices', text: 'A requested selection needs review. Use Revise windows to make the change with the AI guide, then review and price the new schedule.' };
  if (progress.canResume) return { label: quote.worker_status === 'needs_sign_in' ? 'Needs sign-in' : 'Retry pricing', text: quote.worker_status === 'needs_sign_in'
    ? 'Your completed prices are saved. Reconnect the AMSCO quoting browser, then choose Retry after sign-in to resume the remaining work.'
    : 'Your completed prices and saved AMSCO work are retained. Retry pricing to resume the remaining items.' };
  return { label: progress.native_pending_count ? 'Calculating' : 'AMSCO pricing', text: progress.native_pending_count
    ? 'Your windows are being priced. Completed prices are saved as the remaining items finish.'
    : 'The remaining selections need an AMSCO online quote. Your other window prices are saved; the final total appears when every item is verified.' };
}
