import { HttpError, sha256, validateResult } from './windowQuotesCore.js';
import { validateBuilderDraft, builderScheduleHash, BUILDER_VERSION } from './windowQuoteBuilder.js';
import { createNativePricePreviewService, planNativePricePreview, previewPolicyKey } from './nativePricePreview.js';
import { CONFIGURATION_QUOTE_SOURCE, configurationInputSnapshot } from './nativeConfigurationResult.js';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const cents = value => Math.round(value * 100);
const present = value => value !== undefined && value !== null && value !== '';
const fail = (status, message) => { throw new HttpError(status, message); };

export function createNativeConfigurationQuoteService({ config, now = () => new Date(), hash = sha256 } = {}) {
  const enabled = config?.native_engine?.configuration_quotes === true;
  const previews = createNativePricePreviewService({ config, now, hash });
  async function finalize({ db, q, user }) {
    if (!enabled || !previews.enabled || q?.source?.amsco_configurator?.version !== 1) return null;
    if (q.worker_status === 'ready' && q.result?.native_source === CONFIGURATION_QUOTE_SOURCE) return q;
    if (user?.role !== 'admin' || user.email !== q.requester_email || !user.id) fail(403, 'Only the quote owner may complete these verified configurations');
    if (q.input_revision !== 1 || q.worker_status !== 'draft' || q.result || q.job_id || q.accepted_revision || q.sales_status === 'won' || q.agent_run || q.reviewed_restart ||
        (q.history || []).length || (q.conversation || []).length || present(q.message) || present(q.request_text) || q.intake_assessment || Object.keys(q.checkpoint || {}).length) return null;
    const marker = q.source.visual_builder;
    if (!marker || marker.version !== BUILDER_VERSION || marker.confirmed !== true || Object.keys(marker).some(k => !['version', 'confirmed', 'schedule_hash'].includes(k))) return null;
    const draft = validateBuilderDraft({ settings: q.settings, lines: q.lines, source: q.source }, { submission: true });
    if (await builderScheduleHash(draft) !== marker.schedule_hash) fail(409, 'The windows changed after review. Review them again before saving.');
    if (!planNativePricePreview({ ...draft, id: q.id, input_revision: q.input_revision }).ok) return null;
    const verified = [];
    for (const line of draft.lines) {
      const found = await previews.resolveVerified({ db, user, line, settings: draft.settings });
      if (!found) return null;
      verified.push(found);
    }
    const inputHash = await hash(stable(configurationInputSnapshot(q))), sums = { list: 0, dealer: 0, customer: 0 };
    const lines = draft.lines.map((requested, index) => {
      const row = verified[index], observed = row.result.lines[0];
      const unit = clone(observed.unit_prices), totals = Object.fromEntries(['list', 'dealer', 'customer'].map(kind => {
        const extended = cents(unit[kind]) * requested.qty; sums[kind] += extended; return [kind, extended / 100];
      }));
      return { id: requested.id, source_index: index, ...(requested.mark !== undefined ? { mark: requested.mark } : {}),
        room: requested.room || '', qty: requested.qty, width: requested.width, height: requested.height, units: requested.units, dimension_basis: requested.dimension_basis,
        style: observed.style, frame_dimensions: clone(observed.frame_dimensions), options: clone(observed.options), product_profile_id: observed.product_profile_id,
        unit_prices: unit, line_totals: totals, gross_margin: draft.settings.gross_margin,
        pricing_evidence: { version: 1, preview_id: row.id, plan_hash: row.plan_hash, native_quote_id: row.result.native_quote_id,
          native_line_id: observed.native_line_id, native_line_number: String(observed.native_line_number), native_engine: clone(row.result.native_engine) } };
    });
    const result = { schema_version: 1, native_source: CONFIGURATION_QUOTE_SOURCE, verified: true, quote_id: q.id, input_revision: q.input_revision, input_snapshot_sha256: inputHash,
      dealer: draft.settings.dealer, yard: draft.settings.yard, gross_margin: draft.settings.gross_margin, lines,
      totals: { currency: 'USD', list_total: sums.list / 100, dealer_cost: sums.dealer / 100, customer_total: sums.customer / 100, total: sums.customer / 100,
        tax: 0, freight: 0, labor: 0, gross_margin: draft.settings.gross_margin },
      verification: { version: 1, source: CONFIGURATION_QUOTE_SOURCE, reopened: true, dimension_source: 'saved_native_frame', checked_at: now().toISOString(),
        configuration_count: lines.length, policy: { enabled: true, ...previewPolicyKey(config.native_engine) } },
      notices: [...new Set(verified.flatMap(row => row.result.notices || []))] };
    validateResult(result, { allowConfigurationSet: true, quote: q, inputHash });
    const content = 'Your quote is ready. The total uses the saved and verified AMSCO price for each window.';
    const patch = { worker_status: 'ready', execution_provider: 'deterministic', state_version: (q.state_version || 0) + 1, result, missing_details: [],
      intake_assessment: { version: BUILDER_VERSION, input_revision: q.input_revision, status: 'ready', questions: [], product_review: [], unresolved_requirements: [], assumptions: [] },
      conversation: [{ role: 'assistant', content, revision: q.input_revision, client_message_id: 'configuration-quote:' + inputHash,
        message_at: now().toISOString(), author: 'Window Quotes', kind: 'result', worker_status: 'ready' }] };
    const changed = await db.QuoteRequests.updateMany({ id: q.id, input_revision: q.input_revision, state_version: q.state_version || 0, worker_status: 'draft' }, { $set: patch });
    if (changed.updated !== 1) {
      const rows = await db.QuoteRequests.filter({ id: q.id }, undefined, 1), latest = rows[0];
      if (latest?.worker_status === 'ready' && latest.result?.native_source === CONFIGURATION_QUOTE_SOURCE && latest.result.input_snapshot_sha256 === inputHash) return latest;
      fail(409, 'The quote changed before its verified prices could be saved.');
    }
    return { ...q, ...patch };
  }
  return { enabled, finalize };
}
