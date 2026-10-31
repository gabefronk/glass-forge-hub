import React, { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Owner click → server signs the receipt-bound private PDF for 60s → opens it.
// The private ref never reaches the browser; only the short-lived link does.
// Shared with the budget card's menu: opens the tab first (popup blockers), then signs.
export async function openPrivateSource(budgetId) {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  try {
    const res = await base44.functions.invoke('purchasingQuoteIngest', { action: 'sign_source', budget_id: budgetId });
    const url = (res?.data || res)?.signed_url;
    if (!url || !/^https:\/\//.test(url)) throw new Error('unavailable');
    if (win) win.location.href = url; else window.location.assign(url);
  } catch (e) {
    if (win) win.close();
    throw new Error(String(e?.response?.data?.error || 'Source unavailable').slice(0, 80));
  }
}

export default function PrivateSourceButton({ budgetId, className, style, label = 'Source quote' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    setBusy(true); setError('');
    try {
      await openPrivateSource(budgetId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={open} disabled={busy} className={className} style={style} title={error || 'Open source quote'}>
      {error ? error : label}
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
    </button>
  );
}