import { createClientFromRequest } from "npm:@base44/sdk";
import { createAgentCenterHandler } from "../../shared/agentCenter.js";
// Register inactive ProBuild iPad Capture design; device and email execution remain disabled.
Deno.serve(createAgentCenterHandler({getClient:createClientFromRequest}));
