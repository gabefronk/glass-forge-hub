import { HttpError, sha256, validateResult } from './windowQuotesCore.js';
import { BUILDER_VERSION } from './windowQuoteBuilder.js';
import { previewPolicyKey } from './nativePricePreview.js';
import { CONFIGURATION_QUOTE_SOURCE, configurationInputSnapshot } from './nativeConfigurationResult.js';
const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const cents = value => Math.round(value * 100);
const fail = (status, message) => { throw new HttpError(status, message); };

// The same composer serves immediate cache hits and packages completed over time.
// It has no persistence side effects; its caller owns the exact parent CAS.
export async function configurationReadyPatch({ q, verified, work, config, policy = config?.native_engine, checkedAt = new Date().toISOString(), hash = sha256 }) {
  if (!q || !Array.isArray(q.lines) || !Array.isArray(verified) || verified.length !== q.lines.length) fail(502, 'Every requested window needs verified pricing');
  config = { native_engine: policy };
  const selectionHashes = await Promise.all(q.lines.map((line, index) => work ? hash(stable({ package_id: work.id, input_hash: work.input_hash, index, settings: q.settings, line })) : null));
    const inputHash = await hash(stable(configurationInputSnapshot(q))), sums = { list: 0, dealer: 0, customer: 0 };
    const lines = q.lines.map((requested, index) => {
      const row = verified[index], observed = row?.result?.lines?.[0];
      if (!observed || row.result.lines.length !== 1) fail(502, 'Every window needs its own verified price');
      const online = row.source === 'amsco_online';
      if (online && (!work || row.online_evidence?.package_id !== work.id || row.online_evidence?.package_input_hash !== work.input_hash || row.online_evidence?.source_index !== index || row.id !== row.online_evidence?.child_id || row.online_evidence?.selection_hash !== selectionHashes[index])) fail(502, 'The online price belongs to a different window package');
      const unit = clone(observed.unit_prices), totals = Object.fromEntries(['list', 'dealer', 'customer'].map(kind => {
        const extended = cents(unit[kind]) * requested.qty; sums[kind] += extended; return [kind, extended / 100];
      }));
      return { id: requested.id, source_index: index, ...(requested.mark !== undefined ? { mark: requested.mark } : {}),
        room: requested.room || '', qty: requested.qty, width: requested.width, height: requested.height, units: requested.units, dimension_basis: requested.dimension_basis,
        style: observed.style, frame_dimensions: clone(observed.frame_dimensions), options: clone(observed.options), product_profile_id: observed.product_profile_id,
        unit_prices: unit, line_totals: totals, gross_margin: q.settings.gross_margin,
        pricing_evidence: online ? { ...clone(row.online_evidence), source: 'amsco_online' } : { version: 1, preview_id: row.id, plan_hash: row.plan_hash, native_quote_id: row.result.native_quote_id,
          native_line_id: observed.native_line_id, native_line_number: String(observed.native_line_number), native_engine: clone(row.result.native_engine) } };
    });
    const result = { schema_version: 1, native_source: CONFIGURATION_QUOTE_SOURCE, verified: true, quote_id: q.id, input_revision: q.input_revision, input_snapshot_sha256: inputHash,
      dealer: q.settings.dealer, yard: q.settings.yard, gross_margin: q.settings.gross_margin, lines,
      totals: { currency: 'USD', list_total: sums.list / 100, dealer_cost: sums.dealer / 100, customer_total: sums.customer / 100, total: sums.customer / 100,
        tax: 0, freight: 0, labor: 0, gross_margin: q.settings.gross_margin },
      verification: { version: 1, source: CONFIGURATION_QUOTE_SOURCE, reopened: true, dimension_source: 'saved_native_frame', checked_at: checkedAt,
        configuration_count: lines.length, policy: { enabled: true, ...previewPolicyKey(config.native_engine) } },
      notices: [...new Set(verified.flatMap(row => row.result.notices || []))] };
    validateResult(result, { allowConfigurationSet: true, quote: q, inputHash });
    const content = 'Your quote is ready. The total uses the saved and verified AMSCO price for each window.';
    const patch = { worker_status: 'ready', execution_provider: 'deterministic', state_version: (q.state_version || 0) + 1, result, missing_details: [],
      intake_assessment: { version: BUILDER_VERSION, input_revision: q.input_revision, status: 'ready', questions: [], product_review: [], unresolved_requirements: [], assumptions: [] },
      conversation: [...(q.conversation || []), { role: 'assistant', content, revision: q.input_revision, client_message_id: 'configuration-quote:' + inputHash,
        message_at: checkedAt, author: 'Window Quotes', kind: 'result', worker_status: 'ready' }] };
    return patch;
}
