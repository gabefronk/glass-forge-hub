import { createClientFromRequest } from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import { createTrackerAppendHandler } from "../../shared/salesTrackerAppendService.js";
Deno.serve(createTrackerAppendHandler({getClient:createClientFromRequest,XLSX}));
