// Supplier order email from a PO (owner only): prepare the draft, then send it or save it as
// an Outlook draft through the app's Outlook connector. Logic and tests live in
// base44/shared/orderEmail.mjs (tests/orderEmail.test.mjs).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { createOrderEmailHandler } from '../../shared/orderEmail.mjs';

export default createOrderEmailHandler({ getClient: createClientFromRequest });
