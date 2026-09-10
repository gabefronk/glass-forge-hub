import { onlineSelectionIssues } from './onlineSelection.js';
import { validateResult } from './windowQuotesCore.js';

const clone = value => structuredClone(value);
const present = value => value !== undefined && value !== null && value !== '';
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const cents = value => finite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 ? Math.round(value * 100) : null;

// An online calculation is a saved quote observation, not a model estimate. The
// caller retains the operation capability and checkpoint; this adds exact
// comparison with the one immutable window delegated from its parent package.
export function verifyOnlineConfigurationResult({ child, line, settings, now = new Date() }) {
  const issues = [], reject = message => issues.push(message);
  let result;
  try { result = validateResult(clone(child?.result)); }
  catch { return { ok: false, issues: ['The remaining window needs a valid saved AMSCO online result.'] }; }
  if (result.native_source === 'desktop_native' || result.native_source === 'native_configurations' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.native_quote_id || '') || !/^[1-9]\d*$/.test(result.native_quote_number || '')) reject('The online result needs its actual AMSCO quote number and identity.');
  const verification = child?.agent_run?.verification;
  const started = Date.parse(child?.agent_run?.started_at), checked = Date.parse(verification?.checked_at);
  if (verification?.reopened !== true || !Number.isFinite(started) || !Number.isFinite(checked) || checked < started || checked > new Date(now).getTime() + 60000 ||
      verification.dealer !== settings?.dealer || verification.yard !== settings?.yard || verification.gross_margin !== settings?.gross_margin ||
      child.checkpoint?.native_quote_id !== result.native_quote_id) reject('The saved quote must be reopened for this operation with the requested pricing account and margin.');
  if (!line || !settings || result.lines.length !== 1 || child.lines?.length !== 1) return { ok: false, issues: [...issues, 'Exactly the delegated window must be priced.'] };
  const observed = result.lines[0], options = observed?.options;
  if (!observed || typeof observed !== 'object' || !options || typeof options !== 'object' || Array.isArray(options)) return { ok: false, issues: [...issues, 'Observed product options are required.'] };
  if (!id(observed.native_line_id) || !/^[1-9]\d*$/.test(String(observed.native_line_number))) reject('The saved native line identity is missing.');
  if (observed.qty !== line.qty || observed.width !== line.width || observed.height !== line.height || observed.units !== line.units || observed.dimension_basis !== line.dimension_basis || observed.room !== (line.room || '')) reject('The observed quantity, dimensions, measurement basis or room differs from the delegated window.');
  issues.push(...onlineSelectionIssues({ observed, line, settings }));
  const prices = {};
  for (const kind of ['list', 'dealer', 'customer']) {
    const unit = cents(observed.unit_prices?.[kind]), total = cents(observed.line_totals?.[kind]);
    if (unit === null || unit <= 0 || total === null || total !== unit * line.qty) reject('Saved positive unit prices and exact quantity extensions are required.');
    prices[kind] = total;
  }
  if (!finite(settings.gross_margin) || settings.gross_margin < 0 || settings.gross_margin >= 100 ||
      Math.abs(cents(observed.unit_prices?.customer) - Math.round(cents(observed.unit_prices?.dealer) / (1 - settings.gross_margin / 100))) > 1) reject('The observed customer price differs from the requested margin.');
  if (result.totals.currency !== 'USD' || cents(result.totals.customer_total) !== prices.customer || cents(result.totals.total) !== prices.customer ||
      cents(result.totals.dealer_cost) !== prices.dealer || present(result.totals.list_total) && cents(result.totals.list_total) !== prices.list ||
      ['tax', 'freight', 'labor'].some(key => present(result.totals[key]) && result.totals[key] !== 0)) reject('The online total must equal this window’s saved prices before tax, freight or labor.');
  if (issues.length) return { ok: false, issues };
  return { ok: true, verified: { id: child.id, source: 'amsco_online', quote_id: child.id, input_revision: 1,
    result: { ...result, native_source: 'amsco_online', dealer: settings.dealer, yard: settings.yard, gross_margin: settings.gross_margin,
      verification: { ...clone(verification), source: 'amsco_online', dimension_source: 'saved_native_frame' },
      lines: [{ ...observed, qty: 1, line_totals: clone(observed.unit_prices), gross_margin: settings.gross_margin }],
      totals: { currency: 'USD', list_total: observed.unit_prices.list, dealer_cost: observed.unit_prices.dealer, customer_total: observed.unit_prices.customer, total: observed.unit_prices.customer,
        gross_margin: settings.gross_margin, tax: 0, freight: 0, labor: 0 } },
    online_evidence: { version: 1, child_id: child.id, package_id: child.package_id, package_input_hash: child.package_input_hash, operation_started_at: child.agent_run.started_at, operation_id: child.agent_run.operation_id, source_index: child.source_index, selection_hash: child.selection_hash,
      original_quantity: line.qty, native_quote_id: result.native_quote_id, native_quote_number: result.native_quote_number, native_quote_url: result.native_quote_url,
      native_line_id: observed.native_line_id, native_line_number: String(observed.native_line_number), verification: clone(verification) } } };
}
