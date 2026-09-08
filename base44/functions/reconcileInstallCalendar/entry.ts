import {createClientFromRequest} from "npm:@base44/sdk";
import * as XLSX from "npm:xlsx@0.18.5";
import {parseTracker} from "./parser.js";
import {reconcile} from "./engine.js";
async function all(entity){const rows=[];for(let skip=0;skip<50000;skip+=1000){const page=await entity.list("-created_date",1000,skip);rows.push(...page);if(page.length<1000)return rows;}throw Error("Source exceeds verified pagination limit.");}
Deno.serve(async req=>{
 const client=createClientFromRequest(req);
 const user=await client.auth.me().catch(()=>null);
 if(user?.role!=="admin")return Response.json({error:"Administrator access required."},{status:403});
 try{
  const query=await req.json().catch(()=>({}));
  const api=client.asServiceRole;
  const [trackers,imports,calendar,reports]=await Promise.all([
   api.entities.SalesTrackerSnapshot.filter({status:"validated"},"-source_captured_at",1),
   api.entities.OutlookCalendarSnapshot.filter({calendar_name:"UT Window Install",complete:true},"-captured_at",1),
   all(api.entities.CalendarEvents),all(api.entities.FieldReports)]);
  const tracker=trackers[0],snapshot=imports[0];
  if(!tracker||!snapshot)return Response.json({error:"A validated tracker and complete Outlook install import are required."},{status:409});
  const start=query.start_date||snapshot.range_start,end=query.end_date||snapshot.range_end;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||end<start||start<snapshot.range_start||end>snapshot.range_end) return Response.json({error:"Choose dates within the available Outlook coverage."},{status:400});
  const signed=await api.integrations.Core.CreateFileSignedUrl({file_uri:tracker.file_uri,expires_in:300});
  const response=await fetch(signed.signed_url);if(!response.ok)throw Error("Private tracker download failed.");
  const bytes=new Uint8Array(await response.arrayBuffer());
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(sha!==tracker.sha256)throw Error("Tracker integrity check failed.");
  const rows=parseTracker(XLSX,bytes).rows;
  const result=reconcile({calendar,outlook:snapshot.events,rows,reports,start,end});
  return Response.json({...result,range_start:start,range_end:end,generated_at:new Date().toISOString(),
   source_status:{tracker_captured_at:tracker.source_captured_at,outlook_captured_at:snapshot.captured_at,tracker_stale:Date.now()-new Date(tracker.source_captured_at).getTime()>26*3600000,outlook_stale:Date.now()-new Date(snapshot.captured_at).getTime()>26*3600000,probuild_reports_loaded:reports.length,calendar_events_loaded:calendar.length},
   note:"Read-only reconciliation. Tracker matches identify jobs present in Gabe's tracker, not independently verified account ownership. ProBuild reports are evidence, not automatic completion. Arrival estimates remain separate from installation dates. Unmatched items remain available for review."});
 }catch(e){return Response.json({error:"Calendar reconciliation could not complete. Existing sources were preserved."},{status:500});}
});