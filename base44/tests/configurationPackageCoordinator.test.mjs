import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigurationPackageCoordinator } from '../shared/configurationPackageCoordinator.js';
import { builderScheduleHash } from '../shared/windowQuoteBuilder.js';

const clone = value => structuredClone(value);
const path = (value, key) => key.split('.').reduce((row, name) => row?.[name], value);
const matches = (row, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' && '$in' in value ? value.$in.includes(path(row, key)) : path(row, key) === value);
function table(initial = []) {
  const data = clone(initial); let creates = 0, updates = 0;
  return { data, get creates() { return creates; }, get updates() { return updates; },
    async filter(query = {}, sort, limit = 100) { const selected = data.filter(row => matches(row, query)); if (sort) selected.sort((a, b) => String(a[sort] || '').localeCompare(String(b[sort] || ''))); return clone(selected.slice(0, limit)); },
    async create(value) { creates++; const row = { ...clone(value), id: 'work-' + creates }; data.push(row); return clone(row); },
    async updateMany(query, patch) { let updated = 0; for (const row of data) if (matches(row, query)) { Object.assign(row, clone(patch.$set)); updated++; updates++; } return { updated }; }
  };
}
const user = { id: 'test-owner', email: 'owner@example.test', role: 'admin' };
const policy = { enabled: true, version: 1, contract_hash: 'a'.repeat(64), catalog_id: '361', context_fingerprint: 'b'.repeat(64), configuration_packages: true };
// Deliberately minimal orchestration doubles. Verification of actual native
// prices is covered by nativeConfigurationQuote/nativePricePreview tests.
const receipt = (width, customer) => ({ id: 'priced-' + width, result: { lines: [{ width, unit_prices: { customer } }] } });
async function harness({ widths = [24, 25, 26], unsupported = [26], ready = [24], onlineConfigured = true } = {}) {
  let time = Date.parse('2026-09-10T12:00:00Z'), sequence = 0;
  const prices = new Map(ready.map(width => [width, receipt(width, width * 10)])), requests = [], onlineCalls = [], completions = [];
  const draft = { settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' },
    lines: widths.map((width, index) => ({ id: 'window-' + index, style: 'Hampton Casement', width, height: 48, units: 'in', dimension_basis: 'frame', qty: index + 1, room: 'Room ' + index, options: { series: 'Hampton' } })), source: { amsco_configurator: { version: 1 } } };
  const q = { id: 'package-quote', request_id: 'submit-1', input_revision: 1, state_version: 0, requester_email: user.email, worker_status: 'draft', sales_status: 'open',
    ...draft, source: { ...draft.source, visual_builder: { version: 1, confirmed: true, schedule_hash: await builderScheduleHash(draft) } }, conversation: [], history: [] };
  const db = { QuoteRequests: table([q]), WindowQuoteConfigurationPackages: table() };
  let nativeStatus = 'calculating', onlineStatus = 'queued', mutateDuringRequest;
  const previews = { enabled: true, resolveVerified: async ({ line }) => clone(prices.get(line.width) || null), request: async ({ line }) => { requests.push(line.width); if (mutateDuringRequest) await mutateDuringRequest(); return { status: nativeStatus, preview_id: 'preview-' + line.width }; } };
  const online = { configured: onlineConfigured, progress: async args => { onlineCalls.push(clone({ indices: args.indices, lines: args.lines })); return { status: onlineStatus, ...(onlineStatus === 'ready' ? { verified: args.lines.map(line => receipt(line.width, line.width * 10)) } : {}), questions: ['Check this online choice.'] }; } };
  const options = { config: { native_engine: policy }, previews, online, now: () => new Date(time), uuid: () => 'lease-' + ++sequence,
    plan: input => unsupported.includes(input.lines[0].width) ? { ok: false, issues: [{ code: 'unsupported_product', message: 'Online configuration required' }] } : { ok: true },
    complete: async args => { completions.push(args); return { worker_status: 'ready', result: { verified: true, native_source: 'test-only', count: args.verified.length } }; } };
  const coordinator = createConfigurationPackageCoordinator(options);
  return { q, db, options, coordinator, requests, onlineCalls, completions, prices,
    start: () => coordinator.start({ db, q: clone(q), user }), reconcile: () => coordinator.reconcile({ db, packageId: db.QuoteRequests.data[0].pricing_progress.package_id }),
    advanceTime: ms => time += ms, setNativeStatus: value => nativeStatus = value, setOnlineStatus: value => onlineStatus = value, onRequest: value => mutateDuringRequest = value };
}

test('one unresolved native line and one online line leave an already priced neighbor intact', async () => {
  const h = await harness(); await h.start(); const first = await h.reconcile();
  assert.deepEqual(h.requests, [25]); assert.deepEqual(h.onlineCalls[0].indices, [2]); assert.deepEqual(h.onlineCalls[0].lines.map(line => line.width), [26]);
  assert.deepEqual(first.lines, h.q.lines); assert.equal(first.result, undefined); assert.equal(first.pricing_progress.priced_subtotal, 240); assert.equal(first.pricing_progress.total, null);
  assert.equal(first.pricing_progress.native_pending_count, 1); assert.equal(first.pricing_progress.online_pending_count, 1);
  h.prices.delete(24); h.prices.set(25, receipt(25, 250)); h.setOnlineStatus('ready');
  const finished = await h.reconcile(); assert.equal(finished.worker_status, 'ready'); assert.equal(finished.pricing_progress.total, 1520);
  assert.deepEqual(h.requests, [25]); assert.deepEqual(h.completions[0].verified.map(row => row.id), ['priced-24', 'priced-25', 'priced-26']);
  assert.deepEqual(finished.lines, h.q.lines); assert.equal(h.db.WindowQuoteConfigurationPackages.data[0].status, 'ready');
});

test('concurrent submission picks one private work record and one public package', async () => {
  const h = await harness(); const both = await Promise.all([h.start(), h.start()]);
  assert.equal(both[0].pricing_progress.package_id, both[1].pricing_progress.package_id); assert.equal(h.db.QuoteRequests.updates, 1);
  assert.equal(h.db.WindowQuoteConfigurationPackages.data.filter(row => row.status === 'pending').length, 1);
  await h.reconcile(); assert.deepEqual(h.requests, [25]);
});

test('concurrent pickup runs one unresolved calculation and one online handoff', async () => {
  const h = await harness(); await h.start(); await Promise.all([h.reconcile(), h.reconcile()]);
  assert.deepEqual(h.requests, [25]); assert.equal(h.onlineCalls.length, 1);
});

test('a lost pending acknowledgement recovers only the package selected by the parent', async () => {
  const h = await harness(); const update = h.db.WindowQuoteConfigurationPackages.updateMany;
  h.db.WindowQuoteConfigurationPackages.updateMany = async (query, patch) => { if (query.status === 'preparing' && patch.$set.status === 'pending') throw new Error('Lost activation response'); return update(query, patch); };
  await assert.rejects(h.start(), /Lost activation/); h.db.WindowQuoteConfigurationPackages.updateMany = update;
  assert.equal(h.db.QuoteRequests.data[0].worker_status, 'queued'); assert.equal(h.db.WindowQuoteConfigurationPackages.data[0].status, 'preparing');
  await h.coordinator.advance({ db: h.db }); assert.deepEqual(h.requests, [25]);
});

test('changed input, changed frozen snapshot, owner, or contract invalidates work before any pricing mutation', async () => {
  for (const mutation of [h => h.db.QuoteRequests.data[0].lines[0].width++, h => h.db.WindowQuoteConfigurationPackages.data[0].snapshot.lines[0].qty++, h => h.db.QuoteRequests.data[0].requester_email = 'other@example.test', h => h.db.WindowQuoteConfigurationPackages.data[0].policy.contract_hash = 'c'.repeat(64)]) {
    const h = await harness(); await h.start(); mutation(h); await h.reconcile();
    assert.equal(h.db.WindowQuoteConfigurationPackages.data[0].status, 'orphaned'); assert.equal(h.requests.length, 0); assert.equal(h.onlineCalls.length, 0);
  }
});

test('unsupported or unavailable native selections route only their unfinished lines online', async () => {
  for (const status of ['amsco_lookup_needed', 'native_unavailable']) {
    const h = await harness({ widths: [24, 25], unsupported: [] }); await h.start(); h.setNativeStatus(status); await h.reconcile();
    assert.deepEqual(h.requests, [25]); assert.deepEqual(h.onlineCalls[0].indices, [1]); assert.equal(h.db.QuoteRequests.data[0].pricing_progress.priced_subtotal, 240);
  }
});

test('missing online connection stops with saved partial prices instead of leaving a permanent queue', async () => {
  const h = await harness({ widths: [24, 25], unsupported: [], onlineConfigured: false }); await h.start(); h.setNativeStatus('amsco_lookup_needed'); const q = await h.reconcile();
  assert.equal(q.worker_status, 'failed'); assert.equal(q.pricing_progress.priced_subtotal, 240); assert.equal(q.pricing_progress.total, null); assert.equal(h.db.WindowQuoteConfigurationPackages.data[0].status, 'needs_attention');
});

test('changed input during a native request blocks online dispatch and finalization', async () => {
  const h = await harness(); await h.start(); h.onRequest(() => { h.db.QuoteRequests.data[0].lines[0].qty++; });
  await assert.rejects(h.reconcile(), error => error.status === 409); assert.equal(h.onlineCalls.length, 0); assert.equal(h.completions.length, 0); assert.equal(h.db.WindowQuoteConfigurationPackages.data[0].lease_token, '');
});

test('a live reconciliation lease is respected, and expiry permits idempotent unfinished work to resume', async () => {
  const h = await harness(); await h.start(); Object.assign(h.db.WindowQuoteConfigurationPackages.data[0], { lease_token: 'other-lease', lease_until: new Date(h.options.now().getTime() + 90000).toISOString() });
  await h.reconcile(); assert.equal(h.requests.length, 0); h.advanceTime(90001); await h.reconcile(); assert.deepEqual(h.requests, [25]);
});

test('native requests are bounded per pickup and no total is claimed before all prices exist', async () => {
  const h = await harness({ widths: [20, 21, 22, 23, 24, 25], unsupported: [], ready: [] }); await h.start(); const q = await h.reconcile();
  assert.equal(h.requests.length, 3); assert.equal(q.pricing_progress.priced_subtotal, null); assert.equal(q.pricing_progress.total, null); assert.equal(h.completions.length, 0);
});

test('stale review and foreign owner cannot start a package; disabled coordination does not touch storage', async () => {
  const h = await harness(); h.q.lines[0].width++; await assert.rejects(h.start(), error => error.status === 409);
  const other = await harness(); await assert.rejects(other.coordinator.start({ db: other.db, q: other.q, user: { ...user, id: 'foreign', email: 'foreign@example.test' } }), error => error.status === 403);
  const off = createConfigurationPackageCoordinator({ ...other.options, config: { native_engine: { ...policy, configuration_packages: false } } });
  assert.equal(await off.start({ db: {}, q: other.q, user }), null); assert.equal(await off.advance({ db: {} }), null);
});
