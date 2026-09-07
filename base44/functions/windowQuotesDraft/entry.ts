import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";

const handleQuote = createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });

// The takeoff MCP tool saves drafts; only an explicit later action starts quoting.
export default async function windowQuotesDraft(req) {
  const reject = (status, error) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (req.method !== "POST") return reject(405, "Use POST");
  const bodyText = await req.text();
  if (bodyText.length > 600000) return reject(413, "Request is too large");
  let body;
  try { body = JSON.parse(bodyText); } catch { return reject(400, "Invalid JSON"); }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.action !== "create") {
    return reject(400, "This tool only accepts the create action");
  }
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return handleQuote(new Request(req, {
    headers,
    body: JSON.stringify({ ...body, action: "create", auto_start: false }),
  }));
}
// Dispatch v6: guarded saved-checkpoint continuations, default off; explicit result dimensions.


