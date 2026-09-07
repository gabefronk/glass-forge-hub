import { createLazyScriptedRuntime } from './lazyScriptedRuntime.js';
import { buildQuotePlan, verifyObservedQuote } from './amscoQuotePlan.js';
import { normalizeConversationalSchedule } from './structuredQuoteIntake.js';
import { createConversationalIntake } from './conversationalIntake.js';

// AI interprets the customer's words. The checked planner still owns product
// support and execution; no model-generated price or status can bypass it.
const normalizeIntake = createConversationalIntake({
  invokeLLM: (params, { client }) => client.integrations.Core.InvokeLLM(params),
  normalizeStructured: normalizeConversationalSchedule
});
// Private configuration is fetched once for each request, with no new env secret.
const runtime = createLazyScriptedRuntime({ normalizeRequest: buildQuotePlan, normalizeIntake, validateReady: verifyObservedQuote });
export const execution = runtime.execution;
export const getExecution = runtime.getExecution;
