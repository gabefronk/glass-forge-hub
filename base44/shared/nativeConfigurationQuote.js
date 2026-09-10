import { configurationReadyPatch } from './configurationReadyPatch.js';
import { HttpError, sha256 } from './windowQuotesCore.js';
import { validateBuilderDraft, builderScheduleHash, BUILDER_VERSION } from './windowQuoteBuilder.js';
import { createNativePricePreviewService, planNativePricePreview } from './nativePricePreview.js';
import { CONFIGURATION_QUOTE_SOURCE } from './nativeConfigurationResult.js';

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
    const patch = await configurationReadyPatch({ q, verified, config, checkedAt: now().toISOString(), hash });
    const inputHash = patch.result.input_snapshot_sha256;
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
