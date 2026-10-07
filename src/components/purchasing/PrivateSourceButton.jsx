import React, { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';

// Owner click → server signs the receipt-bound private PDF for 60s → opens it.
// The private ref never reaches the browser; only the short-lived link does.
export default function PrivateSourceButton({ budgetId, className, style }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function open() {
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    setBusy(true); setError('');
    try {
      const res = await base44.functions.invoke('purchasingQuoteIngest', { action: 'sign_source', budget_id: budgetId });
      const url = (res?.data || res)?.signed_url;
      if (!url || !/^https:\/\//.test(url)) throw new Error('unavailable');
      if (win) win.location.href = url; else window.location.assign(url);
    } catch (e) {
      if (win) win.close();
      setError(String(e?.response?.data?.error || 'Source unavailable').slice(0, 80));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={open} disabled={busy} className={className} style={style} title={error || 'Open source quote'}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
      {error ? error : 'Source quote'}
    </button>
  );
}