import { createClientFromRequest } from "npm:@base44/sdk";
import { createMessagesBridgeHandler } from "../../shared/messagesBridge.js";
Deno.serve(createMessagesBridgeHandler({getClient:createClientFromRequest}));
