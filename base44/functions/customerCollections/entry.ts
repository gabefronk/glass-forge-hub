import { createClientFromRequest } from 'npm:@base44/sdk@0.8.53';
import { handle } from '../../shared/customerCollectionsHandle.js';
export default async function(req) {
  const client=createClientFromRequest(req),db=client.asServiceRole.entities;
  const a={authMe:()=>client.auth.me(),now:()=>new Date().toISOString(),
    linesList:o=>db.FeeLines.list(o),notesList:o=>db.JobNotes.list(o),jobsList:o=>db.Jobs.list(o),
    lineGet:id=>db.FeeLines.get(id),jobGet:id=>db.Jobs.get(id),
    notesFilter:(q,o)=>db.JobNotes.filter(q,o),linesFilter:(q,o)=>db.FeeLines.filter(q,o),
    closedList:o=>db.MonthCloseSnapshot.list(o),lineUpdate:(id,p)=>db.FeeLines.update(id,p)};
  const {status,body}=await handle(req,a);
  return Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
}
