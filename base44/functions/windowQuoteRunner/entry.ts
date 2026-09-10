import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v7: verified warm desktop-native engine contract ce17adad + private native price previews.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });