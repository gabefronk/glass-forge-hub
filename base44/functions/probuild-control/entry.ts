import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {getProbuildIdToken} from '../../shared/probuildApi.ts';
import {createProbuildControlHandler} from '../../shared/probuildControl.js';
// Revision 3: photo reports, original attachments, project edits, private message sources.
Deno.serve(createProbuildControlHandler({getClient:createClientFromRequest,getToken:getProbuildIdToken}));
