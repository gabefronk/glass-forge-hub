import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";

// The scoped worker key is verified inside the handler; app actions always require an administrator.
export default createQuoteHandler({ getClient: createClientFromRequest });
