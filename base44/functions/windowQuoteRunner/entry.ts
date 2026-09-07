import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v2: verify the shared mixed-product plan contract.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });