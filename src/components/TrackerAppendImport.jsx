import { useState } from "react";
import { base44 } from "@/api/base44Client";
const input="mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-3 text-base sm:text-sm";
const button="min-h-11 rounded-lg bg-[#2A5EA8] px-4 py-3 text-sm font-medium text-white disabled:opacity-50";
const labels={inserted:"New row",skipped:"Already present",conflicting:"Needs review"};
export default function TrackerAppendImport({onImported}) {
 const [file,setFile]=useState(null),[captured,setCaptured]=useState(""),[review,setReview]=useState(null),[payload,setPayload]=useState(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const invalidate=()=>{setReview(null);setPayload(null);setError("");};
 async function inspect(){
  setBusy(true);setError("");setReview(null);
  try {
   if(!file||!captured)throw Error("Choose a Daily Sales delta and enter when it was captured.");
   if(file.size>5000000)throw Error("Maximum file size is 5 MB.");
   const date=new Date(captured);if(!Number.isFinite(date.getTime()))throw Error("Enter a valid capture time.");
   const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(Error("Could not read the delta."));reader.readAsDataURL(file);});
   const body={filename:file.name,file_base64:encoded,source_captured_at:date.toISOString()};
   const r=await base44.functions.invoke("salesTrackerAppend",{...body,action:"review"});
   setPayload(body);setReview(r.data);
  } catch(e){setError(e.response?.data?.error||e.message||"Could not review the delta.");}finally{setBusy(false);}
 }
 async function append(){
  if(!review?.review_token||!payload)return;
  setBusy(true);setError("");
  try {
   const r=await base44.functions.invoke("salesTrackerAppend",{...payload,action:"append",review_token:review.review_token});
   setReview(r.data);setPayload(null);
   try { await onImported?.(); } catch { setError("The import was saved, but the tracker view could not refresh. Reload the page to see the saved rows."); }
  }catch(e){
   if(e.response?.status===409){setReview(null);setPayload(null);}
   setError(e.response?.data?.error||"The response was interrupted. Review this file again to check whether it was already imported.");
  }finally{setBusy(false);}
 }
 return <section className="min-w-0 space-y-4 rounded-xl border bg-white p-4 sm:p-5" aria-label="Append Daily Sales rows">
  <div><h2 className="font-semibold">Add new Daily Sales rows</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Upload just the newly captured rows. Existing workbook snapshots and saved rows remain intact.</p></div>
  <div className="grid gap-3 sm:grid-cols-2">
   <label className="min-w-0 text-sm">Daily Sales delta<input className={input} type="file" accept=".xlsx,.csv,.tsv" disabled={busy} onChange={e=>{invalidate();setFile(e.target.files?.[0]||null);}} />{file&&<span className="mt-1 block break-all text-xs text-slate-600">{file.name}</span>}</label>
   <label className="min-w-0 text-sm">Source captured at (local time)<input className={input} type="datetime-local" value={captured} disabled={busy} onChange={e=>{invalidate();setCaptured(e.target.value);}} /></label>
  </div>
  <p className="text-xs leading-relaxed text-slate-600">XLSX, CSV or TSV · Include the 12 Daily Sales headers from Month PD through Order Folder URL. PO and OE identify the order; separate lots remain separate rows.</p>
  <button type="button" className={button} disabled={busy||!file||!captured} onClick={inspect}>{busy?"Working…":"Review new rows"}</button>
  {error&&<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  {review&&<div className="space-y-3 border-t pt-4" aria-live="polite">
   <h3 className="font-semibold">{review.status==="committed"?"Import result":"Review before appending"}</h3>
   <div className="flex flex-wrap gap-2 text-sm"><span className="rounded-lg bg-green-50 px-3 py-2 text-green-800">{review.inserted} {review.status==="committed"?"inserted":"new"}</span><span className="rounded-lg bg-slate-100 px-3 py-2">{review.skipped} skipped</span><span className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">{review.conflicting} conflicting</span></div>
   {review.unchanged&&<p className="text-sm text-slate-600">No additional rows were inserted.</p>}
   {review.conflicting>0&&<p className="text-sm text-amber-800">Conflicting rows are listed below. They will not overwrite or replace saved data.</p>}
   <div className="max-h-96 overflow-auto rounded border"><table className="w-full min-w-[600px] text-left text-sm"><thead className="sticky top-0 bg-slate-100"><tr>{["File row","PO / OE","Builder / subdivision","Lot","Result"].map(label=><th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{review.decisions?.map((row,i)=><tr key={i} className="border-t align-top"><td className="p-2">{row.input_row}</td><td className="p-2">{row.po||"—"}<br/>{row.oe||"—"}</td><td className="p-2">{row.builder}<br/>{row.subdivision}</td><td className="p-2">{row.lot||"—"}</td><td className="max-w-sm p-2"><p className="font-medium">{labels[row.action]||row.action}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{row.reason}</p><details className="mt-2"><summary className="min-h-8 cursor-pointer text-xs font-medium">Row values</summary><dl className="space-y-2 py-2">{Object.entries(row.incoming||{}).map(([key,value])=><div key={key}><dt className="text-xs text-slate-600">{key.replaceAll("_"," ")}</dt><dd className="break-words text-xs">{String(value??"")||"—"}{row.existing&&String(row.existing[key]??"")!==String(value??"")&&<span className="mt-1 block text-amber-800">Saved: {String(row.existing[key]??"")||"—"}</span>}</dd></div>)}</dl></details></td></tr>)}</tbody></table></div>
   {review.status==="review"&&review.inserted>0&&<button type="button" className={button} disabled={busy} onClick={append}>{busy?"Appending…":"Append "+review.inserted+" new row"+(review.inserted===1?"":"s")}</button>}
   {review.status==="committed"&&<p role="status" className="text-sm text-green-800">Existing snapshots were preserved. {review.inserted>0?"The new rows are now available in tracker searches.":"This file added no new rows."}</p>}
  </div>}
 </section>;
}
