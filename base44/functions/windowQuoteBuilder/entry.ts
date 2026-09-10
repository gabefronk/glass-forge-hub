import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createWindowQuoteBuilderHandler } from '../../shared/windowQuoteBuilder.js';
import { conversationalIntake } from '../../shared/windowQuoteScriptedRuntime.js';
// Builder v17: return resolved construction with live prices for automatic specification labels; source receipts remain unchanged.
export default createWindowQuoteBuilderHandler({ getClient: createClientFromRequest, normalizeAI: conversationalIntake });
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
