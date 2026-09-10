import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createTransferredEngineHandler } from '../../shared/amscoTransferredHandler.js';

// Source engine v1: versioned PK358/PK361 rate data and independently tested rules.
// Read-only calculation endpoint; live quote promotion waits for full configuration validation.
export default createTransferredEngineHandler({
  getUser: async (request: Request) => createClientFromRequest(request).auth.me()
});
