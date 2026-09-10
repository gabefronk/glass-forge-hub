import { desktopNativeIdentityIssues, desktopPersistenceIssues, nativeEnginePolicyReady, nativeEnginePresenceReady } from './nativeEngineObservation.js';
import { onlineSelectionIssues } from './onlineSelection.js';

export const CONFIGURATION_QUOTE_SOURCE = 'native_configurations';
export const configurationInputSnapshot = q => ({ quote_id: q.id, input_revision: q.input_revision, settings: q.settings, lines: q.lines });
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const cents = value => finite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 ? Math.round(value * 100) : null;

function onlineEvidenceIssues(evidence, line, requested, quote, verification) {
  const issues = onlineSelectionIssues({ observed: line, line: requested, settings: quote.settings });
  const nativeId = evidence.native_quote_id, observed = evidence.verification;
  const started = Date.parse(evidence.operation_started_at), checked = Date.parse(observed?.checked_at);
  if (evidence.version !== 1 || !id(evidence.child_id) || !id(evidence.operation_id) || !id(evidence.package_id) ||
      evidence.package_id !== quote.pricing_progress?.package_id || !sha(evidence.package_input_hash) || !sha(evidence.selection_hash) ||
      evidence.source_index !== line.source_index || evidence.original_quantity !== requested.qty ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(nativeId || '') ||
      !/^[1-9]\d*$/.test(String(evidence.native_quote_number)) || !id(evidence.native_line_id) || !/^[1-9]\d*$/.test(String(evidence.native_line_number)) ||
      evidence.native_quote_url !== 'https://amsco.wtsparadigm.com/quotes/' + nativeId + '/line-items') issues.push('An online package line requires its saved quote, line, operation and package identity.');
  if (observed?.reopened !== true || observed.dealer !== quote.settings.dealer || observed.yard !== quote.settings.yard || observed.gross_margin !== quote.settings.gross_margin ||
      !Number.isFinite(started) || !Number.isFinite(checked) || checked < started || checked > Date.parse(verification?.checked_at)) issues.push('An online package line requires a matching account and ordered reopen evidence.');
  return issues;
}

// A package is assembled from independently saved native configurations. It
// must never claim that one of their quote IDs identifies the whole package.
export function configurationQuoteResultIssues(result, { quote, inputHash } = {}) {
  const issues = [], reject = message => issues.push(message), verification = result?.verification;
  if (!result || typeof result !== 'object' || !quote || !quote.settings || !Array.isArray(quote.lines)) return ['The verified package requires a saved request and structured pricing result.'];
  if (result?.native_source !== CONFIGURATION_QUOTE_SOURCE || result.verified !== true || result.schema_version !== 1 ||
      !quote || result.quote_id !== quote.id || result.input_revision !== quote.input_revision || !sha(inputHash) || result.input_snapshot_sha256 !== inputHash) reject('The verified package must match this exact saved request revision.');
  if (result?.native_quote_id || result?.native_quote_number || result?.native_quote_url) reject('A configuration package has no single native quote identity.');
  if (verification?.version !== 1 || verification.source !== CONFIGURATION_QUOTE_SOURCE || verification.reopened !== true ||
      verification.dimension_source !== 'saved_native_frame' || !Number.isFinite(Date.parse(verification.checked_at)) || !nativeEnginePolicyReady(verification.policy)) reject('The package requires a verified native pricing policy and reopened configurations.');
  if (!Array.isArray(result?.lines) || !result.lines.length || result.lines.length !== quote?.lines?.length || result.lines.length > 100 || verification?.configuration_count !== result.lines.length) { reject('Every requested line needs a verified configuration.'); return issues; }
  if (result.dealer !== quote.settings?.dealer || result.yard !== quote.settings?.yard || result.gross_margin !== quote.settings?.gross_margin || !finite(result.gross_margin) || result.gross_margin < 0 || result.gross_margin >= 100) reject('The pricing account and margin must match the saved request.');
  const sums = { list: 0, dealer: 0, customer: 0 };
  for (const [index, line] of result.lines.entries()) {
    const requested = quote.lines[index], evidence = line?.pricing_evidence, proof = evidence?.native_engine;
    if (!line || typeof line !== 'object' || !requested || typeof requested !== 'object') { reject('Every package line must match a structured requested window.'); continue; }
    if (line?.source_index !== index || line.qty !== requested.qty || !Number.isSafeInteger(line.qty) || line.qty < 1 || line.qty > 1000 ||
        line.width !== requested.width || line.height !== requested.height || line.units !== requested.units || line.dimension_basis !== requested.dimension_basis || line.room !== (requested.room || '') || line.mark !== requested.mark) reject('A package line differs from the requested size, quantity, room or mark.');
    if (!line?.style || line.gross_margin !== result.gross_margin || !line.frame_dimensions || ![line.frame_dimensions.width, line.frame_dimensions.height].every(v => finite(v) && v > 0) || line.frame_dimensions.units !== 'in') reject('A package line lacks verified dimensions or margin.');
    if (evidence?.source === 'amsco_online') issues.push(...onlineEvidenceIssues(evidence, line, requested, quote, verification));
    else {
    if (!evidence || evidence.source && evidence.source !== 'desktop_native' || evidence.version !== 1 || !id(evidence.preview_id) || !sha(evidence.plan_hash) || !id(evidence.native_line_id) || !/^[1-9]\d*$/.test(String(evidence.native_line_number)) ||
        desktopNativeIdentityIssues({ native_source: 'desktop_native', native_quote_id: evidence.native_quote_id }).length ||
        proof?.engine !== 'amsco-navigator' || proof.plan_hash !== evidence.plan_hash || !id(proof.operation_id) ||
        !nativeEnginePresenceReady({ state: 'ready', ...proof }, verification?.policy) || desktopPersistenceIssues(proof.persistence).length) reject('A package line lacks its saved native pricing evidence.');
    const stages = proof?.stages;
    if (!stages || !['before_save', 'after_save', 'reopened'].every(name => Number.isFinite(Date.parse(stages[name]?.at)) && sha(stages[name]?.snapshot_sha256)) ||
        stages.before_save.snapshot_sha256 !== stages.after_save.snapshot_sha256 || stages.before_save.snapshot_sha256 !== stages.reopened.snapshot_sha256 ||
        stages.after_save.artifact_sha256 !== proof?.persistence?.artifact_sha256 || stages.reopened.artifact_sha256 !== proof?.persistence?.artifact_sha256 ||
        Date.parse(stages.before_save.at) > Date.parse(stages.after_save.at) || Date.parse(stages.after_save.at) > Date.parse(stages.reopened.at) || Date.parse(stages.reopened.at) > Date.parse(verification?.checked_at)) reject('A package line requires consistent ordered save and reopen evidence.');
    }
    for (const kind of ['list', 'dealer', 'customer']) {
      const unit = cents(line.unit_prices?.[kind]), total = cents(line.line_totals?.[kind]);
      if (unit === null || unit <= 0 || total === null || total !== unit * line.qty) reject('Package prices must be positive native unit cents with exact quantity extensions.');
      else sums[kind] += total;
    }
    if (Math.abs(cents(line.unit_prices?.customer) - Math.round(cents(line.unit_prices?.dealer) / (1 - result.gross_margin / 100))) > 1) reject('The package price differs from the saved margin.');
  }
  const totals = result.totals;
  if (totals?.currency !== 'USD' || totals.gross_margin !== result.gross_margin || ['tax', 'freight', 'labor'].some(key => totals[key] !== 0)) reject('The package uses USD window-only pricing before tax, freight and labor.');
  for (const [field, kind] of [['list_total', 'list'], ['dealer_cost', 'dealer'], ['customer_total', 'customer'], ['total', 'customer']]) if (cents(totals?.[field]) !== sums[kind]) reject('Package totals must equal the sum of its verified lines.');
  return issues;
}
