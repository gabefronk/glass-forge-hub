const LEASE_MS = 10 * 60 * 1000;
const USER_ACTIONS = new Set(["list", "detail", "create", "message", "update", "queue", "convert_won"]);
const WORKER_ACTIONS = new Set(["worker_poll", "worker_update", "worker_heartbeat"]);
const TERMINAL = new Set(["needs_details", "needs_sign_in", "failed", "ready"]);
const PRODUCT_SETTINGS = new Set(["color", "glass", "series", "altitude", "screen", "spacer", "tempered", "options", "finish", "grid", "hardware"]);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const copy = (v) => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const textValue = (v, name, max = 4000, required = false) => {
  if (v === undefined || v === null) { if (required) fail(400, name + " is required"); return ""; }
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) fail(400, "Invalid " + name);
  return v.trim();
};
const object = (v, name) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) fail(400, "Invalid " + name);
  return v;
};
function jsonValue(v, name, max = 150000) {
  const raw = JSON.stringify(v);
  if (!raw || raw.length > max) fail(400, name + " is too large");
  const parsed = JSON.parse(raw);
  const walk = (x, depth = 0) => {
    if (depth > 12) fail(400, name + " is too deeply nested");
    if (x && typeof x === "object") for (const [key, value] of Object.entries(x)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail(400, "Invalid " + name + " key");
      walk(value, depth + 1);
    }
  };
  walk(parsed);
  return parsed;
}
export function validateSettings(value = {}, required = false) {
  const settings = jsonValue(object(value, "settings"), "settings", 12000);
  for (const key of ["dealer", "gross_margin"]) if (settings[key] === null || settings[key] === "") delete settings[key];
  if (own(settings, "dealer") && !["BFS", "BTB"].includes(settings.dealer)) fail(400, "Choose BFS or BTB");
  if (own(settings, "yard")) settings.yard = textValue(settings.yard, "yard", 200);
  if (own(settings, "gross_margin") && (typeof settings.gross_margin !== "number" || !Number.isFinite(settings.gross_margin) || settings.gross_margin < 0 || settings.gross_margin >= 100)) fail(400, "Gross margin must be a number from 0 to less than 100");
  if (required && (!settings.dealer || !settings.yard || !own(settings, "gross_margin"))) fail(400, "Select dealer, yard and an explicit gross margin before queueing");
  return settings;
}
export function validateLines(value = []) {
  if (!Array.isArray(value) || value.length > 300) fail(400, "Use at most 300 window lines");
  return value.map((raw, i) => {
    const line = jsonValue(object(raw, "line"), "line", 16000);
    for (const k of ["width", "height"]) if (own(line, k) && line[k] !== null && line[k] !== "") {
      if (typeof line[k] !== "number" || !Number.isFinite(line[k]) || line[k] <= 0 || line[k] > 1000) fail(400, "Line " + (i + 1) + " has an invalid " + k);
    }
    if (own(line, "qty") && (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 1000)) fail(400, "Line " + (i + 1) + " has an invalid quantity");
    if (own(line, "units") && line.units !== "in") fail(400, "Window dimensions must be in inches");
    if (own(line, "dimension_basis") && !["call", "frame", "rough_opening"].includes(line.dimension_basis)) fail(400, "Invalid dimension basis");
    for (const k of ["id", "mark", "style", "room"]) if (own(line, k)) line[k] = textValue(line[k], k, 500);
    if (own(line, "options")) jsonValue(line.options, "line options", 12000);
    return line;
  });
}
export function validateResult(raw) {
  const result = jsonValue(object(raw, "result"), "result", 400000);
  if (result.verified !== true) fail(400, "A ready quote requires verified AMSCO results");
  result.native_quote_id = textValue(result.native_quote_id, "AMSCO quote ID", 100, true);
  result.native_quote_number = textValue(String(result.native_quote_number ?? ""), "AMSCO quote number", 100, true);
  const address = textValue(result.native_quote_url, "AMSCO quote URL", 1500, true);
  let url;
  try { url = new URL(address); } catch { fail(400, "Invalid AMSCO quote URL"); }
  if (url.protocol !== "https:" || url.hostname !== "amsco.wtsparadigm.com" || url.username || url.password || !/^\/quotes\//i.test(url.pathname) || !url.pathname.toLowerCase().includes(result.native_quote_id.toLowerCase())) fail(400, "Use the real AMSCO quote link with its matching quote ID");
  if (!Array.isArray(result.lines) || !result.lines.length) fail(400, "A verified result requires the actual quoted lines");
  object(result.totals, "result totals");
  const total = result.totals.customer_total ?? result.totals.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) fail(400, "A verified result requires the actual customer total");
  for (const [key, value] of Object.entries(result.totals)) {
    if (key === "currency") { if (value !== "USD") fail(400, "Only USD is supported"); continue; }
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) fail(400, "Invalid quoted total");
  }
  result.totals.total ??= total;
  result.totals.customer_total ??= total;
  result.totals.currency ??= "USD";
  return result;
}
function publicQuote(quote) {
  if (!quote) return null;
  const safe = copy(quote);
  for (const k of ["lease_token", "conversion_token", "conversion_expires_at", "last_worker_event_id", "conversation"]) delete safe[k];
  return safe;
}
function publicMessage(m, quoteId) {
  return { id: m.id || m.client_message_id, quote_id: quoteId, role: m.role, content: m.content, client_message_id: m.client_message_id, revision: m.revision, created_date: m.message_at };
}
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
}
export function createQuoteHandler({ getClient, now = () => new Date(), uuid = () => crypto.randomUUID() }) {
  return async function handle(req) {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store" };
    try {
      if (req.method !== "POST") fail(405, "Use POST");
      const bodyText = await req.text();
      if (bodyText.length > 600000) fail(413, "Request is too large");
      let body;
      try { body = JSON.parse(bodyText); } catch { fail(400, "Invalid JSON"); }
      object(body, "request");
      const action = body.action;
      if (!USER_ACTIONS.has(action) && !WORKER_ACTIONS.has(action)) fail(400, "Unknown action");
      const client = await getClient(req);
      const db = client.asServiceRole.entities;
      const at = () => now().toISOString();
      const expiry = () => new Date(now().getTime() + LEASE_MS).toISOString();
      let user, worker;
      if (WORKER_ACTIONS.has(action)) {
        const key = req.headers.get("X-Quote-Worker-Key") || "";
        if (key.length < 24 || key.length > 256) fail(401, "Worker authentication required");
        const found = await db.QuoteWorkers.filter({ token_hash: await sha256(key), enabled: true }, undefined, 2);
        if (found.length !== 1) fail(401, "Worker authentication failed");
        worker = found[0];
      } else {
        try { user = await client.auth.me(); } catch { fail(401, "Sign in required"); }
        if (!user) fail(401, "Sign in required");
        if (user.role !== "admin") fail(403, "Window Quotes is currently available to administrators");
      }
      const getQuote = async id => {
        id = textValue(id, "quote_id", 150, true);
        const rows = await db.QuoteRequests.filter({ id }, undefined, 1);
        if (!rows.length) fail(404, "Quote request not found");
        return rows[0];
      };
      const cas = async (q, patch, extra = {}) => {
        const version = q.state_version || 0;
        const result = await db.QuoteRequests.updateMany({ id: q.id, state_version: version, ...extra }, { $set: { ...patch, state_version: version + 1 } });
        if (result.updated !== 1) fail(409, "The quote changed. Refresh and try again");
        return { ...q, ...patch, state_version: version + 1 };
      };
      const editable = q => {
        if (["queued", "running"].includes(q.worker_status)) fail(409, "Wait for the current quote run before changing its inputs");
        if (q.conversion_token && q.conversion_expires_at > at()) fail(409, "The accepted quote is being linked to its job");
      };
      const history = (q, reason) => [...(q.history || []), { revision: q.input_revision, recorded_at: at(), reason, settings: copy(q.settings), lines: copy(q.lines), result: copy(q.result), worker_status: q.worker_status }];
      const ensureMessage = async (q, message) => {
        // The embedded conversation is the atomic source of truth; this entity is a searchable projection.
        try {
          const existing = await db.QuoteMessages.filter({ quote_id: q.id, client_message_id: message.client_message_id }, undefined, 1);
          if (!existing.length) await db.QuoteMessages.create({ quote_id: q.id, ...message });
        } catch { /* A retry/detail still has the canonical conversation; never lose the accepted input. */ }
      };
      const makeMessage = (content, role, revision, messageId, author) => ({ role, content: textValue(content, "message", 18000, true), revision, client_message_id: textValue(messageId, "client_message_id", 150, true), message_at: at(), author });
      const canonical = async q => {
        const matches = await db.QuoteRequests.filter({ request_id: q.request_id, requester_email: q.requester_email }, "created_date", 20);
        matches.sort((a, b) => (a.created_date || "").localeCompare(b.created_date || "") || a.id.localeCompare(b.id));
        return matches[0] || q;
      };
      const releaseWorker = async (token) => {
        await db.QuoteWorkers.updateMany({ id: worker.id, busy_token: token }, { $set: { busy_token: "", busy_until: "", active_quote_id: "", last_seen_at: at() } });
      };
      const checkedLease = async q => {
        if (q.worker_id !== worker.id || q.worker_status !== "running" || q.lease_token !== body.lease_token || !q.lease_token || q.lease_expires_at <= at() || q.lease_revision !== q.input_revision) fail(409, "Worker lease expired or changed; stop this run");
        if (!(worker.allowed_dealers || []).includes(q.settings?.dealer)) fail(403, "Worker is not paired for this dealer");
        if (own(body, "input_revision") && body.input_revision !== q.lease_revision) fail(409, "Input revision changed; stop this run");
      };
      let output;
      if (action === "list") {
        const quotes = await db.QuoteRequests.list("-updated_date", 200);
        const workers = await db.QuoteWorkers.filter({ enabled: true }, "-last_seen_at", 1, 0, ["name", "last_seen_at"]);
        const current = workers[0];
        output = { quotes: quotes.map(publicQuote), worker: { online: !!current?.last_seen_at && now().getTime() - Date.parse(current.last_seen_at) < 100000, last_seen_at: current?.last_seen_at || null, name: current?.name || null } };
      } else if (action === "detail") {
        const q = await getQuote(body.quote_id);
        output = { quote: publicQuote(q), messages: (q.conversation || []).map(m => publicMessage(m, q.id)) };
      } else if (action === "create") {
        const requestId = textValue(body.request_id, "request_id", 150, true);
        const requester = textValue(user.email || user.id, "requester", 320, true);
        const existing = await db.QuoteRequests.filter({ request_id: requestId, requester_email: requester }, "created_date", 1);
        if (existing.length) output = { quote: publicQuote(existing[0]) };
        else {
          const settings = validateSettings(body.settings || {});
          const lines = validateLines(body.lines || []);
          const initial = body.message?.trim() ? makeMessage(body.message, "user", 1, requestId + ":initial", requester) : null;
          const q = await db.QuoteRequests.create({
            request_id: requestId, title: textValue(body.title, "title", 200) || "Window quote",
            requester_email: requester, settings, lines, source: body.source ? jsonValue(object(body.source, "source"), "source", 150000) : {},
            input_revision: 1, state_version: 0, worker_status: "draft", sales_status: "open",
            missing_details: [], history: [], conversation: initial ? [initial] : [],
            job_id: "", accepted_revision: 0, lease_token: "", conversion_token: ""
          });
          const selected = await canonical(q);
          if (initial && selected.id === q.id) await ensureMessage(q, initial);
          output = { quote: publicQuote(selected) };
        }
      } else if (action === "message") {
        let q = await getQuote(body.quote_id);
        const clientId = textValue(body.client_message_id, "client_message_id", 150, true);
        const existing = (q.conversation || []).find(m => m.client_message_id === clientId);
        if (existing) {
          if (existing.content !== textValue(body.message, "message", 18000, true)) fail(409, "Message identifier is already used");
          await ensureMessage(q, existing);
          output = { quote: publicQuote(q), message: publicMessage(existing, q.id) };
        } else {
          editable(q);
          const msg = makeMessage(body.message, "user", q.input_revision + 1, clientId, user.email || user.id);
          q = await cas(q, { input_revision: q.input_revision + 1, worker_status: "draft", conversation: [...(q.conversation || []), msg], history: history(q, "message"), missing_details: [] });
          await ensureMessage(q, msg);
          output = { quote: publicQuote(q), message: publicMessage(msg, q.id) };
        }
      } else if (action === "update") {
        let q = await getQuote(body.quote_id);
        editable(q);
        const patch = { input_revision: q.input_revision + 1, worker_status: "draft", history: history(q, "edited"), missing_details: [] };
        if (own(body, "title")) patch.title = textValue(body.title, "title", 200, true);
        if (own(body, "settings")) patch.settings = validateSettings(body.settings);
        if (own(body, "lines")) patch.lines = validateLines(body.lines);
        if (own(body, "source")) patch.source = jsonValue(object(body.source, "source"), "source", 150000);
        if (!["title", "settings", "lines", "source"].some(k => own(body, k))) fail(400, "No changes supplied");
        q = await cas(q, patch);
        output = { quote: publicQuote(q) };
      } else if (action === "queue") {
        let q = await getQuote(body.quote_id);
        if (["queued", "running"].includes(q.worker_status)) output = { quote: publicQuote(q) };
        else {
          editable(q);
          if (q.worker_status === "ready") fail(409, "Edit the request before building another revision");
          validateSettings(q.settings, true);
          if (!(q.lines || []).length && !(q.conversation || []).some(m => m.role === "user") && !Object.keys(q.source || {}).length) fail(400, "Add a message or window schedule first");
          const selected = await canonical(q);
          if (selected.id !== q.id) fail(409, "This request already exists as " + selected.id);
          q = await cas(q, { worker_status: "queued", queued_at: at(), lease_token: "", lease_expires_at: "", missing_details: [] });
          output = { quote: publicQuote(q) };
        }
      } else if (action === "worker_poll") {
        await db.QuoteWorkers.updateMany({ id: worker.id, enabled: true }, { $set: { last_seen_at: at() } });
        if (worker.busy_token && worker.busy_until > at()) output = { quote: null };
        else {
          const token = uuid(), until = expiry();
          const generation = worker.poll_generation || 0;
          const claim = await db.QuoteWorkers.updateMany({ id: worker.id, enabled: true, poll_generation: generation }, { $set: { poll_generation: generation + 1, busy_token: token, busy_until: until, active_quote_id: "", last_seen_at: at() } });
          if (claim.updated !== 1) output = { quote: null };
          else {
            const candidates = await db.QuoteRequests.filter({ "settings.dealer": { $in: worker.allowed_dealers || [] }, $or: [{ worker_status: "queued" }, { worker_status: "running", lease_expires_at: { $lte: at() } }] }, "queued_at", 20);
            let picked = null;
            for (const q of candidates) {
              try {
                validateSettings(q.settings, true);
                picked = await cas(q, { worker_status: "running", worker_id: worker.id, lease_token: token, lease_revision: q.input_revision, lease_expires_at: until, last_worker_event_id: "" });
                break;
              } catch (e) { if (!(e instanceof HttpError && e.status === 409)) { await releaseWorker(token); throw e; } }
            }
            if (!picked) { await releaseWorker(token); output = { quote: null }; }
            else {
              await db.QuoteWorkers.updateMany({ id: worker.id, busy_token: token }, { $set: { active_quote_id: picked.id } });
              output = { quote: { ...publicQuote(picked), lease_token: token, messages: (picked.conversation || []).map(m => publicMessage(m, picked.id)) } };
            }
          }
        }
      } else if (action === "worker_heartbeat") {
        if (body.quote_id) {
          const q = await getQuote(body.quote_id);
          await checkedLease(q);
          const until = expiry();
          const changed = await db.QuoteRequests.updateMany({ id: q.id, worker_id: worker.id, lease_token: q.lease_token, worker_status: "running", input_revision: q.lease_revision }, { $set: { lease_expires_at: until } });
          if (changed.updated !== 1) fail(409, "Worker lease changed; stop this run");
          await db.QuoteWorkers.updateMany({ id: worker.id, enabled: true, busy_token: q.lease_token }, { $set: { last_seen_at: at(), busy_until: until } });
        } else await db.QuoteWorkers.updateMany({ id: worker.id, enabled: true }, { $set: { last_seen_at: at() } });
        output = { ok: true, last_seen_at: at(), lease_seconds: LEASE_MS / 1000 };
      } else if (action === "worker_update") {
        let q = await getQuote(body.quote_id);
        const eventId = body.event_id ? textValue(body.event_id, "event_id", 150, true) : await sha256(JSON.stringify({ lease_token: body.lease_token, status: body.status, message: body.message, result: body.result, checkpoint: body.checkpoint, settings: body.settings, lines: body.lines, missing_details: body.missing_details }));
        if (q.worker_id === worker.id && q.last_worker_event_id === eventId) output = { quote: publicQuote(q) };
        else {
          await checkedLease(q);
          if (!["running", ...TERMINAL].includes(body.status)) fail(400, "Invalid worker status");
          const patch = { worker_status: body.status, last_worker_event_id: eventId };
          if (own(body, "settings")) {
            const updates = validateSettings(body.settings);
            for (const [key, value] of Object.entries(updates)) {
              if (["dealer", "yard", "gross_margin"].includes(key)) { if (value !== q.settings[key]) fail(400, "Only the administrator may change dealer, yard or gross margin"); }
              else if (!PRODUCT_SETTINGS.has(key)) fail(400, "Unsupported product setting: " + key);
            }
            patch.settings = { ...q.settings, ...updates };
          }
          if (own(body, "lines")) patch.lines = validateLines(body.lines);
          if (own(body, "checkpoint")) patch.checkpoint = jsonValue(object(body.checkpoint, "checkpoint"), "checkpoint", 120000);
          if (own(body, "missing_details")) {
            if (!Array.isArray(body.missing_details) || body.missing_details.length > 100) fail(400, "Invalid missing details");
            patch.missing_details = body.missing_details.map(x => textValue(x, "missing detail", 2000, true));
          }
          if (own(body, "result")) patch.result = body.status === "ready" ? validateResult(body.result) : jsonValue(object(body.result, "result"), "result", 400000);
          if (body.status === "ready") { if (!own(body, "result")) fail(400, "Ready requires a verified AMSCO result"); patch.missing_details = []; patch.history = history(q, "verified"); }
          let msg;
          if (body.message) {
            msg = makeMessage(body.message, "assistant", q.input_revision, "worker:" + eventId, worker.name || worker.id);
            patch.conversation = [...(q.conversation || []), msg];
          }
          if (TERMINAL.has(body.status)) { patch.lease_token = ""; patch.lease_expires_at = ""; }
          else patch.lease_expires_at = expiry();
          const lease = q.lease_token;
          q = await cas(q, patch, { worker_id: worker.id, lease_token: lease, worker_status: "running" });
          if (msg) await ensureMessage(q, msg);
          if (TERMINAL.has(body.status)) await releaseWorker(lease);
          else await db.QuoteWorkers.updateMany({ id: worker.id, busy_token: lease }, { $set: { last_seen_at: at(), busy_until: q.lease_expires_at } });
          output = { quote: publicQuote(q) };
        }
      } else if (action === "convert_won") {
        let q = await getQuote(body.quote_id);
        const linked = await db.Jobs.filter({ source_window_quote_id: q.id }, "created_date", 2);
        if (linked.length) {
          if (q.job_id !== linked[0].id) q = await cas(q, { job_id: linked[0].id, sales_status: "won", conversion_token: "", conversion_expires_at: "" });
          output = { quote: publicQuote(q), job: linked[0] };
        } else {
          if (q.conversion_token && q.conversion_expires_at > at()) fail(409, "The job conversion is already running; retry shortly");
          if (!q.accepted_snapshot) {
            if (q.worker_status !== "ready") fail(409, "Complete and verify the AMSCO quote before marking it won");
            validateResult(q.result);
          }
          const snapshot = q.accepted_snapshot || { quote_id: q.id, title: q.title, revision: q.input_revision, accepted_at: at(), settings: copy(q.settings), lines: copy(q.lines), result: copy(q.result), source: copy(q.source) };
          const token = uuid();
          q = await cas(q, { conversion_token: token, conversion_expires_at: expiry(), sales_status: "won", accepted_revision: q.accepted_revision || q.input_revision, accepted_snapshot: snapshot, accepted_at: q.accepted_at || at() });
          // Reconcile again while owning the conversion lease. A retry after an uncertain create reuses this job.
          const existing = await db.Jobs.filter({ source_window_quote_id: q.id }, "created_date", 2);
          const job = existing[0] || await db.Jobs.create({
            canonical_name: snapshot.title || q.title,
            customer_name: textValue(body.customer_name, "customer name", 300),
            address: textValue(body.address, "address", 1000),
            builder: textValue(body.builder, "builder", 300),
            aliases: [], po_numbers: [], oe_numbers: [],
            source_window_quote_id: q.id,
            accepted_quote_revision: q.accepted_revision,
            accepted_quote_snapshot: snapshot
          });
          q = await cas(q, { job_id: job.id, conversion_token: "", conversion_expires_at: "" }, { conversion_token: token });
          output = { quote: publicQuote(q), job };
        }
      }
      return new Response(JSON.stringify(output), { status: 200, headers });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      return new Response(JSON.stringify({ error: error instanceof HttpError ? error.message : "The quote service could not complete this request. Retry safely with the same request or message ID." }), { status, headers });
    }
  };
}
