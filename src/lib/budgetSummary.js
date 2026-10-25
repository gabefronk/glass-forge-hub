// The four summary boxes on a job's Budget & Orders page (Gabriel, Oct 24): Budget
// cost and Customer total can be typed by hand (Jobs.manual_budget_cost /
// manual_customer_total) and win over the quote roll-up; Margin dollars and Margin %
// follow from the two. Display only - nothing here feeds Purchasing, invoicing or any
// other figure. Pure: no React, no SDK.

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

// Typed text → dollars: "$12,480.50" → 12480.5; blank → null (back to the quotes);
// anything else → undefined (invalid, nothing saved).
export function parseDollars(text) {
  const s = String(text ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return undefined;
  return round2(Number(s));
}

// green ≥ 25%, amber 15–25%, red < 15%.
export function marginTone(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  return pct >= 0.25 ? 'green' : pct >= 0.15 ? 'amber' : 'red';
}

export function budgetSummary(job = {}, rollup = {}) {
  const manualCost = num(job?.manual_budget_cost);
  const manualSell = num(job?.manual_customer_total);
  const quoteCost = num(rollup?.cost);
  const quoteSell = num(rollup?.sell);
  const anyManual = manualCost != null || manualSell != null;
  const cost = manualCost ?? quoteCost;
  const sell = manualSell ?? quoteSell;
  // With nothing typed, the margin boxes read exactly as before (the roll-up's own figures).
  let marginDollars, marginPct;
  if (anyManual) {
    marginDollars = cost != null && sell != null ? round2(sell - cost) : null;
    marginPct = marginDollars != null && sell ? marginDollars / sell : null;
  } else {
    marginDollars = num(rollup?.margin_dollars);
    marginPct = num(rollup?.margin_pct);
  }
  return {
    cost, sell, marginDollars, marginPct, tone: marginTone(marginPct), anyManual,
    manualCost, manualSell, quoteCost, quoteSell,
    reviewWarning: !anyManual && rollup?.status !== 'ready',
  };
}
