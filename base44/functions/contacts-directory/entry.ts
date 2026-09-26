import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {createContactsDirectoryHandler} from '../../shared/contactsDirectory.js';
Deno.serve(createContactsDirectoryHandler({getClient:createClientFromRequest}));

// Revision: builder-normalized contacts, owner cleanup (merge / builder / role), homeowner slot, SPR supers (2026-09-26).
