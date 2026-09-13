import {useEffect,useState} from "react";
import {base44} from "@/api/base44Client";

export default function CalendarReviewPanel() {
 const [captures,setCaptures]=useState([]),[calendar,setCalendar]=useState("UT DC Service"),[busy,setBusy]=useState(true),[error,setError]=useState(""),[query,setQuery]=useState("");
 async function load(){
  setBusy(true);setError("");
  try {
   const response=await base44.functions.invoke("job-knowledge",{action:"calendar_reviews"});
   if(response.data?.error||!Array.isArray(response.data?.captures))throw Error("load");
   setCaptures(response.data.captures);
   if(response.data.rejected?.length)setError(response.data.rejected.length+" saved captures failed verification and are excluded.");
  }catch{setError("Saved iPad schedules could not be verified. Reload to try again.");setCaptures([]);}
  finally{setBusy(false);}
 }
 useEffect(()=>{load();},[]);
 const rows=captures.filter(c=>c.calendar_name===calendar).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at)),current=rows[0];
 const includes=e=>(e.job_name+" "+(e.scope_notes||"")+" "+(e.address||"")).toLowerCase().includes(query.toLowerCase());
 const selected=current?.selected_events.filter(includes)||[],deferred=current?.deferred_agenda.filter(includes)||[];
 return <section className="rounded-xl border bg-white p-5 space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-xl font-semibold">iPad schedules</h1><button className="rounded border px-3 py-2" disabled={busy} onClick={load}>{busy?"Loading…":"Reload saved schedules"}</button></div>
  <p className="text-sm">Installation and service details captured on the Mac from the connected iPad.</p>
  <label className="block text-sm">Calendar<select className="ml-3 rounded border p-2" value={calendar} onChange={e=>setCalendar(e.target.value)}><option>UT DC Service</option><option>UT Window Install</option></select></label>
  {error&&<p role="alert" className="text-red-700">{error}</p>}
  {!busy&&!current&&!error&&<p>No verified capture saved for this calendar.</p>}
  {current&&<>
   <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm space-y-1">
    <p className="font-semibold">{current.range_start} through {current.range_end} · {current.timezone}</p>
    <p>{current.source_manifest.agenda_event_count} agenda entries · {current.selected_events.length} detailed entries · {current.deferred_agenda.length} deferred entries</p>
    <p>Agenda coverage and selected details are complete. Full calendar details, ownership and cancellations are not verified.</p>
    <p>Captured {new Date(current.captured_at).toLocaleString()}. Selection used the tracker saved {new Date(current.source_manifest.tracker_source.captured_at).toLocaleString()}.</p>
    {Date.now()-Date.parse(current.captured_at)>26*3600000&&<p className="font-semibold">This capture is over 26 hours old. Verify the current schedule before making a commitment.</p>}
   </div>
   <label className="block text-sm">Find a job<input className="mt-1 block w-full rounded border p-2" type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Job name, address or note" /></label>
   <h2 className="font-semibold">Captured details ({selected.length})</h2>
   <p className="text-sm">Job candidates awaiting ownership review. Uncertain matches remain in Agent Center; original notes are preserved.</p>
   {selected.map(e=><details key={e.source_occurrence_key} className="rounded border p-3" style={{borderLeft:"4px solid "+(calendar==="UT DC Service"?"#a34e21":"#0b3f3b")}}><summary>{e.event_date} · {e.all_day?"All day":e.start_time+"–"+e.end_time} · {e.job_name}</summary><p className="mt-2 text-sm">{e.address}</p>{e.multi_day&&<p className="text-sm">Source spans {e.source_start_date} through {e.source_end_date}, inclusive. This occurrence is {e.event_date}.</p>}<p className="mt-2 whitespace-pre-wrap">{e.scope_notes||"No description in source."}</p><p className="mt-2 text-xs">Observed {new Date(e.captured_at).toLocaleString()} · Read only</p></details>)}
   <details className="rounded border p-3"><summary>Deferred agenda entries ({deferred.length})</summary><p className="mt-2 text-sm">These titles are retained for review. Their full details are outside this import.</p>{deferred.map(e=><p className="border-t py-2 text-sm" key={e.source_occurrence_key}>{e.event_date} · {e.job_name}</p>)}</details>
   <details className="rounded border p-3"><summary>Daily coverage, including empty days</summary><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th className="text-left">Date</th><th>Agenda</th><th>Detailed</th><th>Deferred</th></tr></thead><tbody>{Object.entries(current.daily_coverage).map(([day,c])=><tr key={day}><td>{day}</td><td className="text-center">{c.agenda_entry_count}</td><td className="text-center">{c.selected_details_captured}</td><td className="text-center">{c.deferred_title_count}</td></tr>)}</tbody></table></div></details>
   {rows.length>1&&<p className="text-sm">{rows.length-1} earlier capture(s) remain in job history. They do not confirm the current schedule.</p>}
  </>}
 </section>;
}
