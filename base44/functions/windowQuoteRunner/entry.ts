import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v3: verify regular-picture saved specifications and manufacturing details.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });