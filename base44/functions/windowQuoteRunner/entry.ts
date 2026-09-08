import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v5: verified native defaults and reviewed retry isolation.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });