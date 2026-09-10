import { createClientFromRequest } from "npm:@base44/sdk";
import { createAgentCenterHandler } from "../../shared/agentCenter.js";
Deno.serve(createAgentCenterHandler({getClient:createClientFromRequest}));
