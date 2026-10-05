import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createProcurementHandler } from '../../shared/procurementService.mjs';

// Owner-authorized job and shop purchasing; shop POs do not create jobs.
// No sending, banking, calendar mutation, invoice creation or automatic order placement.
export default createProcurementHandler(createClientFromRequest);
