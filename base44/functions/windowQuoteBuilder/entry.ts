import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createWindowQuoteBuilderHandler } from '../../shared/windowQuoteBuilder.js';
import { conversationalIntake } from '../../shared/windowQuoteScriptedRuntime.js';
// Builder v16: live PK361 standard pricebook calculations and AMSCO workspace; source receipts recomputed before saving.
export default createWindowQuoteBuilderHandler({ getClient: createClientFromRequest, normalizeAI: conversationalIntake });
// Package pricing release 2026-09-10: retained native prices, private online fallback, resumable progress.
