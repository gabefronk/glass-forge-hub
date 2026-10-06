import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { isPurchaseOrderOwner } from './purchaseOrderAccess';

// Owner-only live read model. Never creates calendar rows or sends orders.
export function usePurchasingDates(user, refreshKey = 0) {
  const allowed = isPurchaseOrderOwner(user);
  const [state, setState] = useState({ data: null, error: '', loading: false });
  useEffect(() => {
    let active = true, sequence = 0;
    if (!allowed) { setState({ data: null, error: '', loading: false }); return; }
    const load = async () => {
      const version = ++sequence;
      setState(s => ({ ...s, loading: true }));
      try {
        const response = await base44.functions.invoke('procurement', { action: 'overview' });
        if (response.data?.error) throw new Error(response.data.error);
        if (active && version === sequence) setState({ data: response.data, error: '', loading: false });
      } catch {
        if (active && version === sequence) setState({ data: null, error: 'Purchasing dates could not be loaded. Open Purchasing to review the source records.', loading: false });
      }
    };
    load();
    const refresh = () => { if (document.visibilityState !== 'hidden') load(); };
    const timer = setInterval(refresh, 90000);
    window.addEventListener('focus', refresh);
    window.addEventListener('purchasing-updated', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('purchasing-updated', refresh); };
  }, [allowed, refreshKey]);
  return allowed ? state : { data: null, error: '', loading: false };
}
