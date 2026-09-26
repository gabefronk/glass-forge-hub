import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailRef, pickPart, needsJobFolderCopy, copyEventFilesToJobFolders } from '../base44/shared/jobFolderCopy.js';
import { preserveAttachmentMetadata } from '../base44/shared/eventAttachments.js';

const ROOT = '1F_PgUPEuvyvzCk92tdaFiwioLSack4iS';
const GMAIL_URL = 'https://mail.google.com/?view=att&th=1a0b6ea5c2321cf7&attid=0.2&disp=attd&zw';

test('reads the email and attachment position from a Gmail link', () => {
  assert.deepEqual(gmailRef(GMAIL_URL), { thread: '1a0b6ea5c2321cf7', attid: '0.2', index: 1 });
  assert.equal(gmailRef('https://drive.google.com/open?id=abc'), null);
});

const message = { id: '1a0b6ea5c2321cf7', payload: { parts: [
  { mimeType: 'text/plain', body: { size: 10 } },
  { filename: 'ORDER 2.pdf', mimeType: 'application/pdf', body: { attachmentId: 'A1', size: 11 } },
  { filename: 'Install Method.pdf', mimeType: 'application/pdf', body: { attachmentId: 'A2', size: 12 } },
] } };

test('picks the attachment by file name, then by position', () => {
  assert.equal(pickPart([message], gmailRef(GMAIL_URL), 'Install Method.pdf').attachmentId, 'A2');
  assert.equal(pickPart([message], gmailRef(GMAIL_URL), 'renamed.pdf').attachmentId, 'A2');
  assert.equal(pickPart([message], { thread: 'x', index: 0 }, 'ORDER 2.pdf').attachmentId, 'A1');
});

test('copy markers survive the next calendar sync', () => {
  const kept = preserveAttachmentMetadata([{ file_url: GMAIL_URL, title: 'x' }], [{ file_url: GMAIL_URL, job_folder_file_id: 'F9', drive_url: 'https://d/F9' }]);
  assert.equal(kept[0].job_folder_file_id, 'F9');
  assert.equal(needsJobFolderCopy(kept[0]), false);
  assert.equal(needsJobFolderCopy({ file_url: GMAIL_URL, job_folder_error: 'gmail_no_match' }), false);
  assert.equal(needsJobFolderCopy({ file_url: GMAIL_URL, job_folder_error: 'drive_500' }), true);
});

function harness({ gmail = true, existingCopy = false } = {}) {
  const job = { id: 'job1', canonical_name: 'Rainey 9-138 Daybreak', address: '6741 W Splash Way', builder: 'Rainey' };
  const event = { id: 'ev1', job_id: 'job1', event_attachments: [
    { title: 'Install Method.pdf', file_url: GMAIL_URL },
    { title: 'Plans.pdf', file_url: 'https://drive.google.com/open?id=SRC123' },
  ] };
  const unlinked = { id: 'ev2', job_id: null, event_attachments: [{ title: 'a.pdf', file_url: GMAIL_URL }] };
  const calls = [], updates = [], jobUpdates = [], store = {};
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url.startsWith('https://gmail.googleapis.com')) {
      if (url.includes('/threads/')) return Response.json({ messages: [message] });
      if (url.includes('/attachments/A2')) return Response.json({ data: Buffer.from('%PDF-1.4 test').toString('base64url') });
    }
    if (url.includes('/upload/drive/v3/files')) return Response.json({ id: 'NEWFILE', webViewLink: 'https://drive.google.com/file/d/NEWFILE/view' });
    if (url.includes('/files/SRC123/copy')) return Response.json({ id: 'COPY1', webViewLink: 'https://drive.google.com/file/d/COPY1/view' });
    if (url.includes('/files?q=')) {
      const q = decodeURIComponent(url);
      if (q.includes('gf_source')) return Response.json({ files: existingCopy ? [{ id: 'OLD', webViewLink: 'https://d/OLD' }] : [] });
      return Response.json({ files: [] });
    }
    if (url.includes('/files?fields=') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      const f = { id: 'FOLDER-' + body.name.slice(0, 6), name: body.name, mimeType: 'application/vnd.google-apps.folder', parents: body.parents, webViewLink: 'https://drive.google.com/folder' };
      store[f.id] = f;
      return Response.json(f);
    }
    const id = url.split('/files/')[1]?.split('?')[0];
    if (id && store[id]) return Response.json(store[id]);
    return new Response('missing', { status: 404 });
  };
  const client = { asServiceRole: {
    entities: {
      Jobs: { get: async () => job, update: async (id, p) => { jobUpdates.push(p); Object.assign(job, p); } },
      CalendarEvents: { update: async (id, p) => updates.push({ id, ...p }) },
    },
    connectors: { getConnection: async (kind) => (kind === 'gmail' && !gmail ? null : { accessToken: 't-' + kind }) },
  } };
  return { run: (limit) => copyEventFilesToJobFolders({ client, events: [event, unlinked], limit, fetchImpl, now: () => new Date('2026-09-26T12:00:00Z') }), calls, updates, jobUpdates, job };
}

test('copies Gmail and Drive files into a new job folder under Glass Forge Jobs', async () => {
  const h = harness();
  const s = await h.run(25);
  assert.equal(s.copied, 2);
  assert.equal(s.skipped_no_job, 1);
  assert.equal(h.jobUpdates.length, 1, 'job gets its folder linked once');
  assert.ok(h.job.drive_job_folder_id.startsWith('FOLDER-'));
  const [a, b] = h.updates[0].event_attachments;
  assert.equal(a.job_folder_file_id, 'NEWFILE');
  assert.equal(a.drive_url, 'https://drive.google.com/file/d/NEWFILE/view');
  assert.equal(b.job_folder_file_id, 'COPY1');
  const upload = h.calls.find((c) => c.url.includes('/upload/'));
  assert.equal(upload.method, 'POST');
  assert.ok(!h.calls.some((c) => c.method === 'DELETE'), 'never deletes anything');
  assert.ok(h.calls.some((c) => c.url.includes(encodeURIComponent(`'${ROOT}' in parents`)) || decodeURIComponent(c.url).includes(ROOT)));
});

test('without Israel\'s Gmail connected, Gmail files wait and Drive files still copy', async () => {
  const h = harness({ gmail: false });
  const s = await h.run(25);
  assert.equal(s.waiting_for_gmail, 1);
  assert.equal(s.skipped_no_job, 1);
  assert.equal(s.copied, 1);
  assert.equal(h.updates[0].event_attachments[0].job_folder_file_id, undefined);
  assert.equal(h.updates[0].event_attachments[0].job_folder_error, undefined);
});

test('a file already in the folder is reused, not uploaded twice', async () => {
  const h = harness({ existingCopy: true });
  const s = await h.run(25);
  assert.equal(s.reused, 2);
  assert.ok(!h.calls.some((c) => c.url.includes('/upload/')));
});

test('per-run limit leaves the rest for next sync', async () => {
  const h = harness();
  const s = await h.run(1);
  assert.equal(s.copied, 1);
  assert.equal(s.remaining, 2);
});
