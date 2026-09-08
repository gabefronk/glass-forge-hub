export const norm=v=>String(v??"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
const words=(hay,needle)=>!!norm(needle)&&(" "+norm(hay)+" ").includes(" "+norm(needle)+" ");
function lots(title){const s=String(title??"");const result=new Set(s.match(/\b\d+\b/g)||[]);for(const m of s.matchAll(/\b(\d+)\s*(?:-|through|to)\s*(\d+)\b/gi)){const a=+m[1],b=+m[2];if(b>=a&&b-a<=30)for(let x=a;x<=b;x++)result.add(String(x));}return result;}
const orders=e=>({oe:String(e.oe_number||"").trim(),po:String(e.po_number||"").trim()});
export function trackerMatches(e,rows){
 const title=e.job_name||"",ls=lots(title),o=orders(e);
 return rows.filter(r=>{
  const lot=String(r.lot??"").trim();const lotOK=lot&&(/^\d+$/.test(lot)?ls.has(lot):words(title,lot));
  const identity=words(title,r.builder)&&words(title,r.subdivision)&&lotOK;
  const family=v=>String(v||"").trim().replace(/-[0-9]{2}$/,"");
  const order=(o.oe&&family(o.oe)===family(r.oe))||(o.po&&o.po===String(r.po).trim());
  const conflict=(o.oe&&r.oe&&family(o.oe)!==family(r.oe))||(o.po&&r.po&&o.po!==String(r.po).trim());
  return !conflict&&((order&&lotOK)||identity);
 });
}
const rowRef=r=>({source_sheet:r.source_sheet,source_row:r.source_row,date_cell:r.date_cell,builder:r.builder,subdivision:r.subdivision,lot:r.lot,oe:r.oe,po:r.po,arrival_date:r.arrival_date,notes:r.notes});
function sameVisit(a,b){
 if(a.source===b.source||a.event_date!==b.event_date||a.start_time!==b.start_time||a.end_time!==b.end_time)return false;
 const ao=orders(a),bo=orders(b);
 if(["oe","po"].some(k=>ao[k]&&bo[k]&&ao[k]!==bo[k]))return false;
 const order=["oe","po"].some(k=>ao[k]&&ao[k]===bo[k]);
 const refs=a.tracker_rows.map(r=>r.source_row).sort().join(",");
 const sameRows=refs&&refs===b.tracker_rows.map(r=>r.source_row).sort().join(",");
 // Full identical job identity plus a common exact order; no fuzzy title-only merges.
 const sameEvidence=norm(a.scope_notes)&&norm(a.scope_notes)===norm(b.scope_notes)&&norm(a.address)&&norm(a.address)===norm(b.address);
 return !!((order||sameEvidence)&&sameRows&&norm(a.job_name)===norm(b.job_name));
}
export function reconcile({calendar,outlook,rows,reports,start,end}){
 const inRange=d=>d>=start&&d<=end;
 const source=[...calendar.filter(e=>inRange(e.event_date)).map(e=>({...e,source:e.source==="google"?"Israel calendar":"App calendar"})),...(outlook||[]).filter(e=>inRange(e.event_date)).map((e,i)=>({...e,id:e.source_occurrence_key||"outlook-"+i,source:"Outlook"}))];
 const review=[],hidden=[],matched=[];
 for(const e of source){
  if(norm(e.job_name)==="amsco will call"){hidden.push({...e,reason:"General will-call reminder, without a customer job identity."});continue;}
  const matches=trackerMatches(e,rows);
  if(!matches.length){review.push({...e,reason:"No exact builder/community/lot or order-plus-lot match in Sales Tracker. Customer ownership is unconfirmed."});continue;}
  const tracker_rows=matches.map(rowRef);
  const linked=reports.filter(r=>(e.matched_post_ids||[]).includes(r.post_id)||(e.resolved_project_id&&e.resolved_project_id===r.project_id&&r.job_date===e.event_date)||(norm(r.job_name)===norm(e.job_name)&&r.job_date===e.event_date));
  matched.push({...e,tracker_rows,reports:linked.map(r=>({post_id:r.post_id,project_id:r.project_id,job_date:r.job_date,job_name:r.job_name,message:r.message,attachment_count:r.attachment_count})),sources:[{source:e.source,id:e.id,event_date:e.event_date,scope_notes:e.scope_notes||""}]});
 }
 const events=[];
 for(const e of matched){
  const g=events.find(g=>g.sources.every(s=>s.source!==e.source)&&sameVisit(g,e));
  if(!g){events.push(e);continue;}
  g.sources.push(...e.sources);g.reports=[...new Map([...g.reports,...e.reports].map(r=>[r.post_id,r])).values()];
  if(e.source==="Israel calendar"){g.job_name=e.job_name;g.address=e.address;g.scope_notes=e.scope_notes;g.id=e.id;}
 }
 for(const e of events){
  const others=matched.filter(x=>x.event_date!==e.event_date&&x.tracker_rows.some(r=>e.tracker_rows.some(t=>t.source_row===r.source_row)));
  e.warnings=[];
  if(others.length)e.warnings.push("Other calendar dates exist for this order/lot. They may be separate visits or a schedule change; review the sources.");
  if(e.tracker_rows.some(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.arrival_date)&&r.arrival_date>e.event_date))e.warnings.push("A tracker arrival estimate is later than this scheduled visit.");
  e.status="Scheduled; completion not inferred";
 }
 const arrivals=rows.filter(r=>inRange(r.arrival_date)).map(rowRef);
 const used=new Set(events.flatMap(e=>e.reports.map(r=>r.post_id)));
 const reportReview=reports.filter(r=>inRange(r.job_date)&&!used.has(r.post_id)).map(r=>({post_id:r.post_id,job_date:r.job_date,job_name:r.job_name,message:r.message,reason:"Unlinked ProBuild report; not treated as another scheduled installation."}));
 events.sort((a,b)=>a.event_date.localeCompare(b.event_date)||(a.start_time||"").localeCompare(b.start_time||"")||a.job_name.localeCompare(b.job_name));
 return {events,review,hidden,arrivals,report_review:reportReview,counts:{source_events:source.length,clean_events:events.length,merged_duplicates:matched.length-events.length,needs_review:review.length,hidden_reminders:hidden.length,arrival_estimates:arrivals.length,unlinked_reports:reportReview.length}};
}
