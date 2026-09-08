import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v6: verified desktop-native persistence and online fallback.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });