import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createProcurementHandler } from '../../shared/procurementService.mjs';

// Owner-authorized, job-scoped budgets, purchasing and estimate/invoice bridge.
// No sending, banking, calendar mutation, invoice creation or automatic order placement.
export default createProcurementHandler(createClientFromRequest);
