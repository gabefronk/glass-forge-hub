import { createClientFromRequest } from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import { createTrackerAppendHandler } from "../../shared/salesTrackerAppendService.js";
// Append-only import v1: shared parser and immutable batch storage.
Deno.serve(createTrackerAppendHandler({getClient:createClientFromRequest,XLSX}));
