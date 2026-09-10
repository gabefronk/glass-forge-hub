import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createTransferredEngineHandler } from '../../shared/amscoTransferredHandler.js';

// Source engine v2: versioned PK358/PK361 rules; 19 passing checks including current WW/BW/BB price comparisons.
// Read-only calculation endpoint; live quote promotion waits for full configuration validation.
export default createTransferredEngineHandler({
  getUser: async (request: Request) => createClientFromRequest(request).auth.me()
});
