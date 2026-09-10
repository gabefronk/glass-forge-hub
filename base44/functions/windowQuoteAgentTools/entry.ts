import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createAgentToolHandler } from "../../shared/windowQuoteAgentService.js";
import { execution } from "../../shared/windowQuoteAgentRuntime.js";
// Scoped Base44 operation capabilities; never accepts legacy worker keys.
export default createAgentToolHandler({ getClient: createClientFromRequest, execution });

// Dispatch v5: dedicated channel and concise complete clarification questions.
// Dispatch v6: guarded saved-checkpoint continuations, default off; explicit result dimensions.
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
// Source pricing release 2026-09-10: validate recomputed pricebook receipts in mixed configuration packages.
