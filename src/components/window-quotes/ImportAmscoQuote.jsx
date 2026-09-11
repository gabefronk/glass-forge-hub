import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ImportedAmscoQuote from "./ImportedAmscoQuote";

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#CAD5E3] bg-white px-4 py-2.5 text-sm font-semibold text-[#254D77] disabled:opacity-50";
const primary = button.replace("bg-white","bg-[#20386E]").replace("text-[#254D77]","text-white");
const pending = status => ["queued","searching","importing"].includes(status);
async function invoke(body) {
  const response = await base44.functions.invoke("amscoQuoteImport",body);
  if (response.data?.error) throw new Error(response.data.error);
  return response.data.import;
}
export default function ImportAmscoQuote({onImported}) {
  const [open,setOpen]=useState(false), [number,setNumber]=useState(""), [lookup,setLookup]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState("");
  const [connection,setConnection]=useState(null);
  const request=useRef(null);
  const polling=useRef(false);
  useEffect(()=>{
    if (!open || !lookup?.id || !pending(lookup.status)) return;
    let disposed=false;
    const poll=async()=>{
      if (polling.current) return;
      polling.current=true;
      try { const result=await invoke({action:"status",import_id:lookup.id}); if(!disposed){setLookup(result);setError("");} }
      catch(e){if(!disposed)setError(e?.response?.data?.error||e.message);}
      finally{polling.current=false;}
    };
    const interval=setInterval(poll,6000);
    return ()=>{disposed=true;clearInterval(interval);};
  },[open,lookup?.id,lookup?.status]);
  const search=async event=>{
    event.preventDefault();
    if(busy||pending(lookup?.status))return;
    const value=number.trim();
    if(!/^\d{1,20}$/.test(value)){setError("Enter the numeric AMSCO quote number.");return;}
    if(!request.current||request.current.number!==value)request.current={number:value,id:crypto.randomUUID()};
    setBusy(true);setError("");setLookup(null);
    try{setLookup(await invoke({action:"lookup",quote_number:value,request_id:request.current.id}));}
    catch(e){setError(e?.response?.data?.error||e.message);}
    finally{setBusy(false);}
  };
  const save=async()=>{
    if(busy)return;
    setBusy(true);setError("");
    try{
      const result=await invoke({action:"commit",import_id:lookup.id});setLookup(result);
      if(result.imported_quote_id){setOpen(false);onImported(result.imported_quote_id);}
    }catch(e){setError(e?.response?.data?.error||e.message);}
    finally{setBusy(false);}
  };
  const reset=()=>{request.current=null;setLookup(null);setError("");};
  return <>
    <button type="button" className={button} onClick={()=>setOpen(true)}><Download size={16}/>Import from AMSCO</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[94dvh] w-[calc(100%-24px)] max-w-6xl overflow-y-auto rounded-xl bg-white p-4 sm:p-6">
      <DialogHeader><DialogTitle>Import from AMSCO</DialogTitle><DialogDescription>Find a saved quote by number, review its line items and prices, then add it to My Quotes.</DialogDescription></DialogHeader>
      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-sm text-[#305367]">AMSCO quote number<input autoFocus inputMode="numeric" type="text" pattern="[0-9]*" maxLength={20} value={number} onChange={e=>{setNumber(e.target.value);if(!pending(lookup?.status))reset();}} disabled={busy||pending(lookup?.status)} placeholder="e.g. 3517014" className="mt-2 min-h-12 w-full rounded border border-[#AAB2BE] bg-white px-3 text-base" /></label>
        <button className={primary} disabled={busy||!number.trim()||pending(lookup?.status)}>{busy?<Loader2 size={17} className="animate-spin"/>:<Search size={17}/>}Search AMSCO</button>
      </form>
      <p className="text-xs leading-relaxed text-[#6D7D90]">Uses the AMSCO account signed in on your connected quoting computer. Searches can take a few minutes.</p>
      <button className="min-h-11 self-start text-xs text-[#254D77] underline" onClick={async()=>{try{const r=await base44.functions.invoke("amscoQuoteImport",{action:"connection"});setConnection(r.data.connection);}catch{setError("Connection check did not complete.");}}}>Check AMSCO connection</button>
      {connection&&<p className="rounded border border-[#CAD5E3] p-3 text-xs text-[#526B7B]">{connection.reachable?"Online connection is available.":"Online connection needs attention."} {connection.browser_busy?("The quoting browser is busy"+(connection.active_status?" ("+connection.active_status+(connection.active_phase?" / "+connection.active_phase:"")+")":"")+"."):"The quoting browser is available."}</p>}
      {lookup?.status==="queued"&&<button className={button} onClick={async()=>{try{setLookup(await invoke({action:"cancel_waiting",import_id:lookup.id}));}catch(e){setError(e?.response?.data?.error||e.message);}}}>Cancel waiting search</button>}
      {error&&<p role="alert" className="rounded bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}
      {lookup&&<div role="status" className="flex items-start gap-2 rounded bg-[#EEF4FA] p-3 text-sm text-[#305367]">{pending(lookup.status)&&<Loader2 size={17} className="mt-0.5 shrink-0 animate-spin"/>}<p>{lookup.message}</p></div>}
      {lookup?.snapshot&&<ImportedAmscoQuote snapshot={lookup.snapshot} preview/>}
      {lookup?.status==="preview"&&<div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t bg-white py-3"><button className={button} onClick={reset} disabled={busy}>Search another quote</button><button className={primary} onClick={save} disabled={busy}>{busy?<Loader2 size={16} className="animate-spin"/>:<Download size={16}/>}Import {lookup.snapshot.line_count} line items</button></div>}
      {lookup?.status==="imported"&&<button className={primary} onClick={()=>{setOpen(false);onImported(lookup.imported_quote_id);}}>Open imported quote</button>}
      {["failed","not_found","needs_sign_in"].includes(lookup?.status)&&<button className={button} onClick={reset}>Search again</button>}
    </DialogContent></Dialog>
  </>;
}
