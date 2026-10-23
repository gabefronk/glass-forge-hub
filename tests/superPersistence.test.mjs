// Super-contact persistence: the contacts-directory handler against an isolated
// in-memory entity store (no production data), plus the load/save race rules in
// the job-super session, plus the auto-save completeness rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactsDirectoryHandler } from '../base44/shared/contactsDirectory.js';
import { createJobSuperSession } from '../src/lib/jobSuperSession.js';
import { superEntryComplete, superEntrySig } from '../src/lib/superEntry.js';

// ---- isolated in-memory entity store --------------------------------------
function makeStore() {
  const rows = { HubContacts: [], ContactJobLink: [], ContactDirectorySnapshot: [], Jobs: [{ id: 'job1', canonical_name: 'Test Job', builder: 'Test Builder' }] };
  let seq = 0;
  const ent = (name) => ({
    list: async (sort, limit = 500, skip = 0) => rows[name].slice(skip, skip + limit),
    get: async (id) => { const r = rows[name].find((x) => x.id === id); if (!r) throw new Error('not found'); return r; },
    create: async (data) => { const r = { ...data, id: `${name}-${++seq}`, created_date: new Date(Date.now() + seq).toISOString() }; rows[name].push(r); return r; },
    update: async (id, patch) => { const r = rows[name].find((x) => x.id === id); Object.assign(r, patch); return r; },
    delete: async (id) => { rows[name] = rows[name].filter((x) => x.id !== id); },
    filter: async (q, sort, limit = 500) => rows[name].filter((x) => Object.entries(q).every(([k, v]) => x[k] === v)).slice(0, limit),
  });
  const entities = new Proxy({}, { get: (t, name) => ent(name) });
  return {
    rows,
    client: {
      auth: { me: async () => ({ id: 'u1', email: 'gabefronk@gmail.com', role: 'admin' }) },
      asServiceRole: { entities },
    },
  };
}

const invoke = async (handler, body) => {
  const res = await handler(new Request('https://x/', { method: 'POST', body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
};

const OWNER = { id: 'u1', email: 'gabefronk@gmail.com', role: 'admin' };

test('typed new super persists across reload (fresh handler invocation)', async () => {
  const { client, rows } = makeStore();
  const handler = createContactsDirectoryHandler({ getClient: async () => client });

  const saved = await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'Nick Stephenson', phone: '801-555-0142', email: '' } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.super.name, 'Nick Stephenson');
  assert.equal(rows.HubContacts.length, 1, 'one hub contact created');
  assert.equal(rows.ContactJobLink.length, 1, 'one link created');
  assert.equal(rows.ContactJobLink[0].role, 'superintendent');

  // "Reload": a brand-new request reads the stored link back.
  const read = await invoke(handler, { action: 'job_super', job_id: 'job1' });
  assert.equal(read.status, 200);
  assert.deepEqual(read.data.super, saved.data.super);
});

test('typed entry reuses an existing contact by phone instead of duplicating', async () => {
  const { client, rows } = makeStore();
  const handler = createContactsDirectoryHandler({ getClient: async () => client });
  await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'Nick S', phone: '(801) 555-0142', email: '' } });
  const again = await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'Nick Stephenson', phone: '8015550142', email: '' } });
  assert.equal(again.status, 200);
  assert.equal(rows.HubContacts.length, 1, 'still one contact - reused, not duplicated');
  assert.equal(rows.ContactJobLink.length, 1, 'still one link');
});

test('changing the super clears the old link and the new one reads back', async () => {
  const { client, rows } = makeStore();
  const handler = createContactsDirectoryHandler({ getClient: async () => client });
  await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'First Super', phone: '801-555-0101', email: '' } });
  await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'Second Super', phone: '801-555-0102', email: '' } });
  const read = await invoke(handler, { action: 'job_super', job_id: 'job1' });
  assert.equal(read.data.super.name, 'Second Super');
  const active = rows.ContactJobLink.filter((l) => l.role === 'superintendent');
  assert.equal(active.length, 1, 'exactly one active superintendent link');
});

test('partial entry (name only) is rejected and writes nothing', async () => {
  const { client, rows } = makeStore();
  const handler = createContactsDirectoryHandler({ getClient: async () => client });
  const r = await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'No Phone', phone: '', email: '' } });
  assert.equal(r.status, 400);
  assert.equal(rows.HubContacts.length, 0);
  assert.equal(rows.ContactJobLink.length, 0);
});

test('a bad phone is rejected and writes nothing', async () => {
  const { client, rows } = makeStore();
  const handler = createContactsDirectoryHandler({ getClient: async () => client });
  const r = await invoke(handler, { action: 'set_job_super', job_id: 'job1', contact: { name: 'Bad Phone', phone: '555-0142', email: '' } });
  assert.equal(r.status, 400);
  assert.equal(rows.ContactJobLink.length, 0);
});

// ---- load/save race rules ---------------------------------------------------
test('a save wins over a load already in flight (stale read cannot blank it)', async () => {
  let resolveLoad;
  const calls = [];
  const call = (body) => {
    calls.push(body.action);
    if (body.action === 'job_super') return new Promise((res) => { resolveLoad = () => res({ super: null }); });
    return Promise.resolve({ super: { key: 'k1', name: 'Nick Stephenson', phone: '801-555-0142', email: '' } });
  };
  const s = createJobSuperSession('job1', call);
  const loading = s.load();                    // slow read starts
  const saved = await s.save({ name: 'Nick Stephenson', phone: '801-555-0142', email: '' }); // save finishes first
  resolveLoad();                               // stale read resolves AFTER the save
  await loading;
  assert.equal(saved.name, 'Nick Stephenson');
  assert.deepEqual(s.getState().saved.name, 'Nick Stephenson', 'saved super survives the stale read');
});

test('a fresh load after the save still shows the saved super (reload persistence)', async () => {
  const server = { super: null };
  const call = async (body) => {
    if (body.action === 'job_super') return { super: server.super };
    server.super = { key: 'k1', name: body.contact.name, phone: body.contact.phone, email: body.contact.email };
    return { super: server.super };
  };
  const s = createJobSuperSession('job1', call);
  await s.load();
  assert.equal(s.getState().saved, null);
  await s.save({ name: 'Nick Stephenson', phone: '801-555-0142', email: '' });
  s.invalidate();                 // simulate leaving the page
  await s.load();                 // ...and coming back
  assert.equal(s.getState().saved.name, 'Nick Stephenson');
});

// ---- auto-save completeness rule --------------------------------------------
test('auto-save rule: complete only with name + full phone or email', () => {
  assert.equal(superEntryComplete({ name: 'Nick Stephenson', phone: '801-555-0142', email: '' }), true);
  assert.equal(superEntryComplete({ name: 'Nick Stephenson', phone: '', email: 'nick@example.com' }), true);
  assert.equal(superEntryComplete({ name: 'Nick', phone: '', email: '' }), false, 'name alone stays unsaved');
  assert.equal(superEntryComplete({ name: 'Nick Stephenson', phone: '555-0142', email: '' }), false, 'short phone stays unsaved');
  assert.equal(superEntryComplete({ name: 'N', phone: '801-555-0142', email: '' }), false, 'one-letter name stays unsaved');
  assert.equal(superEntryComplete({ name: 'Nick', phone: '', email: 'not-an-email' }), false);
  assert.equal(superEntrySig({ name: ' A ', phone: ' B ', email: '' }), 'A|B|');
});
