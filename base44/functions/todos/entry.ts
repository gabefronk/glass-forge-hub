import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import { createTodoHandler } from '../../shared/todoService.mjs';

// Owner check mirrors src/lib/agentCenterAccess.js (isAgentCenterOwner).
// Gabriel's two sign-ins are the only owner accounts: team views, assigning
// tasks to others, and member management. Everyone else sees only their own list.
const OWNER_EMAILS = new Set(["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"]);
const isOwner = (user) => user?.role === "admin" && OWNER_EMAILS.has(String(user?.email || "").trim().toLowerCase());

Deno.serve(createTodoHandler({ getClient: async (req) => createClientFromRequest(req), isOwner }));
