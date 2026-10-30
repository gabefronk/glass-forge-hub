// Calendar titles that carry the company prefix ("Y A Windows - ") or trailing task
// wording ("- Pickup ONLY, hold at YA shop") must attach to the customer's existing
// job instead of creating a new one (Steve Edgren, Oct 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const out = await build({ entryPoints: [fileURLToPath(new URL('../base44/shared/ingestShared.ts', import.meta.url))], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent' });
const ingest = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

const EDGREN = { id: 'a00000000000000000000001', created_date: '2026-10-14', canonical_name: 'Steve Edgren', aliases: ['steve edgren', 'edgren'], builder: 'Newco', address: null, po_numbers: [], oe_numbers: [] };
const item = (key, rawName, extra = {}) => ({ key, rawName, normName: ingest.normalizeJobName(rawName), builder: ingest.extractBuilder(rawName) || '', address: '', poNumber: '', oeNumber: '', currentJobId: '', noCreate: false, ...extra });
const plan = (items, jobs) => ingest.planIngestJobs(items, jobs, (it) => ({ canonical_name: it.normName, aliases: [it.normName] }));

test('the Y A Windows prefix is the company, not the customer', () => {
  assert.equal(ingest.normalizeJobName('Y A Windows - Steve Edgren'), 'steve edgren');
  assert.equal(ingest.normalizeJobName('YA Windows - Steve Edgren'), 'steve edgren');
  assert.equal(ingest.normalizeJobName('YA - Pulte Home - 12 Main St'), 'pulte home - 12 main st');
  assert.equal(ingest.normalizeJobName('Yates Construction - 4 Elm St'), 'yates construction - 4 elm st');
  assert.equal(ingest.extractBuilder('Y A Windows - Steve Edgren'), null);
  assert.equal(ingest.extractBuilder('YA - Pulte Home - 12 Main St'), 'Pulte Home');
});

test('prefixed title with address and PO attaches to the existing job by name', () => {
  const { results, drafts } = plan([item('nov19', 'Y A Windows - Steve Edgren', { address: '10339 N Oak Creek Ln Highland, UT 84003', poNumber: '7359059' })], [EDGREN]);
  assert.equal(results.get('nov19').job_id, EDGREN.id);
  assert.equal(drafts.length, 0);
});

test('trailing task wording is dropped to find the job', () => {
  const { results, drafts } = plan([item('oct30', 'Y A Windows - Steve Edgren (Newco) - Pickup ONLY, hold at YA shop (Lehi)')], [EDGREN]);
  assert.equal(results.get('oct30').job_id, EDGREN.id);
  assert.equal(results.get('oct30').reason, 'name_without_task');
  assert.equal(drafts.length, 0);
});

test('a job at another address stays another job', () => {
  const sited = { ...EDGREN, address: '55 W Center St, Lehi, UT' };
  const { results, drafts } = plan([item('x', 'Steve Edgren - Measure', { address: '10339 N Oak Creek Ln Highland, UT 84003' })], [sited]);
  assert.notEqual(results.get('x').job_id, EDGREN.id);
  assert.equal(drafts.length, 1);
});

test('a dash part with a digit (address, lot) is never dropped', () => {
  const { results } = plan([item('x', 'Steve Edgren - Lot 12')], [EDGREN]);
  assert.notEqual(results.get('x').job_id, EDGREN.id);
});

test('a builder shared by several jobs is never the match', () => {
  const pulte = (id, name) => ({ id, created_date: '2026-01-0' + id.slice(-1), canonical_name: name, aliases: [], builder: 'Pulte Home', address: null, po_numbers: [], oe_numbers: [] });
  const jobs = [pulte('b00000000000000000000001', 'Pulte Home - Oak Hollow'), pulte('b00000000000000000000002', 'Pulte Home - Willow Bend'), { ...pulte('b00000000000000000000003', 'Pulte Home'), builder: null }];
  const { results } = plan([item('x', 'Pulte Home - Warranty walk')], jobs);
  assert.notEqual(results.get('x').job_id, 'b00000000000000000000003');
});
