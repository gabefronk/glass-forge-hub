import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createAgentWebhookHandler } from "../../shared/windowQuoteAgentWebhook.js";
import { execution, transport } from "../../shared/windowQuoteAgentRuntime.js";
// Authenticate raw-body HMAC and refetch exact provider messages before result handling.
export default createAgentWebhookHandler({ getClient: createClientFromRequest, execution, transport, secret: Deno.env.get("WINDOW_QUOTES_SUPERAGENT_WEBHOOK_SECRET") });

// Dispatch v4: shared execution channel with current-operation validation.
// Dispatch v6: guarded saved-checkpoint continuations, default off; explicit result dimensions.
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
// Source pricing release 2026-09-10: validate recomputed pricebook receipts in mixed configuration packages.
