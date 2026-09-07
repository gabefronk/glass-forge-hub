import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated outbound-runner transport; authentication is the new scoped worker key.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });
