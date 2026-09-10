import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createWindowQuoteBuilderHandler } from '../../shared/windowQuoteBuilder.js';
import { conversationalIntake } from '../../shared/windowQuoteScriptedRuntime.js';
// Builder intake v13: AMSCO configurator with verified warm engine contract ce17adad + private native price previews and verified configuration package completion.
export default createWindowQuoteBuilderHandler({ getClient: createClientFromRequest, normalizeAI: conversationalIntake });
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
