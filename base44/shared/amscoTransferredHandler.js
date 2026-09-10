import { calculateTransferredWindow, transferredEngineStatus } from './amscoTransferredEngine.js';

export function createTransferredEngineHandler({ getUser }) {
  return async request => {
    const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store' };
    const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
    try {
      if (request.method !== 'POST') return reply({error:'Use POST.'},405);
      const user = await getUser(request);
      if (user?.role !== 'admin') return reply({error:'Administrator access required.'},403);
      const raw = await request.text();
      if (raw.length > 64000) return reply({error:'Request is too large.'},413);
      let body;
      try { body = JSON.parse(raw); } catch { return reply({error:'Invalid JSON.'},400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({error:'Invalid request.'},400);
      if (body.action === 'status' && Object.keys(body).length === 1) return reply(transferredEngineStatus());
      if (body.action !== 'calculate' || Object.keys(body).some(k => !['action','input'].includes(k))) return reply({error:'Use status or calculate.'},400);
      return reply(calculateTransferredWindow(body.input));
    } catch { return reply({error:'The source engine could not finish this calculation.'},503); }
  };
}
