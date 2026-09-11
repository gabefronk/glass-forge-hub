import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createTransferredEngineHandler } from '../../shared/amscoTransferredHandler.js';

// Source engine v3: PK358/PK361 source rules, current finish and tempered controls; 525 combined checks pass.
// Read-only calculation endpoint; live quote promotion waits for full configuration validation.
export default createTransferredEngineHandler({
  getUser: async (request: Request) => createClientFromRequest(request).auth.me()
});
// Pricing worker recovery 2026-09-11: refresh published function resource after missing-worker response.

// Pricing v2: reviewed large Studio Picture glass, compatible receipts, and specialist price feedback.
