import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createWindowQuoteBuilderHandler } from '../../shared/windowQuoteBuilder.js';
import { conversationalIntake } from '../../shared/windowQuoteScriptedRuntime.js';
// Builder intake v12: AMSCO configurator, independent line prices and native/online routing.
export default createWindowQuoteBuilderHandler({ getClient: createClientFromRequest, normalizeAI: conversationalIntake });