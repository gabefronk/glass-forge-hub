import {filterOwnedCalendar} from "./engine.js";
async function all(entity) {
  const records=[];
  for(let skip=0;skip<50000;skip+=1000){const page=await entity.list("-created_date",1000,skip);records.push(...page);if(page.length<1000)return records;}
  throw Error("Calendar pagination limit reached.");
}
// Display-only job links: most synced events never get job_id written back, but the
// FeeLine built from the same event (calendar_event_id == google_event_id) usually has a
// confident job match. Attach that job id to the response so "Open job" links work.
// Nothing is written to CalendarEvents; failures fall back to the stored links only.
async function feeLineJobLinks(client) {
  const links=new Map();
  try {
    const api=(client.asServiceRole||client).entities.FeeLines;
    for(let skip=0;skip<50000;skip+=1000){
      const page=await api.filter({match_confidence:"high"},"-job_date",1000,skip);
      for(const r of page){if(r.calendar_event_id&&r.job_id&&!links.has(r.calendar_event_id))links.set(r.calendar_event_id,r.job_id);}
      if(page.length<1000)break;
    }
  }catch{/* stored links only */}
  return links;
}
export function withDerivedJobLinks(events,links){
  return events.map(e=>(!e.job_id&&e.google_event_id&&links.get(e.google_event_id))?{...e,job_id:links.get(e.google_event_id),job_link_derived:true}:e);
}
export function createOwnedCalendarHandler({getClient,readTracker}) {
 return async req => {
  const client=getClient(req),user=await client.auth.me().catch(()=>null);
  if(!user)return Response.json({error:"Sign in to view the calendar."},{status:401});
  if(!["admin","manager"].includes(user.role))return Response.json({error:"Calendar access required."},{status:403});
  try {
   const query=await req.json().catch(()=>({}));
   const [tracker,calendarRaw,snapshots,recent,jobLinks]=await Promise.all([
    readTracker(client),all(client.entities.CalendarEvents),
    user.role==="admin"?client.entities.OutlookCalendarSnapshot.filter({complete:true,calendar_name:"UT Window Install"},"-captured_at",1):[],
    user.role==="admin"?client.entities.OutlookCalendarSnapshot.filter({calendar_name:"UT Window Install"},"-captured_at",1):[],
    feeLineJobLinks(client)
   ]);
   const calendar=withDerivedJobLinks(calendarRaw,jobLinks);
   if(!tracker.rows?.length)throw Error("No verified tracker rows.");
   const snapshot=snapshots[0]||null;
   const imported=(snapshot?.events||[]).map((event,index)=>({...event,id:"outlook-"+snapshot.id+"-"+index,source:"outlook",report_required:false,calendar_name:snapshot.calendar_name,captured_at:snapshot.captured_at}));
   const result=filterOwnedCalendar([...calendar.filter(e=>e.source_status !== 'cancelled'),...imported],tracker.rows);
   const metadata=snapshot?{id:snapshot.id,calendar_name:snapshot.calendar_name,range_start:snapshot.range_start,range_end:snapshot.range_end,captured_at:snapshot.captured_at,event_count:snapshot.event_count}:null;
   return Response.json({groups:query.brief===true?undefined:result.groups,ownership:{counts:result.counts,by_month:query.brief===true?{[query.month||new Date().toISOString().slice(0,7)]:result.by_month[query.month||new Date().toISOString().slice(0,7)]}:result.by_month,tracker_captured_at:tracker.snapshot.source_captured_at,tracker_rows:tracker.rows.length,appended_rows:tracker.appended?.length||0},
    outlook:metadata,partial_outlook:recent[0]?.complete===false?{event_count:recent[0].event_count,collection_notes:recent[0].collection_notes}:null,
    // Administrators receive excluded identifiers for audit only, never as calendar display entries.
    ...(user.role==="admin"?{excluded_events:query.brief===true?result.rejected.filter(e=>e.event_date?.startsWith(query.month||new Date().toISOString().slice(0,7))&&/edge|utah 700/i.test(e.job_name)).map(e=>({event_date:e.event_date,job_name:e.job_name,source:e.source})):result.rejected}:{}),generated_at:new Date().toISOString()});
  }catch{return Response.json({error:"Calendar ownership could not be verified against Sales Tracker. Events are hidden until verification succeeds."},{status:503});}
 };
}