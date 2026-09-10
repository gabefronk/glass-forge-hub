import { createLazyScriptedRuntime } from './lazyScriptedRuntime.js';
import { buildQuotePlan, getProductProfileForLine } from './amscoQuotePlan.js';
import { verifyExecutionObservation } from './nativeEngineObservation.js';
import { normalizeConversationalSchedule } from './structuredQuoteIntake.js';
import { createConversationalIntake } from './conversationalIntake.js';
import { createBuilderAwareIntake } from './windowQuoteBuilder.js';
import { execution as onlineFallbackExecution, packageOnlineExecution } from './windowQuoteAgentRuntime.js';

// AI interprets the customer's words. The checked planner still owns product
// support and execution; no model-generated price or status can bypass it.
export async function invokeIntakeModel(params, { client }) {
  const invoke = input => client.asServiceRole.integrations.Core.InvokeLLM(input);
  try { return await invoke(params); }
  catch (error) {
    if ((error?.status || error?.response?.status) !== 400) throw error;
    // Some app model providers reject nested response schemas. The fallback
    // changes transport only: the identical strict server validator still runs.
    const { response_json_schema, ...request } = params;
    const result = await invoke({ ...request, prompt: request.prompt + '\nReturn only JSON matching this schema. Omit unknown optional fields. No Markdown.\n' + JSON.stringify(response_json_schema) });
    if (typeof result !== 'string') return result;
    return JSON.parse(result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  }
}
export const conversationalIntake = createConversationalIntake({
  invokeLLM: invokeIntakeModel,
  normalizeStructured: quote => normalizeConversationalSchedule(quote, { getProductProfileForLine })
});
const normalizeIntake = createBuilderAwareIntake(conversationalIntake);
// Private configuration is fetched once for each request, with no new env secret.
const runtime = createLazyScriptedRuntime({ normalizeRequest: buildQuotePlan, normalizeIntake, validateReady: verifyExecutionObservation, fallbackExecution: onlineFallbackExecution, packageOnlineExecution });
export const execution = runtime.execution;
export const getExecution = runtime.getExecution;
