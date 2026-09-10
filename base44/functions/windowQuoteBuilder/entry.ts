import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createWindowQuoteBuilderHandler } from '../../shared/windowQuoteBuilder.js';
import { conversationalIntake } from '../../shared/windowQuoteScriptedRuntime.js';
// Builder intake v15: source-engine comparison uses canonical UI glass labels; 525 checks pass.
export default createWindowQuoteBuilderHandler({ getClient: createClientFromRequest, normalizeAI: conversationalIntake });
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
