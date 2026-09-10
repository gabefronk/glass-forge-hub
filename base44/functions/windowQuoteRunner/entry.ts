import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v7: verified warm desktop-native engine contract fc3ed293.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });