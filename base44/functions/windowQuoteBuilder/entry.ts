import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createWindowQuoteBuilderHandler } from '../../shared/windowQuoteBuilder.js';
import { conversationalIntake, quoteAssistantStatus } from '../../shared/windowQuoteScriptedRuntime.js';
// Builder v18: return resolved construction with live prices for automatic specification labels; source receipts remain unchanged.
export default createWindowQuoteBuilderHandler({ getClient: createClientFromRequest, normalizeAI: conversationalIntake, assistantStatus: quoteAssistantStatus });
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
// Pricing worker recovery 2026-09-11: refresh published function resource after missing-worker response.
