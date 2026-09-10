import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigurationOnlineService, privateOnlineDatabase } from '../shared/configurationOnlineQueue.js';
import { createAgentExecution } from '../shared/windowQuoteAgentService.js';
import { configurationInputSnapshot } from '../shared/nativeConfigurationResult.js';
import { sha256 } from '../shared/windowQuotesCore.js';

const clone = value => structuredClone(value);
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const matches = (row, query) => Object.entries(query).every(([key, value]) => key.split('.').reduce((current, part) => current?.[part], row) === value);
function table(prefix, initial = []) {
  let count = 0; const data = clone(initial);
  return { data, async filter(query = {}, sort, limit = 100) { const found = data.filter(row => matches(row, query)); if (sort) found.sort((a, b) => String(a[sort] || '').localeCompare(String(b[sort] || ''))); return clone(found.slice(0, limit)); },
    async create(value) { const row = { ...clone(value), id: prefix + '-' + ++count, created_date: '2026-09-10T12:00:00Z' }; data.push(row); return clone(row); },
    async updateMany(query, patch) { let updated = 0; for (const row of data) if (matches(row, query)) { Object.assign(row, clone(patch.$set)); updated++; } return { updated }; } };
}
async function harness() {
  const settings = { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' };
  const lines = [24, 25, 26].map((width, index) => ({ id: 'line-' + index, style: 'Hampton Casement', qty: index + 1, width, height: 48, units: 'in', dimension_basis: 'frame', room: 'Room ' + index, options: { series: 'Hampton' } }));
  const q = { id: 'parent', input_revision: 1, requester_email: 'owner@example.test', worker_status: 'queued', pricing_progress: { package_id: 'package' }, settings, lines, source: { amsco_configurator: { version: 1 } } };
  const work = { id: 'package', quote_id: q.id, input_revision: 1, owner_email: q.requester_email, status: 'pending', input_hash: await sha256(stable({ input: configurationInputSnapshot(q), source: q.source })), snapshot: { settings, lines, source: q.source, title: 'Customer package' } };
  const db = { QuoteRequests: table('public', [q]), WindowQuoteConfigurationPackages: table('package', [work]), WindowQuoteOnlineRequests: table('online'),
    QuoteWorkers: table('worker', [{ id: 'shared-slot', name: 'Base44 Window Quotes browser', busy_token: '', poll_generation: 0 }]) };
  const sends = []; let sequence = 0, uncertain = false, valid = true;
  const raw = createAgentExecution({ transport: { sendMessage: async payload => { sends.push(payload); if (uncertain) throw new Error('Uncertain send'); } }, browserSlotId: 'shared-slot', conversationId: 'test-conversation', now: () => new Date('2026-09-10T12:00:00Z'), uuid: () => 'operation-' + ++sequence });
  const service = createConfigurationOnlineService({ execution: raw, verifyReady: async ({ child }) => ({ ok: valid, verified: { id: child.id, result: child.result } }) });
  const progress = (indices = [1, 2]) => service.progress({ db, work, indices, settings, lines: indices.map(index => lines[index]) });
  const body = (child, extra) => ({ quote_id: child.id, input_revision: 1, operation_id: child.agent_run.operation_id, execution_token: child.agent_run.execution_token, ...extra });
  return { db, work, lines, settings, service, raw, sends, progress, body, setUncertain: value => uncertain = value, setValid: value => valid = value };
}

test('only unresolved windows are privately reserved and one guarded online operation is dispatched', async () => {
  const h = await harness(); const result = await h.progress(); assert.equal(result.status, 'queued');
  assert.equal(h.db.QuoteRequests.data.length, 1); assert.equal(h.db.WindowQuoteOnlineRequests.data.length, 2); assert.equal(h.sends.length, 1);
  const children = h.db.WindowQuoteOnlineRequests.data; assert.deepEqual(children.map(child => child.source_index), [1, 2]); assert.deepEqual(children.map(child => child.lines[0].width), [25, 26]);
  const read = await h.service.route({ db: h.db, body: h.body(children[0], { action: 'read' }) }, 'tool');
  assert.equal(read.lines.length, 1); assert.equal(read.lines[0].width, 25); assert.match(read.contract.request_scope, /Other windows already have prices/);
  assert.equal(h.db.QuoteWorkers.data[0].active_quote_id, children[0].id);
});

test('an uncertain provider send is never duplicated on coordinator retry', async () => {
  const h = await harness(); h.setUncertain(true); await h.progress(); await h.progress();
  assert.equal(h.sends.length, 1); assert.equal(h.db.WindowQuoteOnlineRequests.data[0].agent_run.phase, 'uncertain'); assert.equal(h.db.WindowQuoteOnlineRequests.data.length, 2);
});

test('a lost private create reply is recovered without another child or external dispatch', async () => {
  const h = await harness(), original = h.db.WindowQuoteOnlineRequests.create; let once = true;
  h.db.WindowQuoteOnlineRequests.create = async value => { const child = await original(value); if (once) { once = false; throw new Error('Lost create reply'); } return child; };
  await assert.rejects(h.progress([1]), /Lost create reply/); assert.equal(h.sends.length, 0); await h.progress([1]);
  assert.equal(h.db.WindowQuoteOnlineRequests.data.length, 1); assert.equal(h.sends.length, 1);
});

test('late native rejections add only new unresolved windows and do not change active online input', async () => {
  const h = await harness(); await h.progress([2]); const first = clone(h.db.WindowQuoteOnlineRequests.data[0]); await h.progress([1, 2]);
  assert.equal(h.db.WindowQuoteOnlineRequests.data.length, 2); assert.equal(h.sends.length, 1); assert.deepEqual(h.db.WindowQuoteOnlineRequests.data[0].lines, first.lines);
  assert.deepEqual(h.db.WindowQuoteOnlineRequests.data.map(child => child.source_index), [2, 1]);
});

test('completed online prices are returned even while another unresolved window is still queued', async () => {
  const h = await harness(); await h.progress(); const child = h.db.WindowQuoteOnlineRequests.data[0]; child.worker_status = 'ready'; child.result = { verified: true, lines: [{ unit_prices: { customer: 250 } }] };
  const result = await h.progress(); assert.equal(result.status, 'queued'); assert.deepEqual(result.completed.map(item => item.index), [1]); assert.equal(result.completed[0].verified.id, child.id);
});

test('parent changes stop native reads and exclude stale child work from queue draining', async () => {
  const h = await harness(); await h.progress(); await h.progress(); const children = h.db.WindowQuoteOnlineRequests.data; h.db.QuoteRequests.data[0].lines[1].width++;
  await assert.rejects(h.service.route({ db: h.db, body: h.body(children[0], { action: 'read' }) }, 'tool'), error => error.status === 409);
  assert.deepEqual(await privateOnlineDatabase(h.db).QuoteRequests.filter({ worker_status: 'queued', execution_provider: 'superagent' }), []);
  await assert.rejects(h.progress(), error => error.status === 409); assert.equal(h.sends.length, 1);
});

test('operation tokens still protect private children and reviewed input cannot be rewritten', async () => {
  const h = await harness(); await h.progress([1]); const child = h.db.WindowQuoteOnlineRequests.data[0];
  await assert.rejects(h.service.route({ db: h.db, body: h.body(child, { action: 'read', execution_token: 'wrong' }) }, 'tool'), error => error.status === 403);
  await assert.rejects(h.service.route({ db: h.db, body: h.body(child, { action: 'report', status: 'ready', settings: { ...h.settings, gross_margin: 20 } }) }, 'tool'), error => error.status === 400);
  h.setValid(false); await assert.rejects(h.service.route({ db: h.db, body: h.body(child, { action: 'report', status: 'ready', result: {} }) }, 'tool'), error => error.status === 400);
  assert.equal(child.worker_status, 'running');
});

test('an authenticated failed report can release an existing child after its parent changes', async () => {
  const h = await harness(); await h.progress([1]); const child = h.db.WindowQuoteOnlineRequests.data[0]; h.db.QuoteRequests.data[0].lines[1].qty++;
  const report = h.body(child, { action: 'report', status: 'failed', event_id: 'saved-failure', message: 'Stopped after the package changed.' });
  const response = await h.service.route({ db: h.db, body: report }, 'tool'); assert.equal(response.status, 'failed'); assert.equal(h.db.QuoteWorkers.data[0].busy_token, '');
  const retry = await h.service.route({ db: h.db, body: report }, 'tool'); assert.equal(retry.status, 'failed');
});

test('private routing falls through for normal quote IDs and rejects invalid subsets before reserving anything', async () => {
  const h = await harness(); assert.equal(await h.service.route({ db: h.db, body: { quote_id: 'normal-request' } }, 'tool'), null);
  await assert.rejects(h.service.progress({ db: h.db, work: h.work, indices: [1, 1], settings: h.settings, lines: [h.lines[1], h.lines[1]] }), error => error.status === 400);
  assert.equal(h.db.WindowQuoteOnlineRequests.data.length, 0); assert.equal(h.sends.length, 0);
});

test('online reservations do not take the shared browser while native prices are still being calculated', async () => {
  const h = await harness(); await h.service.progress({ db: h.db, work: h.work, indices: [1], settings: h.settings, lines: [h.lines[1]], allowDispatch: false });
  assert.equal(h.db.WindowQuoteOnlineRequests.data.length, 1); assert.equal(h.sends.length, 0); assert.equal(h.db.QuoteWorkers.data[0].busy_token, '');
  await h.progress([1]); assert.equal(h.sends.length, 1);
});

test('a source-priced item cannot continue an older online child while other items remain pending',async()=>{
 const h=await harness();await h.progress([1]);
 const child=h.db.WindowQuoteOnlineRequests.data[0];
 h.db.WindowQuoteConfigurationPackages.data[0].items=[{state:'priced'},{state:'priced'},{state:'online_pending'}];
 await assert.rejects(h.service.route({db:h.db,body:h.body(child,{action:'read'})},'tool'),error=>error.status===409);
 const cleanup=h.body(child,{action:'report',status:'failed',event_id:'source-recovered-cleanup',message:'This selection was calculated from source rules.'});
 assert.equal((await h.service.route({db:h.db,body:cleanup},'tool')).status,'failed');
 assert.equal(h.db.QuoteWorkers.data[0].busy_token,'');
});
