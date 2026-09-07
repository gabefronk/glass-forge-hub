import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v4: verify the standard regular-picture family and saved prices.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });