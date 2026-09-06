import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";

// The handler separates private worker recovery from the concise, sanitized app conversation.
// Scoped worker authentication and administrator access are checked before either response.
export default createQuoteHandler({ getClient: createClientFromRequest });
