// Verified Base44 Superagent Developer API contract. No credentials are stored here.
export const DEFAULT_AGENT_ID = "6a9da9c1b336da0cae1bb8f5";
export const MAX_MESSAGE_CHARS = 8000;
const MAX_RESPONSE_CHARS = 1000000;
const CORRELATION_KEY = "window_quote";
const MARKER_PREFIX = "[WindowQuote operation=";
const encoder = new TextEncoder();

export class SuperagentTransportError extends Error {
  constructor(code, operation, { status, uncertain = false } = {}) {
    super("Superagent " + operation + " failed (" + code + ")");
    this.name = "SuperagentTransportError";
    this.code = code;
    this.operation = operation;
    this.status = status;
    this.uncertain = uncertain;
    this.automaticRetryAllowed = false;
  }
}
function contract(condition, code) {
  if (!condition) throw new SuperagentTransportError(code, "contract validation");
}
function identifier(value, name) {
  contract(typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value), "INVALID_" + name);
  return value;
}
function normalizedCorrelation(value) {
  contract(value && typeof value === "object", "MISSING_CORRELATION");
  const quote_id = identifier(value.quote_id, "QUOTE_ID");
  contract(Number.isInteger(value.input_revision) && value.input_revision > 0, "INVALID_REVISION");
  contract(typeof value.operation_id === "string" && value.operation_id.trim() === value.operation_id && value.operation_id.length > 0 && value.operation_id.length <= 300 && !/[\r\n]/.test(value.operation_id), "INVALID_OPERATION_ID");
  return { quote_id, input_revision: value.input_revision, operation_id: value.operation_id };
}
function sameCorrelation(one, two) {
  return one?.quote_id === two.quote_id && one?.input_revision === two.input_revision && one?.operation_id === two.operation_id;
}
export function makeDispatchMarker(correlation) {
  const c = normalizedCorrelation(correlation);
  return MARKER_PREFIX + encodeURIComponent(c.operation_id) + " quote=" + encodeURIComponent(c.quote_id) + " revision=" + c.input_revision + "]";
}
export function buildDispatchContent(correlation, content) {
  contract(typeof content === "string" && content.trim().length > 0, "INVALID_CONTENT");
  contract(!content.includes(MARKER_PREFIX), "NESTED_DISPATCH_MARKER");
  const output = makeDispatchMarker(correlation) + "\n" + content;
  contract(output.length <= MAX_MESSAGE_CHARS, "CONTENT_EXCEEDS_8000_CHARACTERS");
  return output;
}
export function findConversationByCorrelation(conversations, correlation) {
  const c = normalizedCorrelation(correlation);
  // Only the documented list itself is accepted; no guessed pagination/envelope keys.
  contract(Array.isArray(conversations), "UNRECOGNIZED_CONVERSATION_LIST");
  const matches = conversations.filter(item => sameCorrelation(item?.metadata?.[CORRELATION_KEY], c));
  if (matches.length > 1) return { state: "ambiguous", conversation: null, count: matches.length, safe_to_resend: false };
  return { state: matches.length ? "found" : "not_found", conversation: matches[0] || null, safe_to_resend: false };
}
export function findDispatchedMessage(conversation, correlation) {
  const c = normalizedCorrelation(correlation);
  contract(Array.isArray(conversation?.messages), "MISSING_CONVERSATION_MESSAGES");
  contract(conversation.metadata?.[CORRELATION_KEY]?.quote_id === c.quote_id, "CONVERSATION_QUOTE_MISMATCH");
  const marker = makeDispatchMarker(c);
  const matches = conversation.messages.filter(m => m?.role === "user" && typeof m.content === "string" && (m.content === marker || m.content.startsWith(marker + "\n")));
  if (matches.length > 1) return { state: "ambiguous", message: null, count: matches.length, safe_to_resend: false };
  return { state: matches.length ? "accepted" : "not_found", message: matches[0] || null, safe_to_resend: false };
}
function rawBytes(rawBody) {
  if (typeof rawBody === "string") return encoder.encode(rawBody);
  if (rawBody instanceof Uint8Array) return rawBody;
  if (rawBody instanceof ArrayBuffer) return new Uint8Array(rawBody);
  throw new SuperagentTransportError("RAW_BODY_REQUIRED", "webhook verification");
}
export async function verifyWebhookSignature({ rawBody, signature, secret, cryptoImpl = globalThis.crypto }) {
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/i.test(signature) || typeof secret !== "string" || !secret) return false;
  const bytes = rawBytes(rawBody);
  if (bytes.byteLength > MAX_RESPONSE_CHARS) return false;
  const sig = Uint8Array.from(signature.slice(7).match(/.{2}/g), pair => Number.parseInt(pair, 16));
  const key = await cryptoImpl.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return cryptoImpl.subtle.verify("HMAC", key, sig, bytes);
}
export async function authenticateWebhook({ rawBody, headers, secret, agentId = DEFAULT_AGENT_ID, cryptoImpl = globalThis.crypto }) {
  const h = new Headers(headers);
  contract(await verifyWebhookSignature({ rawBody, signature: h.get("X-Base44-Signature"), secret, cryptoImpl }), "INVALID_WEBHOOK_SIGNATURE");
  contract(h.get("X-Base44-Event") === "message.completed", "UNSUPPORTED_WEBHOOK_EVENT");
  let payload;
  try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes(rawBody))); }
  catch { throw new SuperagentTransportError("INVALID_WEBHOOK_JSON", "webhook verification"); }
  contract(payload?.event === "message.completed" && payload.app_id === agentId, "WEBHOOK_AGENT_OR_EVENT_MISMATCH");
  const conversation_id = identifier(payload.conversation_id, "CONVERSATION_ID");
  const message = payload.data?.message;
  contract(message?.role === "assistant", "WEBHOOK_NOT_ASSISTANT_MESSAGE");
  identifier(message.id, "MESSAGE_ID");
  contract(typeof message.content === "string", "WEBHOOK_MESSAGE_CONTENT_MISSING");
  const delivery_id = h.get("X-Base44-Delivery");
  contract(typeof delivery_id === "string" && delivery_id.length > 0 && delivery_id.length <= 500, "WEBHOOK_DELIVERY_ID_MISSING");
  contract(typeof payload.timestamp === "string" || typeof payload.timestamp === "number", "WEBHOOK_TIMESTAMP_MISSING");
  // Delivery IDs identify attempts, not logical completions. Persist/dedupe this message key.
  // No undocumented timestamp tolerance is imposed; caller must reject stale quote revisions.
  return { event: payload.event, agent_id: agentId, conversation_id, message_id: message.id, delivery_id, timestamp: payload.timestamp, dedupe_key: agentId + ":" + conversation_id + ":" + message.id };
}
export function matchAgentEnvelope(content, { correlation, validateResult } = {}) {
  const expected = normalizedCorrelation(correlation);
  if (typeof content !== "string" || content.length > 500000) return null;
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  if (fenced) text = fenced[1].trim();
  let outcome;
  try { outcome = JSON.parse(text); } catch { return null; }
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome) || outcome.schema_version !== 1) return null;
  contract(sameCorrelation(outcome, expected), "RESULT_CORRELATION_MISMATCH");
  contract(["clarification", "needs_sign_in", "failed", "ready"].includes(outcome.outcome), "UNKNOWN_OUTCOME");
  if (outcome.outcome === "clarification") {
    contract(Array.isArray(outcome.questions) && outcome.questions.length > 0 && outcome.questions.length <= 100 && outcome.questions.every(q => typeof q === "string" && q.trim() && q.length <= 2000), "INVALID_CLARIFICATION");
  }
  if (outcome.outcome === "ready") {
    contract(typeof validateResult === "function", "RESULT_VALIDATOR_REQUIRED");
    // The caller supplies the existing quote-specific native result/evidence validator.
    // A signed event and a model's verified:true flag alone are insufficient.
    const validated = validateResult(outcome.result);
    contract(validated && typeof validated === "object" && typeof validated.then !== "function" && validated.verified === true, "RESULT_NOT_VALIDATED");
    outcome = { ...outcome, result: validated };
  }
  return outcome;
}
function authoritativeMessage(conversation, event, correlation, conversationId) {
  contract(conversation?.id === conversationId && conversation.id === event.conversation_id && conversation.app_id === event.agent_id, "AUTHORITATIVE_CONVERSATION_MISMATCH");
  const dispatched = findDispatchedMessage(conversation, correlation);
  contract(dispatched.state === "accepted", "DISPATCH_NOT_UNIQUELY_CONFIRMED");
  const messages = conversation.messages;
  const matches = messages.map((m, index) => ({ m, index })).filter(item => item.m?.id === event.message_id);
  contract(matches.length === 1 && matches[0].m.role === "assistant", "AUTHORITATIVE_MESSAGE_NOT_FOUND");
  // The API contract does not specify message ordering or sortable IDs. Bind the
  // exact authoritative message by ID; its structured envelope must match the
  // currently recorded operation/revision, and the core still applies its CAS.
  return matches[0].m;
}
export function createSuperagentTransport({ apiKey, agentId = DEFAULT_AGENT_ID, fetchImpl = globalThis.fetch, timeoutMs = 20000, cryptoImpl = globalThis.crypto } = {}) {
  contract(typeof apiKey === "string" && apiKey.length > 0 && !/[\r\n]/.test(apiKey), "API_KEY_REQUIRED");
  identifier(agentId, "AGENT_ID");
  contract(typeof fetchImpl === "function", "FETCH_REQUIRED");
  contract(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 20000, "TIMEOUT_MUST_BE_AT_MOST_20000MS");
  const baseUrl = "https://app.base44.com/api/agents/" + agentId;
  async function request(method, path, body, operation, flexibleResponse = false) {
    const writes = method === "POST";
    const abort = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { abort.abort(); reject(new SuperagentTransportError("TIMEOUT", operation, { uncertain: writes })); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async () => {
        let response;
        try {
          response = await fetchImpl(baseUrl + path, {
            method, headers: { api_key: apiKey, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: abort.signal, redirect: "error"
          });
        } catch {
          throw new SuperagentTransportError(abort.signal.aborted ? "TIMEOUT" : "NETWORK_ERROR", operation, { uncertain: writes });
        }
        if (!response.ok) throw new SuperagentTransportError("HTTP_" + response.status, operation, { status: response.status, uncertain: writes && (response.status >= 500 || [408, 409, 429].includes(response.status)) });
        let text;
        try { text = await response.text(); } catch { throw new SuperagentTransportError("RESPONSE_INTERRUPTED", operation, { uncertain: writes }); }
        if (text.length > MAX_RESPONSE_CHARS) throw new SuperagentTransportError("RESPONSE_TOO_LARGE", operation, { uncertain: writes });
        try { return text ? JSON.parse(text) : flexibleResponse ? null : (() => { throw new Error(); })(); }
        catch { if (flexibleResponse) return text; throw new SuperagentTransportError("UNRECOGNIZED_RESPONSE", operation, { uncertain: writes }); }
      })()]);
    } finally { clearTimeout(timer); }
  }
  function validateConversation(value, id, operation, uncertain = false) {
    if (!value || typeof value !== "object" || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.id) || value.app_id !== agentId || !Array.isArray(value.messages) || !value.metadata || typeof value.metadata !== "object" || (id && value.id !== id)) throw new SuperagentTransportError("UNRECOGNIZED_CONVERSATION", operation, { uncertain });
    return value;
  }
  const transport = {
    async createConversation(correlation) {
      const c = normalizedCorrelation(correlation);
      const conversation = validateConversation(await request("POST", "/conversations", { metadata: { [CORRELATION_KEY]: c } }, "create conversation"), null, "create conversation", true);
      if (!sameCorrelation(conversation.metadata[CORRELATION_KEY], c)) throw new SuperagentTransportError("CORRELATION_NOT_ACKNOWLEDGED", "create conversation", { uncertain: true });
      return conversation;
    },
    async getConversation(conversationId) {
      identifier(conversationId, "CONVERSATION_ID");
      return validateConversation(await request("GET", "/conversations/" + encodeURIComponent(conversationId), undefined, "read conversation"), conversationId, "read conversation");
    },
    async listConversations() {
      // No undocumented filters, sorting query, pagination or envelope assumptions.
      return request("GET", "/conversations", undefined, "list conversations");
    },
    async registerWebhook({ targetUrl, description = "Window Quotes completion events" }) {
      let url;
      try { url = new URL(targetUrl); } catch { throw new SuperagentTransportError("INVALID_WEBHOOK_TARGET", "contract validation"); }
      contract(url.protocol === "https:" && !url.username && !url.password, "INVALID_WEBHOOK_TARGET");
      contract(typeof description === "string", "INVALID_WEBHOOK_DESCRIPTION");
      // Returned signing secret is private, appears only once, and must be stored
      // by the caller in backend secrets. Never log this response or retry blindly.
      return request("POST", "/webhooks", { target_url: targetUrl, events: ["message.completed"], description, generate_secret: true }, "register webhook");
    },
    async sendMessage({ conversationId, correlation, content, fileUrls = [], additionalMessageParams = {} }) {
      identifier(conversationId, "CONVERSATION_ID");
      const dispatchContent = buildDispatchContent(correlation, content);
      contract(Array.isArray(fileUrls) && fileUrls.every(url => { try { return typeof url === "string" && new URL(url).protocol === "https:"; } catch { return false; } }), "INVALID_FILE_URLS");
      contract(additionalMessageParams && typeof additionalMessageParams === "object" && !Array.isArray(additionalMessageParams), "INVALID_ADDITIONAL_MESSAGE_PARAMS");
      const provider_response = await request("POST", "/conversations/" + encodeURIComponent(conversationId) + "/messages", { role: "user", content: dispatchContent, file_urls: fileUrls, additional_message_params: additionalMessageParams }, "send message", true);
      // A successful send acknowledgment is not a validated quote result.
      return { accepted: true, conversation_id: conversationId, dispatch_marker: makeDispatchMarker(correlation), provider_response };
    },
    async reconcileDispatch({ conversationId, correlation }) {
      const conversation = await transport.getConversation(conversationId);
      return { ...findDispatchedMessage(conversation, correlation), conversation };
    },
    async resolveWebhook({ rawBody, headers, webhookSecret, conversationId, correlation, validateResult }) {
      const event = await authenticateWebhook({ rawBody, headers, secret: webhookSecret, agentId, cryptoImpl });
      contract(event.conversation_id === conversationId, "WEBHOOK_CONVERSATION_MISMATCH");
      const conversation = await transport.getConversation(conversationId);
      const message = authoritativeMessage(conversation, event, normalizedCorrelation(correlation), conversationId);
      return { event, message, outcome: matchAgentEnvelope(message.content, { correlation, validateResult }) };
    }
  };
  return Object.freeze(transport);
}

