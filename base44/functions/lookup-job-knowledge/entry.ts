import {createClientFromRequest} from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import {parseTracker} from "./parser.js";
import {lookup} from "./job-engine.js";
let cache={key:"",rows:[]};
async function all(entity){const rows=[];for(let skip=0;skip<50000;skip+=1000){const page=await entity.list("-created_date",1000,skip);rows.push(...page);if(page.length<1000)return rows;}throw Error("Source pagination limit reached");}
const today=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Denver",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const addDays=(s,n)=>{const d=new Date(s+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const status=s=>s?{available:true,captured_at:s.captured_at,range_start:s.range_start,range_end:s.range_end,stale:Date.now()-new Date(s.captured_at).getTime()>26*3600000}:{available:false};
Deno.serve(async req=>{
 const client=createClientFromRequest(req),user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin")return Response.json({error:"Administrator access required."},{status:403});
 try{
  const q=await req.json().catch(()=>({}));
  for(const k of ["builder","subdivision","lot","oe","po"])if(q[k]!==undefined&&(typeof q[k]!=="string"||q[k].length>120))return Response.json({error:"Invalid job lookup field."},{status:400});
  const start=q.start_date||today(),end=q.end_date||addDays(start,13);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start||end>addDays(start,31))return Response.json({error:"Choose a valid date range of no more than 32 days."},{status:400});
  const api=client.asServiceRole;
  const [ts,oi,sb,calendar,reports]=await Promise.all([
   api.entities.SalesTrackerSnapshot.filter({status:"validated"},"-source_captured_at",1),
   api.entities.OutlookCalendarSnapshot.filter({calendar_name:"UT Window Install",complete:true},"-captured_at",1),
   api.entities.OutlookCalendarBatch.filter({calendar_name:"UT DC Service",complete:true},"-captured_at",1),
   all(api.entities.CalendarEvents),all(api.entities.FieldReports)]);
  const tracker=ts[0],installs=oi[0],batch=sb[0];
  if(!tracker)return Response.json({error:"A validated Sales Tracker is required."},{status:409});
  const key=tracker.id+":"+tracker.sha256;
  if(cache.key!==key){
   const signed=await api.integrations.Core.CreateFileSignedUrl({file_uri:tracker.file_uri,expires_in:300});
   const response=await fetch(signed.signed_url);if(!response.ok)throw Error("Tracker download failed");
   const bytes=new Uint8Array(await response.arrayBuffer());
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
   if(sha!==tracker.sha256)throw Error("Tracker integrity mismatch");
   cache={key,rows:parseTracker(XLSX,bytes).rows};
  }
  let service=[];
  if(batch){
   if(!Array.isArray(batch.snapshot_ids)||batch.snapshot_ids.length>50||new Set(batch.snapshot_ids).size!==batch.snapshot_ids.length)throw Error("Invalid service manifest");
   const parts=await Promise.all(batch.snapshot_ids.map(id=>api.entities.OutlookCalendarSnapshot.get(id)));
   if(parts.some(p=>p.calendar_name!==batch.calendar_name||p.captured_at!==batch.captured_at||p.range_start!==batch.range_start||p.range_end!==batch.range_end||p.events.length!==p.event_count))throw Error("Service part mismatch");
   service=parts.flatMap(p=>p.events);if(service.length!==batch.event_count)throw Error("Service count mismatch");
  }
  return Response.json(lookup({query:q,rows:cache.rows,calendar,outlook:installs?.events||[],service,reports,start,end,source_status:{tracker:{available:true,captured_at:tracker.source_captured_at,stale:Date.now()-new Date(tracker.source_captured_at).getTime()>26*3600000},outlook_installs:status(installs),outlook_service:status(batch),israel_and_app:{available:true,records_loaded:calendar.length,freshness_verified:false},probuild:{available:true,records_loaded:reports.length,freshness_verified:false}}}));
 }catch{return Response.json({error:"The combined lookup could not complete. No records or messages were changed."},{status:500});}
});
