import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  DEFAULT_AGENT_ID, MAX_MESSAGE_CHARS, SuperagentTransportError,
  createSuperagentTransport, makeDispatchMarker, buildDispatchContent,
  findConversationByCorrelation, findDispatchedMessage,
  verifyWebhookSignature, authenticateWebhook, matchAgentEnvelope
} from "../shared/superagentTransport.js";
globalThis.crypto ??= webcrypto;
const correlation = { quote_id: "quote1", input_revision: 1, operation_id: "quote:quote1:revision:1:input:initial" };
const apiKey = crypto.randomUUID(); // Generated test-only value, never a real credential.
const webhookSecret = crypto.randomUUID();
const clone = value => JSON.parse(JSON.stringify(value));
const conversation = (messages = [], c = correlation) => ({ id: "conversation1", app_id: DEFAULT_AGENT_ID, agent_name: "test", metadata: { window_quote: clone(c) }, messages });
const dispatched = (c = correlation) => ({ id: "user1", role: "user", content: buildDispatchContent(c, "Configure the supplied window schedule.") });
const envelope = (changes = {}) => ({ schema_version: 1, ...correlation, outcome: "clarification", questions: ["Are these call dimensions?"], ...changes });
const assistant = (content = JSON.stringify(envelope())) => ({ id: "assistant1", role: "assistant", content, tool_calls: [], file_urls: [] });
function transportWith(responseFactory, options = {}) {
  const calls = [];
  const transport = createSuperagentTransport({ apiKey, ...options, fetchImpl: async (url, init) => {
    calls.push({ url, ...init, json: init.body ? JSON.parse(init.body) : undefined });
    return responseFactory(url, init);
  }});
  return { transport, calls };
}
const jsonResponse = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function signed(payload, changes = {}) {
  const rawBody = JSON.stringify(payload);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return { rawBody, headers: { "X-Base44-Event": "message.completed", "X-Base44-Delivery": crypto.randomUUID(), "X-Base44-Signature": "sha256=" + Array.from(signature, b => b.toString(16).padStart(2, "0")).join(""), ...changes } };
}
const eventPayload = (message = assistant(), changes = {}) => ({ event: "message.completed", app_id: DEFAULT_AGENT_ID, conversation_id: "conversation1", timestamp: "2026-09-06T22:00:00Z", data: { message }, ...changes });

test("create uses only the verified route, api_key header and correlation metadata", async () => {
  const { transport, calls } = transportWith(() => jsonResponse(conversation()));
  const result = await transport.createConversation(correlation);
  assert.equal(result.id, "conversation1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.base44.com/api/agents/" + DEFAULT_AGENT_ID + "/conversations");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.api_key, apiKey);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.deepEqual(calls[0].json, { metadata: { window_quote: correlation } });
  assert.equal(calls[0].redirect, "manual");
});
test("send includes the dispatch marker inside the documented 8000 character limit", async () => {
  const { transport, calls } = transportWith(() => new Response("processing accepted"));
  const content = "x".repeat(MAX_MESSAGE_CHARS - makeDispatchMarker(correlation).length - 1);
  const result = await transport.sendMessage({ conversationId: "conversation1", correlation, content });
  assert.equal(result.accepted, true);
  assert.equal(result.provider_response, "processing accepted");
  assert.equal(calls[0].url.endsWith("/conversations/conversation1/messages"), true);
  assert.deepEqual(Object.keys(calls[0].json).sort(), ["additional_message_params", "content", "file_urls", "role"]);
  assert.equal(calls[0].json.content.length, 8000);
  assert.equal(calls[0].json.role, "user");
  assert.deepEqual(calls[0].json.file_urls, []);
  await assert.rejects(transport.sendMessage({ conversationId: "conversation1", correlation, content: content + "x" }), e => e.code === "CONTENT_EXCEEDS_8000_CHARACTERS");
  assert.equal(calls.length, 1);
});
test("successful empty message response is only acceptance, never a ready result", async () => {
  const { transport } = transportWith(() => new Response(null, { status: 202 }));
  const result = await transport.sendMessage({ conversationId: "conversation1", correlation, content: "A quote request" });
  assert.deepEqual(result, { accepted: true, conversation_id: "conversation1", dispatch_marker: makeDispatchMarker(correlation), provider_response: null });
});
test("uncertain send times out once even if fetch ignores abort, without retrying", async () => {
  const { transport, calls } = transportWith(() => new Promise(() => {}), { timeoutMs: 10 });
  await assert.rejects(transport.sendMessage({ conversationId: "conversation1", correlation, content: "A quote request" }), e => e.code === "TIMEOUT" && e.uncertain === true && e.automaticRetryAllowed === false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});
test("continuation sends one documented POST with a distinct marker and preserves original dispatch matching", async () => {
  const { transport, calls } = transportWith(() => new Response(null, { status: 202 }));
  const content = "Read this operation's saved checkpoint before continuing.";
  const result = await transport.sendContinuation({ conversationId: "conversation1", correlation, continuationId: "segment-1", content });
  assert.deepEqual(result, { accepted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.base44.com/api/agents/" + DEFAULT_AGENT_ID + "/conversations/conversation1/messages");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].redirect, "manual");
  assert.equal(calls[0].headers.api_key, apiKey);
  const marker = "[WindowQuote continuation=segment-1 operation=" + encodeURIComponent(correlation.operation_id) + " quote=quote1 revision=1]";
  assert.deepEqual(calls[0].json, { role: "user", content: marker + "\n" + content, file_urls: [], additional_message_params: {} });
  assert.notEqual(marker, makeDispatchMarker(correlation));
  const original = dispatched();
  const reconciled = findDispatchedMessage(conversation([original, { id: "continuation-message", ...calls[0].json }]), correlation);
  assert.equal(reconciled.state, "accepted");
  assert.equal(reconciled.message.id, original.id);
});
test("continuation timeout remains uncertain and makes no automatic second POST", async () => {
  const { transport, calls } = transportWith(() => new Promise(() => {}), { timeoutMs: 10 });
  await assert.rejects(transport.sendContinuation({ conversationId: "conversation1", correlation, continuationId: "segment-1", content: "Continue from the saved checkpoint." }),
    e => e instanceof SuperagentTransportError && e.code === "TIMEOUT" && e.operation === "send continuation" && e.uncertain === true && e.automaticRetryAllowed === false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].signal.aborted, true);
});
test("continuation refuses invalid identifiers, oversized content and nested dispatch markers before network", async () => {
  const { transport, calls } = transportWith(() => new Response(null, { status: 202 }));
  const input = { conversationId: "conversation1", correlation, continuationId: "segment-1", content: "Continue from the saved checkpoint." };
  for (const change of [
    { conversationId: "../other" }, { continuationId: "../other" },
    { correlation: { ...correlation, quote_id: "../other" } },
    { content: "x".repeat(MAX_MESSAGE_CHARS) },
    { content: makeDispatchMarker(correlation) },
    { content: "[WindowQuote continuation=other]" }
  ]) await assert.rejects(transport.sendContinuation({ ...input, ...change }));
  assert.equal(calls.length, 0);
});
test("continuation errors preserve manual redirect handling and redact provider failures without retries", async () => {
  const input = { conversationId: "conversation1", correlation, continuationId: "segment-1", content: "Continue from the saved checkpoint." };
  for (const status of [302, 503]) {
    const { transport, calls } = transportWith(() => new Response(apiKey, { status, headers: { Location: "https://another.example/redirect" } }));
    await assert.rejects(transport.sendContinuation(input), e => e instanceof SuperagentTransportError && e.code === "HTTP_" + status && e.uncertain === (status === 503) && e.automaticRetryAllowed === false && !String(e).includes(apiKey) && !JSON.stringify(e).includes(apiKey));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].redirect, "manual");
  }
});
test("create and send failures expose neither provider bodies nor API credentials", async () => {
  const { transport, calls } = transportWith(() => new Response(apiKey, { status: 503 }));
  await assert.rejects(transport.createConversation(correlation), e => e instanceof SuperagentTransportError && e.uncertain && !String(e).includes(apiKey) && !JSON.stringify(e).includes(apiKey));
  assert.equal(calls.length, 1);
  const network = transportWith(() => { throw new Error("leaked header " + apiKey); });
  await assert.rejects(network.transport.sendMessage({ conversationId: "conversation1", correlation, content: "A quote request" }), e => e.code === "NETWORK_ERROR" && !String(e).includes(apiKey) && !e.diagnostic.includes(apiKey) && e.diagnostic.includes('[REDACTED]') && !JSON.stringify(e).includes('leaked header'));
});
test("malformed successful creation remains uncertain and cannot trigger another create", async () => {
  const { transport, calls } = transportWith(() => jsonResponse({ id: "conversation1" }));
  await assert.rejects(transport.createConversation(correlation), e => e.code === "UNRECOGNIZED_CONVERSATION" && e.uncertain);
  assert.equal(calls.length, 1);
});
test("unacknowledged creation preserves private candidate and HTTP provenance without accepting it", async () => {
  const candidate = { ...conversation(), metadata: { analytics_channel: 'in_app' }, created_date: '2026-09-06T22:00:00Z' };
  const { transport, calls } = transportWith(() => jsonResponse(candidate, 201));
  await assert.rejects(transport.createConversation(correlation), error => {
    assert.equal(error.code, 'CORRELATION_NOT_ACKNOWLEDGED');
    assert.equal(error.uncertain, true);assert.equal(error.automaticRetryAllowed, false);
    assert.deepEqual(error.observed_conversation, { id: candidate.id, app_id: candidate.app_id, metadata: candidate.metadata, message_count: 0, created_date: candidate.created_date });
    assert.deepEqual(error.http_response, { method: 'POST', path: '/conversations', status: 201 });
    assert.ok(!JSON.stringify(error).includes(candidate.id));
    assert.ok(!JSON.stringify(error).includes('in_app'));
    return true;
  });
  assert.equal(calls.length, 1);
});
test("another agent's conversation is never retained as a validated creation candidate", async () => {
  const { transport, calls } = transportWith(() => jsonResponse({ ...conversation(), app_id: 'otherAgent' }));
  await assert.rejects(transport.createConversation(correlation), error => error.code === 'UNRECOGNIZED_CONVERSATION' && error.uncertain && !error.observed_conversation);
  assert.equal(calls.length, 1);
});
test("reconciliation reads only the recorded conversation and never resends missing messages", async () => {
  const { transport, calls } = transportWith(() => jsonResponse(conversation()));
  const result = await transport.reconcileDispatch({ conversationId: "conversation1", correlation });
  assert.equal(result.state, "not_found");
  assert.equal(result.safe_to_resend, false);
  assert.equal(calls.length, 1);assert.equal(calls[0].method, "GET");
});
test("dispatch matching is exact and reports duplicate acceptance as ambiguous", () => {
  assert.equal(findDispatchedMessage(conversation([dispatched()]), correlation).state, "accepted");
  assert.equal(findDispatchedMessage(conversation([{ ...dispatched(), content: "A quote request" }]), correlation).state, "not_found");
  assert.equal(findDispatchedMessage(conversation([dispatched(), { ...dispatched(), id: "user2" }]), correlation).state, "ambiguous");
  assert.throws(() => findDispatchedMessage(conversation([], { ...correlation, quote_id: "other" }), correlation), e => e.code === "CONVERSATION_QUOTE_MISMATCH");
});
test("missing quote metadata requires explicit exact conversation and agent binding", () => {
  const shared = { ...conversation([dispatched()]), metadata: { analytics_channel: 'in_app' } };
  const binding = { conversationId: 'conversation1', agentId: DEFAULT_AGENT_ID };
  assert.throws(() => findDispatchedMessage(shared, correlation), e => e.code === 'CONVERSATION_QUOTE_MISMATCH');
  assert.equal(findDispatchedMessage(shared, correlation, binding).state, 'accepted');
  for (const change of [{ conversationId: 'wrong' }, { agentId: 'wrong' }]) assert.throws(() => findDispatchedMessage(shared, correlation, { ...binding, ...change }), e => e.code === 'BOUND_CONVERSATION_MISMATCH');
  for (const window_quote of [null, {}, { ...correlation, quote_id: 'other' }]) assert.throws(() => findDispatchedMessage({ ...shared, metadata: { window_quote } }, correlation, binding), e => e.code === 'CONVERSATION_QUOTE_MISMATCH');
});
test("shared reconciliation tolerates absent metadata but never infers acceptance from an empty history", async () => {
  const value = { ...conversation([dispatched()]) };delete value.metadata;
  const accepted = transportWith(() => jsonResponse(value));
  assert.equal((await accepted.transport.reconcileDispatch({ conversationId: 'conversation1', correlation })).state, 'accepted');
  const empty = transportWith(() => jsonResponse({ ...value, messages: [] }));
  const result = await empty.transport.reconcileDispatch({ conversationId: 'conversation1', correlation });
  assert.equal(result.state, 'not_found');assert.equal(result.safe_to_resend, false);assert.equal(empty.calls.length, 1);
});
test("creation reconciliation requires exact metadata and does not assume an unverified list envelope", () => {
  assert.equal(findConversationByCorrelation([conversation()], correlation).state, "found");
  assert.equal(findConversationByCorrelation([], correlation).safe_to_resend, false);
  assert.equal(findConversationByCorrelation([conversation(), { ...conversation(), id: "conversation2" }], correlation).state, "ambiguous");
  assert.throws(() => findConversationByCorrelation({ items: [conversation()] }, correlation), e => e.code === "UNRECOGNIZED_CONVERSATION_LIST");
});
test("webhook registration uses the exact verified schema with no automatic retry", async () => {
  const { transport, calls } = transportWith(() => jsonResponse({ id: "hook1", secret: webhookSecret }));
  const hook = await transport.registerWebhook({ targetUrl: "https://example.test/verified-handler" });
  assert.equal(hook.secret, webhookSecret);
  assert.equal(calls[0].url.endsWith("/webhooks"), true);
  assert.deepEqual(calls[0].json, { target_url: "https://example.test/verified-handler", events: ["message.completed"], description: "Window Quotes completion events", generate_secret: true });
});
test("HMAC validation uses exact raw bytes, including whitespace and UTF-8", async () => {
  const signedEvent = await signed(eventPayload(assistant("Taupe — confirmé")));
  assert.equal(await verifyWebhookSignature({ rawBody: signedEvent.rawBody, signature: signedEvent.headers["X-Base44-Signature"], secret: webhookSecret }), true);
  assert.equal(await verifyWebhookSignature({ rawBody: signedEvent.rawBody + " ", signature: signedEvent.headers["X-Base44-Signature"], secret: webhookSecret }), false);
  assert.equal(await verifyWebhookSignature({ rawBody: signedEvent.rawBody, signature: "sha256=" + "0".repeat(64), secret: webhookSecret }), false);
});
test("authenticate rejects wrong event, agent, role and missing delivery after signature validation", async () => {
  for (const payload of [eventPayload(assistant(), { app_id: "otherAgent" }), eventPayload({ ...assistant(), role: "user" })]) {
    const event = await signed(payload);
    await assert.rejects(authenticateWebhook({ ...event, secret: webhookSecret }));
  }
  const event = await signed(eventPayload());
  await assert.rejects(authenticateWebhook({ ...event, headers: { ...event.headers, "X-Base44-Event": "message.created" }, secret: webhookSecret }));
  await assert.rejects(authenticateWebhook({ ...event, headers: { ...event.headers, "X-Base44-Delivery": "" }, secret: webhookSecret }));
});
test("delivery retries share logical message dedupe key but retain distinct attempt IDs", async () => {
  const first = await signed(eventPayload()), second = await signed(eventPayload());
  const a = await authenticateWebhook({ ...first, secret: webhookSecret }), b = await authenticateWebhook({ ...second, secret: webhookSecret });
  assert.equal(a.dedupe_key, b.dedupe_key);
  assert.notEqual(a.delivery_id, b.delivery_id);
  assert.equal(a.message, undefined);
});
test("ordinary completed assistant text is not a quote result; strict envelopes bind active operation", () => {
  assert.equal(matchAgentEnvelope("Your quote is ready to be viewed.", { correlation }), null);
  assert.deepEqual(matchAgentEnvelope("```json\n" + JSON.stringify(envelope()) + "\n```", { correlation }), envelope());
  assert.throws(() => matchAgentEnvelope(JSON.stringify(envelope({ input_revision: 2 })), { correlation }), e => e.code === "RESULT_CORRELATION_MISMATCH");
  assert.throws(() => matchAgentEnvelope(JSON.stringify(envelope({ operation_id: "another" })), { correlation }), e => e.code === "RESULT_CORRELATION_MISMATCH");
  assert.throws(() => matchAgentEnvelope(JSON.stringify(envelope({ questions: [] })), { correlation }), e => e.code === "INVALID_CLARIFICATION");
});
test("ready envelopes require existing native-result validator; verified:true alone is rejected", () => {
  const content = JSON.stringify(envelope({ outcome: "ready", result: { verified: true } }));
  assert.throws(() => matchAgentEnvelope(content, { correlation }), e => e.code === "RESULT_VALIDATOR_REQUIRED");
  assert.throws(() => matchAgentEnvelope(content, { correlation, validateResult: () => ({ verified: false }) }), e => e.code === "RESULT_NOT_VALIDATED");
  assert.throws(() => matchAgentEnvelope(content, { correlation, validateResult: () => { throw new Error("Expected native fields missing"); } }));
  assert.equal(matchAgentEnvelope(content, { correlation, validateResult: () => ({ verified: true, native_quote_number: "test" }) }).result.native_quote_number, "test");
});
test("resolveWebhook authenticates first and trusts only the API-fetched message body", async () => {
  const { transport, calls } = transportWith(() => jsonResponse(conversation([dispatched(), assistant()])));
  const signedEvent = await signed(eventPayload(assistant("forged event body ready text")));
  const resolved = await transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: "conversation1", correlation });
  assert.equal(resolved.outcome.outcome, "clarification");
  assert.equal(calls.length, 1);assert.equal(calls[0].method, "GET");
  await assert.rejects(transport.resolveWebhook({ ...signedEvent, headers: { ...signedEvent.headers, "X-Base44-Signature": "sha256=" + "0".repeat(64) }, webhookSecret, conversationId: "conversation1", correlation }), e => e.code === "INVALID_WEBHOOK_SIGNATURE");
  assert.equal(calls.length, 1);
});
test("resolveWebhook refuses another conversation, absent dispatch marker, and stale result revision", async () => {
  const signedEvent = await signed(eventPayload());
  const { transport } = transportWith(() => jsonResponse(conversation([dispatched(), assistant(JSON.stringify(envelope({ input_revision: 2 })))])));
  await assert.rejects(transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: "conversation2", correlation }), e => e.code === "WEBHOOK_CONVERSATION_MISMATCH");
  await assert.rejects(transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: "conversation1", correlation }), e => e.code === "RESULT_CORRELATION_MISMATCH");
  const absent = transportWith(() => jsonResponse(conversation([assistant()])));
  await assert.rejects(absent.transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: "conversation1", correlation }), e => e.code === "DISPATCH_NOT_UNIQUELY_CONFIRMED");
});
test("shared webhook requires the exact marker and authoritative message even with authenticated completion", async () => {
  const signedEvent = await signed(eventPayload());
  const shared = { ...conversation([dispatched(), assistant()]), metadata: {} };
  const good = transportWith(() => jsonResponse(shared));
  assert.equal((await good.transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: 'conversation1', correlation })).outcome.outcome, 'clarification');
  for (const messages of [[], [assistant()], [dispatched(), dispatched(), assistant()]]) {
    const missing = transportWith(() => jsonResponse({ ...shared, messages }));
    await assert.rejects(missing.transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: 'conversation1', correlation }), e => e.code === 'DISPATCH_NOT_UNIQUELY_CONFIRMED');
  }
  const omitted = { ...shared };delete omitted.messages;
  const malformed = transportWith(() => jsonResponse(omitted));
  await assert.rejects(malformed.transport.resolveWebhook({ ...signedEvent, webhookSecret, conversationId: 'conversation1', correlation }), e => e.code === 'UNRECOGNIZED_CONVERSATION');
});
test("same conversation supports a later input revision without changing original creation metadata", async () => {
  const reply = { ...correlation, input_revision: 2, operation_id: "quote:quote1:revision:2:input:reply" };
  const message = assistant(JSON.stringify(envelope({ ...reply, questions: ["Confirm screen"] })));
  const { transport } = transportWith(() => jsonResponse(conversation([dispatched(), dispatched(reply), message])));
  const event = await signed(eventPayload(message));
  assert.equal((await transport.resolveWebhook({ ...event, webhookSecret, conversationId: "conversation1", correlation: reply })).outcome.input_revision, 2);
});
test("unsafe identifiers, excessive timeout and injected markers are rejected before network", () => {
  assert.throws(() => createSuperagentTransport({ apiKey, agentId: "../another" }));
  assert.throws(() => createSuperagentTransport({ apiKey, timeoutMs: 20001 }));
  assert.throws(() => buildDispatchContent(correlation, makeDispatchMarker(correlation)));
});


