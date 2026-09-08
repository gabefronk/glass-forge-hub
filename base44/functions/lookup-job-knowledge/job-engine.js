import {norm, trackerMatches, reconcile} from "./calendar-engine.js";
const family=v=>norm(v).replace(/ [0-9]{2}$/,"");
const identity=r=>[norm(r.builder),norm(r.subdivision),norm(r.lot)].join("|");
const rowRef=r=>({source_sheet:r.source_sheet,source_row:r.source_row,date_cell:r.date_cell,builder:r.builder,subdivision:r.subdivision,lot:r.lot,oe:r.oe,po:r.po,arrival_date:r.arrival_date,order_date:r.order_date,notes:r.notes});
export function lookup({query,rows,calendar,outlook,service,reports,start,end,source_status}){
 const q=Object.fromEntries(["builder","subdivision","lot","oe","po"].map(k=>[k,String(query[k]||"").trim()]));
 const warnings=[];
 const base={generated_at:new Date().toISOString(),range_start:start,range_end:end,source_status,automatic_send_allowed:false};
 if(!(q.builder&&q.subdivision&&q.lot)&&!q.oe&&!q.po)return {...base,status:"needs_identity",question:"Which builder, community and lot, or order number is this for?",counts:{tracker_rows:0}};
 const found=rows.filter(r=>Object.entries(q).every(([k,v])=>!v||(k==="oe"?family(r[k])===family(v):norm(r[k])===norm(v))));
 if(!found.length)return {...base,status:"not_found",question:"No exact job match was found. Check the builder, community, lot or order number.",counts:{tracker_rows:0}};
 const identities=[...new Set(found.map(identity))];
 if(identities.length!==1)return {...base,status:"ambiguous",question:"This order matches multiple jobs or lots. Which lot do you mean?",candidates:[...new Map(found.map(r=>[identity(r),{builder:r.builder,subdivision:r.subdivision,lot:r.lot}])).values()].slice(0,15),counts:{tracker_rows:found.length,jobs:identities.length}};
 const result=reconcile({calendar,outlook,rows:found,reports,start,end});
 const svc=(service||[]).filter(e=>e.event_date>=start&&e.event_date<=end&&trackerMatches(e,found).length).map(e=>({...e,source:"Outlook service",kind:"service",tracker_rows:trackerMatches(e,found).map(rowRef)}));
 const directReports=reports.filter(r=>r.job_date>=start&&r.job_date<=end&&trackerMatches({job_name:r.job_name},found).length);
 const linkedReports=[...new Map([...result.events.flatMap(e=>e.reports),...directReports].map(r=>[r.post_id,r])).values()];
 for(const [key,s] of Object.entries(source_status)){
  if(s.available===false)warnings.push(key+" source is unavailable.");
  if(s.stale)warnings.push(key+" source is over 26 hours old.");
  if(s.range_start&&(s.range_start>start||s.range_end<end))warnings.push(key+" coverage is limited to "+s.range_start+" through "+s.range_end+".");
 }
 warnings.push(...new Set(result.events.flatMap(e=>e.warnings||[])));
 if(found.length>1)warnings.push("Multiple tracker line items exist for this lot; keep each order and date separate.");
 if(svc.length)warnings.push("Service visits are separate from installation and arrival dates.");
 warnings.push("A scheduled date or a stored field report does not establish completion. Customer identity and recipient must be checked before sending.");
 const job={builder:found[0].builder,subdivision:found[0].subdivision,lot:found[0].lot};
 const dates=[...new Set(found.map(r=>r.arrival_date).filter(Boolean))];
 const format=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?new Date(d+"T12:00:00Z").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric",timeZone:"UTC"}):d;
 const label=job.subdivision+" lot "+job.lot;
 let draft=dates.length===1?"I'm showing an estimated arrival of "+format(dates[0])+" for "+label+".":dates.length>1?"I'm seeing multiple order lines with different arrival dates for "+label+". I'll need to confirm which order you're asking about.":"I don't have a confirmed arrival estimate for "+label+" in the current tracker copy.";
 if(dates.length===1&&/^\d{4}-\d{2}-\d{2}$/.test(dates[0])&&dates[0]<start)draft="The tracker lists "+format(dates[0])+" as the estimated arrival for "+label+". That date has passed, so I need to verify the current status before confirming delivery.";
 const stale=Object.values(source_status).some(s=>s.stale);
 if(stale)draft+=" This is based on a saved copy that needs refreshing.";
 const brief=query.brief!==false,limit=brief?6:100;
 const compactEvent=e=>({source:e.source,source_occurrence_key:e.source_occurrence_key||e.id,event_date:e.event_date,start_time:e.start_time,end_time:e.end_time,job_name:e.job_name,kind:e.kind||"installation",sources:e.sources?.map(s=>({source:s.source,id:s.id})),oe_number:e.oe_number,po_number:e.po_number,source_start_date:e.source_start_date,source_end_date:e.source_end_date,scope_notes:brief?String(e.scope_notes||"").slice(0,180):e.scope_notes,notes_truncated:brief&&String(e.scope_notes||"").length>180});
 const counts={tracker_rows:found.length,installation_entries:result.events.length,service_entries:svc.length,report_entries:linkedReports.length,merged_install_duplicates:result.counts.merged_duplicates};
 return {...base,status:"matched",job,counts,warnings:[...new Set(warnings)],tracker_rows:found.slice(0,limit).map(r=>{const x=rowRef(r);if(brief){x.notes=String(x.notes||"").slice(0,160);}return x;}),installations:result.events.slice(0,limit).map(compactEvent),services:svc.slice(0,limit).map(compactEvent),reports:linkedReports.slice(0,limit).map(r=>({post_id:r.post_id,job_name:r.job_name,job_date:r.job_date,message:brief?String(r.message||"").slice(0,180):r.message,completion_inferred:false})),items_truncated:Object.values(counts).slice(0,4).some(n=>n>limit),draft_reply:draft,reply_status:"draft_needs_review",note:"Saved-source lookup; not a live Microsoft or ProBuild refresh. Full source notes remain in calendar detail views. No source records were changed and no message was sent."};
}
