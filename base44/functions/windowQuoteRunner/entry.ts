import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createScriptedRunnerHandler } from "../../shared/scriptedRunnerHandler.js";
import { getExecution } from "../../shared/windowQuoteScriptedRuntime.js";
// Dedicated runner transport v7: verified warm desktop-native engine contract ce17adad + private native price previews and verified configuration package completion.
export default createScriptedRunnerHandler({ getClient: createClientFromRequest, getExecution });
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
