import { useEffect, useState } from "react";
import TrackerWorksheet from "@/components/TrackerWorksheet";
import TrackerAppendImport from "@/components/TrackerAppendImport";
import { base44 } from "@/api/base44Client";
const input="w-full rounded-lg border border-[#DDE0DA] bg-white p-3 text-sm text-[#182422]";
const button="rounded-lg bg-[#146556] px-4 py-3 text-sm font-medium text-white disabled:opacity-50";
export default function SalesTracker(){
 const [data,setData]=useState(null),[query,setQuery]=useState({builder:"",subdivision:"",lot:"",oe:"",po:""});
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const [conversation,setConversation]=useState(null),[messages,setMessages]=useState([]),[question,setQuestion]=useState("");
 async function lookup(q={}) { const r=await base44.functions.invoke("salesTrackerLookup",q);setData(r.data); }
 useEffect(()=>{lookup().catch(e=>setError(e.response?.data?.error||"Tracker unavailable."));},[]);
 useEffect(()=>{if(!conversation)return;return base44.agents.subscribeToConversation(conversation.id,c=>setMessages(c.messages||[]));},[conversation]);
 async function search(e){e.preventDefault();setBusy(true);setError("");try{await lookup(query);}catch(e){setError(e.response?.data?.error||"Lookup failed.");}finally{setBusy(false);}}
 async function ask(e){
  e.preventDefault();if(!question.trim())return;setBusy(true);setError("");
  try{
   let c=conversation;
   if(!c){c=await base44.agents.createConversation({agent_name:"sales_tracker_agent",metadata:{name:"Sales Tracker lookup"}});setConversation(c);}
   await base44.agents.addMessage(c,{role:"user",content:question});setQuestion("");
   const updated=await base44.agents.getConversation(c.id);setMessages(updated?.messages||[]);
  }catch(e){setError(e.message||"Agent unavailable.");}finally{setBusy(false);}
 }
 return <div className="mx-auto max-w-6xl space-y-5 p-5 pb-32 text-[#182422]">
  <header><h1 className="text-2xl font-semibold">Sales Tracker</h1><p className="mt-2 text-sm text-[#53615B]">Look up the latest imported order and lot information.</p></header>
  {error&&<div role="alert" className="rounded-xl border border-[#F0C9C5] bg-[#FCEDEC] p-4">{error}</div>}
  <section className="rounded-xl border bg-white p-5 space-y-2">
   <h2 className="font-semibold">Current workbook</h2>
   <p>{data?.filename||"No workbook imported yet."}</p>{data?.appended_count>0&&<p className="text-sm text-[#166447]">{data.appended_count} incremental rows added · original workbook preserved</p>}{data?.append_conflict_count>0&&<p role="status" className="text-sm text-[#89511A]">{data.append_conflict_count} appended rows conflict with newer source data and need review.</p>}
   {data?.source_captured_at&&<><p className="text-sm">Source downloaded: {new Date(data.source_captured_at).toLocaleString()}</p><p className="text-sm">{data.row_count} sales rows · {data.sheet_names?.join(" · ")}</p></>}
   {data?.status==="stale"&&<p role="status" className="font-medium text-[#89511A]">This copy is over 26 hours old. Verify the live source for current dates.</p>}
   <p className="text-sm text-[#53615B]">Refresh scheduled through the connected Mac: daily at 1 a.m. Mountain time. First overnight run is not yet verified. The Mac must be awake and the iPad connected and accessible.</p>

  </section>
  <TrackerAppendImport onImported={()=>lookup(query)}/>
  <section className="rounded-xl border bg-white p-5 space-y-4">
   <h2 className="font-semibold">Find an order</h2><p className="text-sm text-[#53615B]">Use an OE or PO, or builder and subdivision. Add a lot to identify its own arrival date. All filled fields must match.</p>
   <form onSubmit={search} className="grid gap-3 sm:grid-cols-3">{Object.keys(query).map(k=><label key={k} className="text-sm">{({oe:"OE",po:"PO",lot:"Lot",builder:"Builder",subdivision:"Subdivision"})[k]}<input className={input} value={query[k]} onChange={e=>setQuery({...query,[k]:e.target.value})}/></label>)}<button disabled={busy||!Object.values(query).some(v=>v.trim())} className={button}>Find matching rows</button></form>
   {data&&<p className="text-sm">{data.total} matching rows{data.truncated?" (first 100 shown; narrow the search)":""}</p>}
   <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Builder / subdivision","Lot","OE / PO","Order date","Estimated arrival","Source"].map(h=><th className="border-b p-2" key={h}>{h}</th>)}</tr></thead><tbody>{data?.matches?.map(r=><tr key={r.row_key||"base:"+r.source_row}><td className="border-b p-2">{r.builder}<br/>{r.subdivision}</td><td className="border-b p-2">{r.lot}</td><td className="border-b p-2">{r.oe}<br/>{r.po}</td><td className="border-b p-2">{r.order_date||"—"}</td><td className="border-b p-2 font-medium">{r.arrival_date||"Not recorded"}</td><td className="border-b p-2">{r.source_sheet}<br/>{r.date_cell}{r.source_file&&<span className="mt-1 block max-w-52 break-all text-xs">{r.source_file}</span>}</td></tr>)}</tbody></table></div>
   <p className="text-xs text-[#53615B]">Arrival estimates do not establish actual delivery or installation. Lots sharing an order can have different dates.</p>
  </section>
  <TrackerWorksheet key={data?.view_version||data?.sha256||"empty"}/>
  <section className="rounded-xl border bg-white p-5 space-y-3"><h2 className="font-semibold">Sales Tracker agent</h2><p className="text-sm text-[#53615B]">Optional conversational lookup. The search above does not use AI.</p>
   <div className="space-y-3">{messages.filter(m=>["user","assistant"].includes(m.role)&&typeof m.content==="string"&&m.content).map((m,i)=><div key={m.id||i} className="rounded-lg bg-[#F0F1ED] p-3"><p className="text-xs font-semibold">{m.role==="user"?"You":"Sales Tracker agent"}</p><p className="whitespace-pre-wrap text-sm">{m.content}</p></div>)}</div>
   <form onSubmit={ask} className="flex gap-2"><input aria-label="Question for Sales Tracker agent" className={input} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Ask about an order, subdivision and lot"/><button className={button} disabled={busy||!question.trim()}>Ask</button></form>
  </section>
 </div>;
}