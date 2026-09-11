import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createImportHandler, importRuntime } from "../../shared/amscoQuoteImportService.js";
export default createImportHandler({getClient:createClientFromRequest,service:importRuntime(),agent:true});
