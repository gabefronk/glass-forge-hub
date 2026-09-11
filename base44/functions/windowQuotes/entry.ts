import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Intake v15: complete source-priced windows immediately; retain per-window native and online fallback with verified mixed receipts.
const handleWindowQuotes = createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });
export default handleWindowQuotes;
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
// Pricing worker recovery 2026-09-11: refresh published function resource after missing-worker response.

// Pricing v2: reviewed large Studio Picture glass, compatible receipts, and specialist price feedback.
