// Helpers for the Company overview and the job ledger (Gabe, Oct 26). Pure.
//  - cardFigure: a Purchasing card's figure the way Purchasing shows it, unknown kept null.
//  - earnTiming: when a job is expected to earn, from its stage and supplier ETAs.
//  - importedLaborDiagnostic: the July imported-lines diagnostic, kept apart from every actual.
// Job money itself lives in the canonical job ledger (jobLedger.js).
import { computeLaborAmt } from './feeMath.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// When the job is expected to earn: installed or delivered jobs are this year; otherwise the
// latest ETA on its pending supplier orders. A December ETA is flagged: install may slip to 2027.
export function earnTiming(stage, orders = []) {
  if (['installed', 'delivered'].includes(stage)) return { year: '2026', label: '2026 (installed / delivered)' };
  const etas = orders.filter((o) => !o.received_date && o.eta_date).map((o) => String(o.eta_date).slice(0, 10)).sort();
  const eta = etas[etas.length - 1];
  if (!eta) return { year: 'unknown', label: 'Unknown (no supplier ETA)' };
  if (eta > '2026-12-31') return { year: '2027', label: `2027 (ETA ${eta})`, eta };
  if (eta >= '2026-12-01') return { year: '2026?', label: `2026, at risk (ETA ${eta})`, eta };
  return { year: '2026', label: `2026 (ETA ${eta})`, eta };
}

// A Purchasing card's figure the way Purchasing shows it: the job row's own value, or, when a
// multi-scope job row withholds it (applyScopeRollup), the sum of its scope rows. Unlike the
// Purchasing bar's totals, a missing figure stays null here (unknown, never 0).
const ACCESS = { windows: [(c) => c.windows?.display, (s) => s.windows], rough: [(c) => c.rough?.display, (s) => s.rough], sale: [(c) => c.sale?.display, (s) => s.sale] };
export function cardFigure(card, field) {
  const [job, scope] = ACCESS[field];
  const own = job(card);
  if (!own?.suppressed) return num(own?.value);
  const values = (card.scopes || []).map((s) => num(scope(s)?.value));
  return !values.length || values.some((v) => v == null) ? null : round(values.reduce((n, v) => n + v, 0));
}

// July diagnostic (Gabe, Oct 26): imported sheet lines the earned formula leaves out because they
// carry a stored labor amount but no calendar amount, man hours or trips. Shown only as "July would
// be X if these lines are valid"; never added to actuals.
export function importedLaborDiagnostic(feeLines = [], month = '2026-07') {
  const lines = feeLines.filter((r) => r.invoice_month === month && r.source === 'sheet-import' && r.billable !== false
    && !r.superseded_by && (num(r.labor_amt) || 0) > 0 && computeLaborAmt(r) === 0);
  const labor = round(lines.reduce((n, r) => n + (num(r.labor_amt) || 0), 0));
  return { month, count: lines.length, labor, fee: round(labor * 0.1) };
}
