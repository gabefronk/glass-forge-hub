import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v2: verify mixed products against the shared contract.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });