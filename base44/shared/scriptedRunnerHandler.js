import { HttpError } from './windowQuotesCore.js';

export function createScriptedRunnerHandler({ getClient, execution, getExecution }) {
  if ((!execution && typeof getExecution !== 'function') || (execution && getExecution)) throw new TypeError('Provide one static execution or one per-request execution loader');
  return async req => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST');
      const raw = await req.text();
      if (raw.length > 600000) throw new HttpError(413, 'Request too large');
      let body; try { body = JSON.parse(raw); } catch { throw new HttpError(400, 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !['poll', 'claim', 'heartbeat', 'checkpoint', 'report'].includes(body.action)) throw new HttpError(400, 'Unknown scripted runner action');
      const client = await getClient(req), db = client.asServiceRole.entities;
      // Resolve once per HTTP request, then authenticate/execute against the same
      // config snapshot. Nothing from this private snapshot is returned directly.
      const active = getExecution ? await getExecution({ db }) : execution;
      const worker = await active.authenticate({ db, key: req.headers.get('X-Quote-Worker-Key') });
      if (typeof active[body.action] !== 'function') throw new HttpError(400, 'This runner action is unavailable in the configured mode');
      const output = await active[body.action]({ db, worker, body });
      return new Response(JSON.stringify(output), { status: 200, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: error instanceof HttpError ? error.message : 'The scripted quote service could not complete the request. Preserve the same operation and event IDs before retrying.' }), { status: error instanceof HttpError ? error.status : 503, headers });
    }
  };
}
