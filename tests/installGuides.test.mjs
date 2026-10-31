// Install Type Guides (Oct 31): job-documents lists the flashing / install guide PDFs in the one
// Drive folder and sends a guide in parts, never a file from anywhere else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobDocumentsHandler, guideRange, INSTALL_GUIDES_FOLDER, GUIDE_CHUNK_BYTES } from '../base44/shared/jobDocuments.mjs';

const GUIDE = '1aaaaaaaaaaaaaaaaaaaaguide', OTHER = '1bbbbbbbbbbbbbbbbbbbbother';
const files = {
  [GUIDE]: { id: GUIDE, name: '1F Standard Flat Wall Nail-on 405 NO Sill Pan (1).pdf', size: '5', mimeType: 'application/pdf', parents: [INSTALL_GUIDES_FOLDER] },
  [OTHER]: { id: OTHER, name: 'Quote.pdf', size: '5', mimeType: 'application/pdf', parents: ['somewhere'] },
};
function setup() {
  const seen = [];
  const request = async (url, init = {}) => {
    seen.push({ url, range: init.headers?.Range });
    if (url.includes('/files?q=')) return Response.json({ files: [{ ...files[GUIDE], webViewLink: 'https://drive.google.com/g' }] });
    const id = url.split('/files/')[1]?.split('?')[0];
    if (url.includes('alt=media')) return new Response(new Uint8Array([37, 80, 68, 70, 45]));
    return files[id] ? Response.json(files[id]) : new Response('missing', { status: 404 });
  };
  const handler = createJobDocumentsHandler({ request, getClient: async () => ({ auth: { me: async () => ({ role: 'admin', email: 'gabefronk@gmail.com' }) }, asServiceRole: { entities: { Jobs: { get: async () => ({ id: 'job1' }) } }, connectors: { getConnection: async () => ({ accessToken: 't' }) } } }) });
  return { seen, call: async (body) => handler(new Request('https://app.invalid', { method: 'POST', body: JSON.stringify({ job_id: 'job1', ...body }) })) };
}

test('lists the guide PDFs in Install Type Guides', async () => {
  const { call, seen } = setup();
  const body = await (await call({ action: 'install_guides' })).json();
  assert.equal(body.guides.length, 1);
  assert.equal(body.guides[0].size, 5);
  assert.ok(decodeURIComponent(seen[0].url).includes(`'${INSTALL_GUIDES_FOLDER}' in parents`));
});

test('sends a guide in byte ranges and refuses files outside the folder', async () => {
  const { call, seen } = setup();
  const ok = await (await call({ action: 'guide_chunk', file_id: GUIDE, offset: 0 })).json();
  assert.equal(atob(ok.data), '%PDF-');
  assert.equal(ok.done, true);
  assert.equal(seen.at(-1).range, 'bytes=0-4');
  assert.equal((await call({ action: 'guide_chunk', file_id: OTHER, offset: 0 })).status, 403);
  assert.equal((await call({ action: 'guide_chunk', file_id: GUIDE, offset: 9 })).status, 400);
});

test('guide ranges are 2 MiB parts', () => {
  assert.deepEqual(guideRange(0, 3_500_000), { start: 0, end: GUIDE_CHUNK_BYTES - 1 });
  assert.deepEqual(guideRange(GUIDE_CHUNK_BYTES, 3_500_000), { start: GUIDE_CHUNK_BYTES, end: 3_499_999 });
  assert.equal(guideRange(-1, 10), null);
});
