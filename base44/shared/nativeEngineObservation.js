import { verifyObservedQuote } from './amscoQuotePlan.js';

export const DESKTOP_NATIVE_SOURCE = 'desktop_native';
export const NATIVE_ENGINE_VERSION = 1;
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const present = value => value !== undefined && value !== null && value !== '';
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const guid = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const stable = value => JSON.stringify(value, (_key, item) => object(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const select = (value, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(value || {}, key)).map(key => [key, value[key]]));
const issue = message => ({ code: 'native_engine_evidence_invalid', path: 'native_engine', message });
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join(''); }

export function nativeEnginePolicyReady(policy) {
  return object(policy) && policy.enabled === true && policy.version === NATIVE_ENGINE_VERSION &&
    sha(policy.contract_hash) && /^\d{1,10}$/.test(policy.catalog_id || '') && sha(policy.context_fingerprint);
}
export function nativeEnginePresenceReady(presence, policy) {
  return nativeEnginePolicyReady(policy) && object(presence) && presence.state === 'ready' && presence.version === policy.version &&
    presence.contract_hash === policy.contract_hash && presence.catalog_id === policy.catalog_id && presence.context_fingerprint === policy.context_fingerprint;
}

// Local native files need no invented online registration. A supplied official
// identity must still contain a genuine-looking matching number/link pair.
export function desktopNativeIdentityIssues(value) {
  const errors = [];
  if (value?.native_source !== DESKTOP_NATIVE_SOURCE || !guid(value.native_quote_id)) errors.push(issue('A desktop result needs its saved native quote GUID and explicit source.'));
  const number = present(value?.native_quote_number), address = present(value?.native_quote_url);
  if (number !== address) errors.push(issue('An official quote number and online link must be provided together, or both omitted.'));
  if (number && address) {
    let url; try { url = new URL(value.native_quote_url); } catch { /* Report below. */ }
    if (!/^[1-9]\d{0,29}$/.test(String(value.native_quote_number)) || !url || url.protocol !== 'https:' || url.hostname !== 'amsco.wtsparadigm.com' ||
      url.username || url.password || url.search || url.hash || url.pathname.split('/')[1] !== 'quotes' || url.pathname.split('/')[2] !== value.native_quote_id) errors.push(issue('The supplied official identity must match this saved native quote.'));
  }
  return errors;
}

export function desktopPersistenceIssues(proof) {
  const errors = [];
  if (!exact(proof, ['kind', 'artifact_id', 'artifact_sha256', 'bytes']) || proof.kind !== 'navigator_local' ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(proof.artifact_id || '') || !sha(proof.artifact_sha256) || !Number.isSafeInteger(proof.bytes) || proof.bytes < 1 || proof.bytes > 100_000_000) {
    errors.push(issue('Desktop persistence requires a bounded saved artifact identity, digest and byte count.'));
  }
  return errors;
}

export async function validateDesktopCheckpoint(value, plan, { policy, operationId, hash = digest } = {}) {
  const issues = desktopNativeIdentityIssues(value), proof = value?.native_engine;
  const { native_quote_id: _nativeId, ...immutablePlan } = plan || {};
  if (!nativeEnginePolicyReady(policy) || !exact(proof, ['version', 'engine', 'contract_hash', 'catalog_id', 'context_fingerprint', 'plan_hash', 'operation_id', 'persistence']) ||
    proof.version !== NATIVE_ENGINE_VERSION || proof.engine !== 'amsco-navigator' || proof.contract_hash !== policy?.contract_hash || proof.catalog_id !== policy?.catalog_id ||
    proof.context_fingerprint !== policy?.context_fingerprint || proof.operation_id !== operationId || proof.plan_hash !== await hash(stable(immutablePlan))) {
    issues.push(issue('The desktop checkpoint must match the enabled catalog, account and claimed immutable plan.'));
  }
  issues.push(...desktopPersistenceIssues(proof?.persistence));
  return { ok: issues.length === 0, issues };
}

export function desktopCheckpointFromObservation(observed) {
  return { native_source: DESKTOP_NATIVE_SOURCE, native_quote_id: observed.native_quote_id,
    ...select(observed, ['native_quote_number', 'native_quote_url']), input_revision: observed.input_revision,
    native_engine: select(observed.native_engine, ['version', 'engine', 'contract_hash', 'catalog_id', 'context_fingerprint', 'plan_hash', 'operation_id', 'persistence']),
    saved_lines: observed.lines.map((line, source_index) => ({ source_index, native_line_id: line.native_line_id, native_line_number: String(line.native_line_number) })) };
}

// The canonical proof includes measured geometry and native financial fields.
// Requested call dimensions are kept in the immutable plan, never relabeled as
// measurements when the frame-based native API returns Call Width/Height=-99.
export function desktopSemanticSnapshot(observed) {
  return { ...select(observed, ['quote_id', 'input_revision', 'native_quote_id', 'dealer', 'yard', 'gross_margin', 'totals']),
    lines: Array.isArray(observed?.lines) ? observed.lines.map(line => select(line, ['native_line_id', 'native_line_number', 'qty', 'units', 'dimension_basis',
      'width', 'height', 'frame_dimensions', 'style', 'room', 'options', 'product_profile_id', 'gross_margin', 'unit_prices', 'line_totals', 'saved_description'])) : null };
}
export const hashDesktopSnapshot = (observed, hash = digest) => hash(stable(desktopSemanticSnapshot(observed)));

export async function validateNativeEngineProof(plan, observed, { policy, operationId, startedAt, now = new Date(), hash = digest } = {}) {
  const issues = desktopNativeIdentityIssues(observed), proof = observed?.native_engine;
  const reject = message => issues.push(issue(message));
  if (!nativeEnginePolicyReady(policy)) reject('The desktop engine is not enabled with a pinned catalog and account contract.');
  if (!exact(proof, ['version', 'engine', 'contract_hash', 'catalog_id', 'context_fingerprint', 'plan_hash', 'operation_id', 'stages', 'persistence'])) {
    reject('A complete native-engine evidence manifest is required.'); return { ok: false, issues };
  }
  if (proof.version !== NATIVE_ENGINE_VERSION || proof.engine !== 'amsco-navigator' || proof.contract_hash !== policy?.contract_hash ||
    proof.catalog_id !== policy?.catalog_id || proof.context_fingerprint !== policy?.context_fingerprint) reject('The saved native evidence differs from the enabled engine, catalog or account contract.');
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(operationId || '') || proof.operation_id !== operationId) reject('The native evidence must belong to this exact claimed operation.');
  const { native_quote_id: _nativeId, ...immutablePlan } = plan || {};
  if (!sha(proof.plan_hash) || proof.plan_hash !== await hash(stable(immutablePlan))) reject('The native evidence differs from the immutable plan hash.');
  if (observed?.quote_id !== plan?.quote_id || observed?.input_revision !== plan?.input_revision || observed?.reopened !== true) reject('The reopened desktop quote differs from the app request revision.');
  issues.push(...desktopPersistenceIssues(proof.persistence));
  const names = ['before_save', 'after_save', 'reopened'];
  if (!exact(proof.stages, names)) reject('Desktop verification requires independent before-save, after-save and reopened stages.');
  else {
    const snapshot = await hashDesktopSnapshot(observed, hash), started = Date.parse(startedAt), limit = new Date(now).getTime();
    let previous = started;
    if (!Number.isFinite(started) || !Number.isFinite(limit)) reject('The native evidence requires the operation start and verification times.');
    for (const name of names) {
      const stage = proof.stages[name], keys = name === 'before_save' ? ['at', 'snapshot_sha256'] : ['at', 'snapshot_sha256', 'artifact_sha256'];
      if (!exact(stage, keys)) { reject('A desktop evidence stage has missing or unexpected fields.'); continue; }
      const time = Date.parse(stage.at);
      if (!Number.isFinite(time) || time < previous || time > limit + 60000) reject('Native save/reopen stages must be ordered and fresh for this operation.');
      previous = time;
      if (!sha(stage.snapshot_sha256) || stage.snapshot_sha256 !== snapshot) reject('Native specifications or prices changed between generation, saving and reopening.');
      if (name !== 'before_save' && (!sha(stage.artifact_sha256) || stage.artifact_sha256 !== proof.persistence?.artifact_sha256)) reject('Saved and reopened native artifact digests do not match.');
    }
    if (observed.checked_at !== proof.stages.reopened?.at) reject('The result verification time must identify the reopened native observation.');
  }
  return { ok: issues.length === 0, issues };
}

function desktopDimensions(expected, actual, path) {
  const close = (a, b) => typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Math.abs(a - b) <= 0.000001;
  const frame = expected.frame_dimensions;
  if (actual.units !== 'in' || actual.dimension_basis !== 'frame' || !frame || !close(actual.width, frame.width) || !close(actual.height, frame.height) ||
    !actual.frame_dimensions || actual.frame_dimensions.units !== 'in' || !close(actual.frame_dimensions.width, frame.width) || !close(actual.frame_dimensions.height, frame.height)) {
    return [{ code: 'frame_dimensions_mismatch', path, message: 'The saved desktop frame dimensions differ from the verified product plan.' }];
  }
  return [];
}

export async function verifyDesktopNativeQuote(plan, observed, context = {}) {
  const proof = await validateNativeEngineProof(plan, observed, context);
  if (!proof.ok) return { ...proof, status: 'failed' };
  const checked = verifyObservedQuote(plan, observed, { validateIdentity: desktopNativeIdentityIssues, validateDimensions: desktopDimensions });
  if (!checked.ok) return checked;
  const blackFinish = checked.result.lines?.some(line => line.options?.exterior_color === 'Black');
  const result = { ...checked.result, ...(blackFinish ? { notices: ['Studio Black adds two weeks of extended lead time.'] } : {}), native_source: DESKTOP_NATIVE_SOURCE, native_engine: structuredClone(observed.native_engine),
    verification: { ...checked.result.verification, source: DESKTOP_NATIVE_SOURCE, dimension_source: 'saved_native_frame', persistence: 'navigator_local' } };
  if (!present(observed.native_quote_number)) { delete result.native_quote_number; delete result.native_quote_url; }
  return { ok: true, result };
}

export const verifyExecutionObservation = (plan, observed, context = {}) => observed?.native_source === DESKTOP_NATIVE_SOURCE
  ? verifyDesktopNativeQuote(plan, observed, context) : !present(observed?.native_source) || observed.native_source === 'amsco_online'
    ? verifyObservedQuote(plan, observed) : { ok: false, status: 'failed', issues: [issue('Unknown native execution source.')] };

