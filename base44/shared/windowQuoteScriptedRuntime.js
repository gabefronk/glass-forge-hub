// STAGED ONLY: copy to base44/shared after the native proof and review.
import { createLazyScriptedRuntime } from './lazyScriptedRuntime.js';
import { buildQuotePlan, verifyObservedQuote } from './amscoQuotePlan.js';

// Private configuration is fetched once for each request, with no new env secret.
const runtime = createLazyScriptedRuntime({ normalizeRequest: buildQuotePlan, validateReady: verifyObservedQuote });
export const execution = runtime.execution;
export const getExecution = runtime.getExecution;
