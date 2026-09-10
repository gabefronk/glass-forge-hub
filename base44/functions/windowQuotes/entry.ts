import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Intake v14: canonical operations with verified warm engine contract ce17adad + private native price previews and verified configuration package completion.
const handleWindowQuotes = createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });
export default handleWindowQuotes;
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
