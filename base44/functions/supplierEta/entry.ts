import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { createSupplierEtaHandler } from '../../shared/supplierEtaService.mjs';
export default createSupplierEtaHandler(createClientFromRequest);
