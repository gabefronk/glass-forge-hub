// STAGED ONLY: copy to base44/shared after the native proof and review.
import { createLazyScriptedRuntime } from './lazyScriptedRuntime.js';
import { buildQuotePlan, verifyObservedQuote } from './amscoQuotePlan.js';
import { normalizeEasyRequest } from './easyRequest.js';

// Private configuration is fetched once for each request, with no new env secret.
const runtime = createLazyScriptedRuntime({ normalizeRequest: buildQuotePlan, normalizeIntake: normalizeEasyRequest, validateReady: verifyObservedQuote });
export const execution = runtime.execution;
export const getExecution = runtime.getExecution;
