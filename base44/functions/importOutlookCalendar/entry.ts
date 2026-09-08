import {createClientFromRequest} from "npm:@base44/sdk";
Deno.serve(async req => {
 try {
  const api=createClientFromRequest(req);
  const user=await api.auth.me().catch(()=>null);
  if(user?.role!=="admin") return Response.json({error:"Admin access required"},{status:403});
  const b=await req.json();
  const date=/^\d{4}-\d{2}-\d{2}$/;
  if(b.calendar_name!=="UT Window Install" || b.timezone!=="America/Denver") throw Error("Unsupported calendar or timezone");
  if(!date.test(b.range_start)||!date.test(b.range_end)||b.range_start>b.range_end) throw Error("Invalid inclusive date range");
  if(!Number.isFinite(Date.parse(b.captured_at))||Date.parse(b.captured_at)>Date.now()+300000) throw Error("Invalid capture time");
  if(typeof b.complete!=="boolean"||!Array.isArray(b.events)||b.events.length>1000) throw Error("Invalid collection");
  const events=b.events.map((e,i)=>{
   if(!date.test(e.event_date)||e.event_date<b.range_start||e.event_date>b.range_end||typeof e.job_name!=="string"||!e.job_name.trim()) throw Error("Invalid event at row "+(i+1));
   for(const k of ["start_time","end_time"]) if(e[k]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(e[k])) throw Error("Invalid event time");
   const clean={}; for(const k of ["event_date","job_name","start_time","end_time","end_date","address","scope_notes","oe_number","po_number","builder","subdivision","lot","source_event_id"]) if(e[k]!=null) clean[k]=String(e[k]);
   return clean;
  });
  if(JSON.stringify(events).length>100000) throw Error("Collection exceeds safe snapshot field size; split collection or use private file storage");
  const record=await api.entities.OutlookCalendarSnapshot.create({calendar_name:b.calendar_name,timezone:b.timezone,range_start:b.range_start,range_end:b.range_end,captured_at:b.captured_at,complete:b.complete,events,event_count:events.length,collection_notes:String(b.collection_notes||"")});
  return Response.json({id:record.id,event_count:events.length,complete:b.complete});
 } catch(e) {return Response.json({error:e.message},{status:400});}
});