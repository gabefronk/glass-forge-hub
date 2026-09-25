import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {createJobDocumentsHandler} from '../../shared/jobDocuments.mjs';
Deno.serve(createJobDocumentsHandler({getClient:createClientFromRequest}));
