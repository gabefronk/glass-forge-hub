import { HttpError, sha256 } from './windowQuotesCore.js';
import { validateBuilderDraft, builderScheduleHash, BUILDER_VERSION } from './windowQuoteBuilder.js';
import { createNativePricePreviewService, planNativePricePreview, previewPolicyKey } from './nativePricePreview.js';
import { configurationInputSnapshot } from './nativeConfigurationResult.js';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const present = value => value !== undefined && value !== null && value !== '';
const fail = (status, message) => { throw new HttpError(status, message); };
const INCOMPLETE = ['preparing', 'pending'];
const ONLINE_CODES = new Set(['unsupported_product', 'unverified_product', 'unsupported_option', 'unsupported_colors', 'unsupported_dimensions', 'unsupported_assembly', 'unsupported_grilles']);

// All work records are private. The public QuoteRequest only receives a bounded
// progress projection; its complete reviewed schedule is never replaced by the
// subset that still needs a calculation or online configuration.
export function createConfigurationPackageCoordinator({ config, now = () => new Date(), hash = sha256, uuid = () => crypto.randomUUID(),
  previews = createNativePricePreviewService({ config, now, hash }), plan = planNativePricePreview, online, complete } = {}) {
  const enabled = config?.native_engine?.configuration_packages === true && previews.enabled;
  if (enabled && typeof complete !== 'function') fail(503, 'A verified package completion service is required');
  const digest = value => hash(stable(value)), at = () => now().toISOString();
  const packages = db => db.WindowQuoteConfigurationPackages;
  const policy = () => previewPolicyKey(config.native_engine);
  const inputHash = q => digest({ input: configurationInputSnapshot(q), source: q.source });
  const getQuote = async (db, quoteId) => (await db.QuoteRequests.filter({ id: quoteId }, undefined, 1))[0];
  const getPackage = async (db, packageId) => (await packages(db).filter({ id: packageId }, undefined, 1))[0];
  const isCurrent = async (q, work) => !!q && q.id === work.quote_id && q.requester_email === work.owner_email &&
    q.input_revision === work.input_revision && q.pricing_progress?.package_id === work.id && await inputHash(q) === work.input_hash &&
    stable(work.policy) === stable(policy()) && await inputHash({ id: work.quote_id, input_revision: work.input_revision, ...work.snapshot }) === work.input_hash &&
    Array.isArray(work.items) && work.items.length === q.lines.length && work.items.every((item, index) => item.index === index && ['native_pending', 'online_pending', 'priced'].includes(item.state));

  async function eligible(q, user) {
    if (!enabled || q?.source?.amsco_configurator?.version !== 1) return null;
    if (user?.role !== 'admin' || !id(user.id) || user.email !== q.requester_email) fail(403, 'Only this quote owner may submit its reviewed window package');
    if (q.input_revision !== 1 || q.worker_status !== 'draft' || q.result || q.agent_run || q.pricing_progress || q.job_id || q.accepted_revision || q.sales_status === 'won' ||
        q.reviewed_restart || (q.history || []).length || (q.conversation || []).length || present(q.message) || present(q.request_text) || q.intake_assessment || Object.keys(q.checkpoint || {}).length) return null;
    const marker = q.source.visual_builder;
    if (!marker || marker.version !== BUILDER_VERSION || marker.confirmed !== true || Object.keys(marker).some(key => !['version', 'confirmed', 'schedule_hash'].includes(key))) return null;
    const draft = validateBuilderDraft({ settings: q.settings, lines: q.lines, source: q.source }, { submission: true });
    if (draft.lines.length > 100) fail(400, 'Split this package into schedules of at most 100 lines');
    if (await builderScheduleHash(draft) !== marker.schedule_hash) fail(409, 'The schedule changed after review. Review it again before pricing');
    const routes = draft.lines.map(line => plan({ id: 'package-route', input_revision: 1, settings: draft.settings, lines: [line] }));
    if (routes.some(route => !route.ok && (!route.issues?.length || route.issues.some(issue => !ONLINE_CODES.has(issue.code))))) return null;
    if (routes.some(route => !route.ok) && !online?.configured) return null;
    return { draft, routes };
  }

  async function start({ db, q, user }) {
    if (!enabled) return null;
    if (q?.pricing_progress?.package_id) {
      const work = await getPackage(db, q.pricing_progress.package_id);
      if (work && work.owner_id === user?.id && user?.role === 'admin' && user.email === q.requester_email && await isCurrent(q, work)) {
        if (q.worker_status === 'needs_details') fail(409, 'Revise the windows to resolve the reported product conflict, then review the new schedule before pricing');
        if (['failed', 'needs_sign_in'].includes(q.worker_status)) {
          if (work.lease_token && Date.parse(work.lease_until) > now().getTime()) fail(409, 'The prior pricing attempt is still finishing');
          const patch = { worker_status: 'queued', missing_details: [], state_version: (q.state_version || 0) + 1,
            pricing_progress: { ...q.pricing_progress, resume_count: (q.pricing_progress.resume_count || 0) + 1, updated_at: at() } };
          const updated = await db.QuoteRequests.updateMany({ id: q.id, input_revision: q.input_revision, state_version: q.state_version || 0, worker_status: q.worker_status }, { $set: patch });
          if (updated.updated !== 1) fail(409, 'The quote changed before its saved pricing attempt could resume');
          q = { ...q, ...patch };
        }
        // Parent-first resume is recoverable after a lost acknowledgement. Keep
        // every priced receipt and private child's native checkpoint in place.
        if (q.worker_status === 'queued' && ['needs_attention', 'pending'].includes(work.status) && (q.pricing_progress.resume_count || 0) > (work.resume_count || 0)) {
          await packages(db).updateMany({ id: work.id, state_version: work.state_version, status: work.status }, { $set: { status: 'pending', resume_count: q.pricing_progress.resume_count, updated_at: at() } });
        }
        return q;
      }
      fail(409, 'The saved pricing package no longer matches this request');
    }
    const selected = await eligible(q, user); if (!selected) return null;
    const work = await packages(db).create({ version: 1, quote_id: q.id, input_revision: q.input_revision, owner_id: user.id, owner_email: user.email,
      input_hash: await inputHash(q), policy: policy(), status: 'preparing', state_version: 0, created_at: at(), updated_at: at(),
      snapshot: { settings: clone(q.settings), lines: clone(q.lines), source: clone(q.source), title: q.title },
      items: selected.routes.map((route, index) => ({ index, state: route.ok ? 'native_pending' : 'online_pending' })), lease_token: '', lease_until: '' });
    const progress = { version: 1, package_id: work.id, input_revision: q.input_revision, total_count: q.lines.length, priced_count: 0,
      native_pending_count: work.items.filter(item => item.state === 'native_pending').length, online_pending_count: work.items.filter(item => item.state === 'online_pending').length,
      priced_subtotal: null, total: null, currency: 'USD', updated_at: at() };
    const patch = { worker_status: 'queued', execution_provider: 'deterministic', state_version: (q.state_version || 0) + 1, queued_at: at(), pricing_progress: progress, missing_details: [] };
    const changed = await db.QuoteRequests.updateMany({ id: q.id, input_revision: q.input_revision, state_version: q.state_version || 0, worker_status: 'draft' }, { $set: patch });
    if (changed.updated !== 1) {
      await packages(db).updateMany({ id: work.id, status: 'preparing' }, { $set: { status: 'orphaned', updated_at: at() } });
      const latest = await getQuote(db, q.id);
      if (latest?.pricing_progress?.package_id) {
        const winner = await getPackage(db, latest.pricing_progress.package_id);
        if (winner?.owner_id === user.id && winner.input_hash === work.input_hash && await isCurrent(latest, winner)) return latest;
      }
      fail(409, 'The quote changed before its pricing work could be saved');
    }
    // A lost acknowledgement here is recoverable: polling also checks preparing
    // work, but only the one package selected by the parent CAS may proceed.
    await packages(db).updateMany({ id: work.id, status: 'preparing' }, { $set: { status: 'pending', updated_at: at() } });
    return { ...q, ...patch };
  }

  async function reconcile({ db, packageId }) {
    if (!enabled || !id(packageId)) return null;
    let work = await getPackage(db, packageId); if (!work || !INCOMPLETE.includes(work.status)) return null;
    let q = await getQuote(db, work.quote_id);
    if (q?.worker_status === 'ready' && q.result?.verified === true && await isCurrent(q, work)) {
      await packages(db).updateMany({ id: work.id, state_version: work.state_version, status: work.status }, { $set: { status: 'ready', updated_at: at() } });
      return q;
    }
    if (['failed', 'needs_sign_in', 'needs_details'].includes(q?.worker_status) && await isCurrent(q, work)) {
      await packages(db).updateMany({ id: work.id, state_version: work.state_version, status: work.status }, { $set: { status: 'needs_attention', updated_at: at() } });
      return q;
    }
    if (!await isCurrent(q, work) || q.worker_status !== 'queued') {
      await packages(db).updateMany({ id: work.id, state_version: work.state_version, status: work.status }, { $set: { status: 'orphaned', updated_at: at() } });
      return null;
    }
    if (work.lease_token && Date.parse(work.lease_until) > now().getTime()) return q;
    const token = uuid(), nextVersion = work.state_version + 1;
    const locked = await packages(db).updateMany({ id: work.id, state_version: work.state_version, status: work.status, lease_token: work.lease_token || '' },
      { $set: { state_version: nextVersion, lease_token: token, lease_until: new Date(now().getTime() + 90000).toISOString(), status: 'pending', updated_at: at() } });
    if (locked.updated !== 1) return q;
    work = { ...work, state_version: nextVersion, lease_token: token, status: 'pending' };
    const guard = async () => {
      const [latest, parent] = await Promise.all([getPackage(db, work.id), getQuote(db, q.id)]);
      if (latest?.lease_token !== token || latest.state_version !== nextVersion || Date.parse(latest.lease_until) <= now().getTime() || !await isCurrent(parent, work) || parent.worker_status !== 'queued') fail(409, 'The pricing package changed during processing');
      q = parent; return parent;
    };
    try {
      const items = clone(work.items), user = { id: work.owner_id, email: work.owner_email, role: 'admin' };
      // Native work is read or requested only for unfinished selections. Work
      // already priced stays fixed in this private package, with its provenance.
      let requested = 0;
      for (const item of items) {
        if (item.state !== 'native_pending') continue;
        const line = work.snapshot.lines[item.index];
        const verified = await previews.resolveVerified({ db, user, line, settings: work.snapshot.settings });
        if (verified) { item.state = 'priced'; item.source = 'desktop_native'; item.verified = verified; continue; }
        if (requested >= 3) continue;
        await guard();
        const status = await previews.request({ db, user, line, settings: work.snapshot.settings, sessionId: work.id }); requested++;
        if (status.preview_id) item.preview_id = status.preview_id;
        if (status.status === 'amsco_lookup_needed') { item.state = 'online_pending'; delete item.preview_id; }
        else if (status.status === 'native_unavailable') { item.state = 'online_pending'; item.wait_reason = 'native_unavailable'; }
        else delete item.wait_reason;
      }
      const onlineIndices = items.filter(item => item.state === 'online_pending').map(item => item.index);
      let onlineState = null;
      if (onlineIndices.length && online?.configured) {
        await guard();
        // This immutable subset is the only input the online service receives.
        // Its own reservation and idempotency handle uncertain dispatch replies.
        onlineState = await online.progress({ db, work, indices: onlineIndices, settings: clone(work.snapshot.settings), lines: onlineIndices.map(index => clone(work.snapshot.lines[index])),
          allowDispatch: !items.some(item => item.state === 'native_pending') });
        if (onlineState?.completed) {
          if (!Array.isArray(onlineState.completed) || new Set(onlineState.completed.map(item => item.index)).size !== onlineState.completed.length) fail(502, 'The online service returned duplicate completed windows');
          for (const item of onlineState.completed) {
            if (!onlineIndices.includes(item.index) || !item.verified) fail(502, 'The online service returned a window outside its requested subset');
            items[item.index].state = 'priced'; items[item.index].source = 'amsco_online'; items[item.index].verified = item.verified;
          }
        }
        if (onlineState?.status === 'ready') {
          if (!Array.isArray(onlineState.verified) || onlineState.verified.length !== onlineIndices.length) fail(502, 'The online result does not cover its complete requested subset');
          for (const [position, index] of onlineIndices.entries()) { items[index].state = 'priced'; items[index].source = 'amsco_online'; items[index].verified = onlineState.verified[position]; }
        }
      }
      else if (onlineIndices.length && !items.some(item => item.state === 'native_pending')) onlineState = { status: 'failed', questions: ['The remaining windows need AMSCO online pricing, but that connection is unavailable. Your completed window prices are saved.'] };
      await guard();
      const priced = items.filter(item => item.state === 'priced'), allReady = priced.length === items.length;
      const subtotalCents = priced.reduce((sum, item) => {
        const unit = item.verified?.result?.lines?.[0]?.unit_prices?.customer;
        if (typeof unit !== 'number' || !Number.isFinite(unit) || unit <= 0 || Math.abs(unit * 100 - Math.round(unit * 100)) > 0.000001) fail(502, 'A completed line has no valid verified unit price');
        return sum + Math.round(unit * 100) * work.snapshot.lines[item.index].qty;
      }, 0);
      const progress = { version: 1, package_id: work.id, input_revision: q.input_revision, resume_count: work.resume_count || 0, total_count: items.length, priced_count: priced.length,
        native_pending_count: items.filter(item => item.state === 'native_pending').length, online_pending_count: items.filter(item => item.state === 'online_pending').length,
        priced_subtotal: priced.length ? subtotalCents / 100 : null, total: null, currency: 'USD', updated_at: at(),
        lines: items.map(item => ({ index: item.index, status: item.state, ...(item.state === 'priced' ? { unit_price: item.verified.result.lines[0].unit_prices.customer, total: Math.round(item.verified.result.lines[0].unit_prices.customer * 100) * work.snapshot.lines[item.index].qty / 100 } : {}) })) };
      const attention = onlineState && ['needs_details', 'needs_sign_in', 'failed'].includes(onlineState.status);
      const questions = attention ? (onlineState.questions || ['The remaining AMSCO selections need review before the package can be completed.']) : [];
      const saveWork = await packages(db).updateMany({ id: work.id, state_version: nextVersion, lease_token: token }, { $set: { items, updated_at: at() } });
      if (saveWork.updated !== 1) fail(409, 'The pricing work changed before progress could be saved');
      const patch = allReady ? await complete({ db, q, work: { ...work, items }, verified: items.map(item => item.verified), policy: config.native_engine, checkedAt: at() }) :
        { pricing_progress: progress, ...(attention ? { worker_status: onlineState.status, missing_details: questions } : {}) };
      if (!patch || typeof patch !== 'object' || allReady && (patch.worker_status !== 'ready' || patch.result?.verified !== true)) fail(502, 'The final package did not return verified pricing');
      if (allReady) patch.pricing_progress = { ...progress, total: subtotalCents / 100 };
      const updated = await db.QuoteRequests.updateMany({ id: q.id, input_revision: q.input_revision, state_version: q.state_version || 0, worker_status: 'queued', 'pricing_progress.package_id': work.id },
        { $set: { ...patch, state_version: (q.state_version || 0) + 1 } });
      if (updated.updated !== 1) fail(409, 'The quote changed before pricing progress could be saved');
      await packages(db).updateMany({ id: work.id, state_version: nextVersion, lease_token: token }, { $set: { status: allReady ? 'ready' : attention ? 'needs_attention' : 'pending', updated_at: at() } });
      return { ...q, ...patch, state_version: (q.state_version || 0) + 1 };
    } finally {
      await packages(db).updateMany({ id: work.id, state_version: nextVersion, lease_token: token }, { $set: { lease_token: '', lease_until: '' } });
    }
  }

  async function advance({ db }) {
    if (!enabled) return null;
    const candidates = await packages(db).filter({ status: { $in: INCOMPLETE } }, 'updated_at', 5);
    for (const work of candidates) {
      if (work.lease_token && Date.parse(work.lease_until) > now().getTime()) continue;
      return reconcile({ db, packageId: work.id });
    }
    return null;
  }
  return { enabled, start, reconcile, advance };
}
