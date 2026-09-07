import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Staged deterministic intake only. Existing admin auth and retired worker actions remain.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });

