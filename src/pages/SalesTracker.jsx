import { useEffect, useState } from "react";
import TrackerWorksheet from "@/components/TrackerWorksheet";
import { base44 } from "@/api/base44Client";
const input="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm";
const button="rounded-lg bg-[#2A5EA8] px-4 py-3 text-sm font-medium text-white disabled:opacity-50";
export default function SalesTracker(){
 const [data,setData]=useState(null),[query,setQuery]=useState({builder:"",subdivision:"",lot:"",oe:"",po:""});
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [file,setFile]=useState(null),[captured,setCaptured]=useState("");
 const [conversation,setConversation]=useState(null),[messages,setMessages]=useState([]),[question,setQuestion]=useState("");
 async function lookup(q={}) { const r=await base44.functions.invoke("salesTrackerLookup",q);setData(r.data); }
 useEffect(()=>{lookup().catch(e=>setError(e.response?.data?.error||"Tracker unavailable."));},[]);
 useEffect(()=>{if(!conversation)return;return base44.agents.subscribeToConversation(conversation.id,c=>setMessages(c.messages||[]));},[conversation]);
 async function search(e){e.preventDefault();setBusy(true);setError("");try{await lookup(query);}catch(e){setError(e.response?.data?.error||"Lookup failed.");}finally{setBusy(false);}}
 async function upload(){
  setBusy(true);setError("");setNotice("");
  try{
   if(!file || !captured)throw Error("Choose the complete workbook and enter when it was downloaded from the source.");
   if(file.size>5000000)throw Error("Maximum workbook size is 5 MB.");
   const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(Error("Could not read workbook."));reader.readAsDataURL(file);});
   const r=await base44.functions.invoke("salesTrackerImport",{filename:file.name,file_base64:encoded,source_captured_at:new Date(captured).toISOString()});
   await lookup(query);setNotice("Imported "+r.data.row_count+" sales rows. The complete workbook is retained.");
  }catch(e){setError(e.response?.data?.error||e.message||"Import failed; previous snapshot preserved.");}finally{setBusy(false);}
 }
 async function ask(e){
  e.preventDefault();if(!question.trim())return;setBusy(true);setError("");
  try{
   let c=conversation;
   if(!c){c=await base44.agents.createConversation({agent_name:"sales_tracker_agent",metadata:{name:"Sales Tracker lookup"}});setConversation(c);}
   await base44.agents.addMessage(c,{role:"user",content:question});setQuestion("");
   const updated=await base44.agents.getConversation(c.id);setMessages(updated?.messages||[]);
  }catch(e){setError(e.message||"Agent unavailable.");}finally{setBusy(false);}
 }
 return <div className="mx-auto max-w-6xl space-y-5 p-5 pb-32 text-[#131A26]">
  <header><h1 className="text-2xl font-semibold">Sales Tracker</h1><p className="mt-2 text-sm text-slate-600">Look up the latest imported order and lot information.</p></header>
  {error&&<div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4">{error}</div>}
  {notice&&<div role="status" className="rounded-xl border border-green-300 bg-green-50 p-4">{notice}</div>}
  <section className="rounded-xl border bg-white p-5 space-y-2">
   <h2 className="font-semibold">Current workbook</h2>
   <p>{data?.filename||"No workbook imported yet."}</p>
   {data?.source_captured_at&&<><p className="text-sm">Source downloaded: {new Date(data.source_captured_at).toLocaleString()}</p><p className="text-sm">{data.row_count} sales rows · {data.sheet_names?.join(" · ")}</p></>}
   {data?.status==="stale"&&<p role="status" className="font-medium text-amber-800">This copy is over 26 hours old. Verify the live source for current dates.</p>}
   <p className="text-sm text-slate-600">Requested refresh: daily at 1 a.m. Mountain time. Automatic refresh is not yet enabled.</p>
   <details className="pt-3"><summary className="cursor-pointer font-medium">Upload a full replacement workbook</summary>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
     <label className="text-sm">Excel workbook<input className={input} type="file" accept=".xlsx" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)} onInput={e=>setFile(e.target.files?.[0]||null)}/>{file&&<span className="block mt-1">{file.name} · {file.size} bytes</span>}</label>
     <label className="text-sm">Source downloaded at (your local time)<input className={input} type="text" placeholder="YYYY-MM-DDTHH:mm" value={captured} onChange={e=>setCaptured(e.target.value)}/></label>
    </div><button className={button+" mt-3"} disabled={busy||!file||!captured} onClick={upload}>Validate and import</button>
    <p className="mt-2 text-xs text-slate-600">Imports replace the tracker view only after validation. Prior snapshots are retained. Calendar events and invoices keep their own source data.</p>
   </details>
  </section>
  <section className="rounded-xl border bg-white p-5 space-y-4">
   <h2 className="font-semibold">Find an order</h2><p className="text-sm text-slate-600">Use an OE or PO, or builder and subdivision. Add a lot to identify its own arrival date. All filled fields must match.</p>
   <form onSubmit={search} className="grid gap-3 sm:grid-cols-3">{Object.keys(query).map(k=><label key={k} className="text-sm">{({oe:"OE",po:"PO",lot:"Lot",builder:"Builder",subdivision:"Subdivision"})[k]}<input className={input} value={query[k]} onChange={e=>setQuery({...query,[k]:e.target.value})}/></label>)}<button disabled={busy||!Object.values(query).some(v=>v.trim())} className={button}>Find matching rows</button></form>
   {data&&<p className="text-sm">{data.total} matching rows{data.truncated?" (first 100 shown; narrow the search)":""}</p>}
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Builder / subdivision","Lot","OE / PO","Order date","Estimated arrival","Source"].map(h=><th className="border-b p-2" key={h}>{h}</th>)}</tr></thead><tbody>{data?.matches?.map(r=><tr key={r.source_row}><td className="border-b p-2">{r.builder}<br/>{r.subdivision}</td><td className="border-b p-2">{r.lot}</td><td className="border-b p-2">{r.oe}<br/>{r.po}</td><td className="border-b p-2">{r.order_date||"—"}</td><td className="border-b p-2 font-medium">{r.arrival_date||"Not recorded"}</td><td className="border-b p-2">{r.source_sheet}<br/>{r.date_cell}</td></tr>)}</tbody></table></div>
   <p className="text-xs text-slate-600">Arrival estimates do not establish actual delivery or installation. Lots sharing an order can have different dates.</p>
  </section>
  <TrackerWorksheet key={data?.sha256||"empty"}/>
  <section className="rounded-xl border bg-white p-5 space-y-3"><h2 className="font-semibold">Sales Tracker agent</h2><p className="text-sm text-slate-600">Optional conversational lookup. The search above does not use AI.</p>
   <div className="space-y-3">{messages.filter(m=>["user","assistant"].includes(m.role)&&typeof m.content==="string"&&m.content).map((m,i)=><div key={m.id||i} className="rounded-lg bg-slate-50 p-3"><p className="text-xs font-semibold">{m.role==="user"?"You":"Sales Tracker agent"}</p><p className="whitespace-pre-wrap text-sm">{m.content}</p></div>)}</div>
   <form onSubmit={ask} className="flex gap-2"><input aria-label="Question for Sales Tracker agent" className={input} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask about an order, subdivision and lot"/><button className={button} disabled={busy||!question.trim()}>Ask</button></form>
  </section>
 </div>;
}