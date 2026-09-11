import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createImportHandler, importRuntime } from "../../shared/amscoQuoteImportService.js";
// Saved quote lookup and import, read-only in AMSCO.
export default createImportHandler({getClient:createClientFromRequest,service:importRuntime()});
