import { authenticateWebhook } from './superagentTransport.js';
import { validateResult } from './windowQuotesCore.js';

function signedQuoteId(rawBody) {
  // authenticateWebhook has already authenticated these exact bytes. This field
  // selects one candidate only; the fetched authoritative envelope must still
  // match its current quote/revision/operation before anything can be reported.
  let content = JSON.parse(rawBody).data?.message?.content;
  if (typeof content !== 'string' || content.length > 500000) return null;
  content = content.trim();
  const fenced = content.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) content = fenced[1].trim();
  let envelope;
  try { envelope = JSON.parse(content); } catch { return null; }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.schema_version !== 1) return null;
  return typeof envelope.quote_id === 'string' && /^[a-zA-Z0-9_-]{1,150}$/.test(envelope.quote_id) ? envelope.quote_id : null;
}

export function createAgentWebhookHandler({ getClient, execution, transport, secret }) {
  return async req => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
    try {
      if (req.method !== 'POST') return new Response('{}', { status: 405, headers });
      if (!secret || !transport) return new Response('{"error":"Webhook setup required"}', { status: 503, headers });
      const rawBody = await req.text();
      const event = await authenticateWebhook({ rawBody, headers: req.headers, secret });
      const quoteId = signedQuoteId(rawBody);
      if (!quoteId) return new Response('{"ok":true,"ignored":true}', { status: 200, headers });
      const client = await getClient(req), db = client.asServiceRole.entities;
      // One shared execution conversation can belong to many historical quotes.
      // Never choose the first/latest record or route old completion to today's run.
      const rows = await db.QuoteRequests.filter({ id: quoteId, 'agent_run.conversation_id': event.conversation_id, execution_provider: 'superagent' }, undefined, 2);
      if (rows.length !== 1) return new Response('{"ok":true,"ignored":true}', { status: 200, headers });
      const q = rows[0], r = q.agent_run;
      if (!r || r.input_revision !== q.input_revision || !r.operation_id || !r.execution_token) return new Response('{"error":"Invalid agent event"}', { status: 401, headers });
      const eventId = 'webhook:' + event.message_id;
      // A terminal report can persist before slot release/draining fails. Re-enter
      // the service's idempotent path for that exact event so a retry repairs it.
      const terminalRetry = r.phase === 'completed' && ['needs_details','needs_sign_in','failed','ready'].includes(q.worker_status) && (r.event_ids || []).includes(eventId);
      if (q.worker_status !== 'running' && !terminalRetry) return new Response('{"ok":true}', { status: 200, headers });
      const correlation = { quote_id: q.id, input_revision: q.input_revision, operation_id: r.operation_id };
      const resolved = await transport.resolveWebhook({ rawBody, headers: req.headers, webhookSecret: secret, conversationId: r.conversation_id, correlation, validateResult });
      if (resolved.outcome) {
        const outcome = resolved.outcome;
        await execution.report({ db, body: { ...outcome, status: outcome.outcome === 'clarification' ? 'needs_details' : outcome.outcome, missing_details: outcome.questions, action: 'report', execution_token: r.execution_token, event_id: eventId } });
      }
      // Generic chat text is not a result. Checkpoints and completion are normally
      // reported through the guarded function while the agent is still executing.
      return new Response('{"ok":true}', { status: 200, headers });
    } catch (e) {
      const unauthorized = /SIGNATURE|WEBHOOK|EVENT|CORRELATION/.test(e?.code || '');
      return new Response(JSON.stringify({ error: unauthorized ? 'Invalid agent event' : 'Agent event could not be processed' }), { status: unauthorized ? 401 : 503, headers });
    }
  };
}


