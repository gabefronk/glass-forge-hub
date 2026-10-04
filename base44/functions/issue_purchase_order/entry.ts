import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createProcurementHandler } from '../../shared/procurementService.mjs';

// Preserve the established function name. New and legacy entry points share the same
// owner review, request-key, source snapshot and serialized PO sequence safeguards.
export default createProcurementHandler(createClientFromRequest, 'issue_po');
