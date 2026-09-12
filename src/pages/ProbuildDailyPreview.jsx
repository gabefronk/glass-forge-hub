import {useState} from "react";
import {base44} from "@/api/base44Client";
export default function ProbuildDailyPreview(){
 const [date,setDate]=useState(()=>{const today=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Denver",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());const d=new Date(today+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}),[data,setData]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(offset=0){
  setBusy(true);setError("");
  try{const r=await base44.functions.invoke("preview-probuild-daily",{date,offset});setData(r.data);}
  catch(e){setError(e.response?.data?.error||"Source preview failed. No email was sent.");}
  finally{setBusy(false);}
 }
 return <main className="p-6 space-y-4"><h1 className="text-2xl font-bold">ProBuild daily report preview</h1>
 <p>Read source notes by Mountain date. Each page checks ten projects. This preview does not send email; photos are counted, not downloaded.</p>
 <label>Report date <input aria-label="Report date" type="date" value={date} onChange={e=>{setDate(e.target.value);setData(null)}} /></label>
 <button disabled={busy} onClick={()=>load(0)}>{busy?"Checking source…":"Check source"}</button>
 {error&&<p role="alert">{error}</p>}
 {data&&<><p>Projects checked: {data.offset+data.results.length} of {data.total_projects}. {data.next_offset===null?"Last page.":"More pages remain."}</p>
 {data.results.map(p=><section key={p.project_id}><h2>{p.project_name}</h2>{!p.ok?<p>Source unavailable for this project.</p>:p.posts.length===0?<p>No posts for this date.</p>:p.posts.map(x=><article key={x.post_id}><p>{x.created_at}{x.deleted?" · Deleted source entry":""}</p><pre className="whitespace-pre-wrap">{x.message}</pre><p>Attachments: {x.attachment_count}</p></article>)}</section>)}
 {data.next_offset!==null&&<button disabled={busy} onClick={()=>load(data.next_offset)}>Next projects</button>}</>}
 </main>;
}
