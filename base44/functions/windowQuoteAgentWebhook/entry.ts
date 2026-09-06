import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createAgentWebhookHandler } from "../../shared/windowQuoteAgentWebhook.js";
import { execution, transport } from "../../shared/windowQuoteAgentRuntime.js";
// Authenticate raw-body HMAC and refetch exact provider messages before result handling.
export default createAgentWebhookHandler({ getClient: createClientFromRequest, execution, transport, secret: Deno.env.get("WINDOW_QUOTES_SUPERAGENT_WEBHOOK_SECRET") });
