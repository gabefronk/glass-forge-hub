// Stateful Google Drive v3 mock for the tax-record save tests. Understands the query clauses
// emailTaxDrive.js sends ('<id>' in parents, appProperties has {...}, mimeType=, name=,
// trashed=false) and the JSON / multipart create calls. Faults can be queued per create.
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

export function makeDriveMock(seedFiles = []) {
  const state = { files: seedFiles.map((f) => ({ parents: ['root'], appProperties: {}, ...f })), creates: [], finds: 0, faults: [], clock: 0 };
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 0, 0, state.clock++)).toISOString();
  let serial = 0;
  const res = (status, data) => ({ ok: status < 400, status, headers: { get: () => null }, text: async () => (data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data)) });

  function query(q) {
    const parent = q.match(/'((?:[^'\\]|\\.)*)' in parents/);
    const props = [...q.matchAll(/appProperties has \{ key='((?:[^'\\]|\\.)*)' and value='((?:[^'\\]|\\.)*)' \}/g)].map((m) => [unq(m[1]), unq(m[2])]);
    const mime = q.match(/mimeType='([^']*)'/);
    const name = q.match(/(?:^| )name='((?:[^'\\]|\\.)*)'/);
    return state.files.filter((f) => !f.trashed
      && (!parent || (f.parents || []).includes(unq(parent[1])))
      && props.every(([k, v]) => f.appProperties?.[k] === v)
      && (!mime || f.mimeType === mime[1])
      && (!name || f.name === unq(name[1])));
  }

  function metaOf(init) {
    const body = String(init.body || '');
    if (!body.startsWith('--')) return JSON.parse(body);
    const start = body.indexOf('\r\n\r\n') + 4;
    return JSON.parse(body.slice(start, body.indexOf('\r\n--', start)));
  }

  async function fetchImpl(url, init = {}) {
    const method = init.method || 'GET';
    if (method === 'GET' && url.includes('/drive/v3/files?q=')) {
      state.finds++;
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
      return res(200, { files: query(q).map((f) => ({ id: f.id, name: f.name, createdTime: f.createdTime, webViewLink: f.webViewLink, parents: f.parents })) });
    }
    if (method === 'POST' && url.includes('/drive/v3/files')) {
      const meta = metaOf(init);
      const kind = meta.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : meta.mimeType === 'application/vnd.google-apps.document' ? 'doc' : 'file';
      const fault = state.faults.findIndex((x) => x.kind === kind);
      const mode = fault >= 0 ? state.faults.splice(fault, 1)[0].mode : null;
      state.creates.push({ kind, name: meta.name, mode });
      if (mode === 'throw') throw new Error('socket hang up'); // nothing created
      if (mode === '503') return res(503, 'backend error');
      if (mode === '400') return res(400, 'bad request');
      const id = `d${++serial}`;
      const f = { id, name: meta.name, mimeType: meta.mimeType || 'application/pdf', parents: meta.parents || ['root'], appProperties: meta.appProperties || {}, createdTime: stamp(), webViewLink: `https://drive.google.com/${kind === 'folder' ? 'drive/folders' : 'file/d'}/${id}` };
      state.files.push(f);
      if (mode === 'lost') throw new Error('connection reset after send'); // created, reply lost
      return res(200, { id, name: f.name, createdTime: f.createdTime, webViewLink: f.webViewLink });
    }
    return null;
  }
  const byKind = (kind) => state.files.filter((f) => f.appProperties?.gf_kind === kind);
  return { state, fetchImpl, byKind, folders: () => state.files.filter((f) => f.mimeType === 'application/vnd.google-apps.folder') };
}