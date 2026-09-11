import { useState } from "react";
import { FileText, ListChecks, MessageSquare, UserRound } from "lucide-react";
import AmscoQuoteSchedule from "./AmscoQuoteSchedule";

const money=value=>typeof value==="number"?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(value):"—";
function Fields({fields}) {
  return <dl className="grid gap-4 sm:grid-cols-2">{Object.entries(fields||{}).map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-[#77839A]">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-[#305367]">{String(value)}</dd></div>)}</dl>;
}
export default function ImportedAmscoQuote({snapshot,preview=false,importedAt}) {
  const [tab,setTab]=useState("lines");
  if(!snapshot)return null;
  const totals=snapshot.totals;
  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-[#CBD5E2] bg-white p-4">
      <div className="min-w-0"><p className="text-xs font-semibold text-[#276449]">{preview?"Saved AMSCO quote":"Imported from AMSCO"} · {snapshot.quote_number}</p><h2 className="mt-1 break-words text-xl font-semibold text-[#25334B]">{snapshot.title}</h2><p className="mt-2 text-sm text-[#526B7B]">{snapshot.line_count} line items · {snapshot.unit_count} total quantity</p>{importedAt&&<p className="mt-2 text-xs text-[#77839A]">Imported {new Date(importedAt).toLocaleString()}</p>}</div>
      <div><p className="text-xs text-[#526B7B]">Customer total</p><p className="mt-1 text-2xl font-semibold tabular-nums text-[#20386E]">{money(totals.customer_total)}</p></div>
    </div>
    <div className="flex flex-wrap gap-1 border-b border-[#CDD6E0]" role="tablist" aria-label="Imported quote sections">
      {[["lines","Line Items",ListChecks],["details","Quote Details",FileText],["customer","Customer",UserRound],["notes","Notes",MessageSquare]].map(([key,label,Icon])=><button key={key} role="tab" aria-selected={tab===key} onClick={()=>setTab(key)} className={"inline-flex min-h-12 items-center gap-1.5 rounded-t px-3 text-sm "+(tab===key?"bg-white font-semibold text-[#20386E] ring-1 ring-inset ring-[#CDD6E0]":"text-[#526B7B]")}><Icon size={15}/>{label}</button>)}
    </div>
    {tab==="lines"&&<AmscoQuoteSchedule lines={snapshot.lines} prices={snapshot.lines.map(line=>({status:"imported",unit_prices:line.unit_prices,line_totals:line.line_totals}))}/>}
    {tab==="details"&&<div className="space-y-6 rounded-lg border border-[#CBD5E2] bg-white p-4"><Fields fields={snapshot.details}/><div><h3 className="mb-3 font-semibold text-[#305367]">Saved quote totals</h3><dl className="space-y-3 text-sm">{[["Customer subtotal","subtotal"],["Tax","tax"],["Labor","labor"],["Freight","freight"],["Shipping","shipping"],["Handling","handling"],["Miscellaneous","misc"],["Discount","discount"],["Customer total","customer_total"],["Dealer total","dealer_total"]].filter(([,key])=>totals[key]!=null).map(([label,key])=><div key={key} className={"flex justify-between gap-3 "+(key==="customer_total"?"border-t pt-3 font-semibold":"")}><dt>{label}</dt><dd className="tabular-nums">{money(totals[key])}</dd></div>)}</dl></div><p className="text-xs leading-relaxed text-[#77839A]">These are the values saved in AMSCO when the quote was read.</p></div>}
    {tab==="customer"&&<div className="rounded-lg border border-[#CBD5E2] bg-white p-4"><Fields fields={snapshot.customer}/>{!Object.keys(snapshot.customer||{}).length&&<p className="text-sm text-[#526B7B]">No customer details on this quote.</p>}</div>}
    {tab==="notes"&&<div className="space-y-4 rounded-lg border border-[#CBD5E2] bg-white p-4"><h3 className="font-semibold text-[#305367]">Quote notes</h3>{snapshot.notes.length?snapshot.notes.map((note,index)=><p key={index} className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#526B7B]">{note}</p>):<p className="text-sm text-[#526B7B]">No quote-level notes.</p>}{snapshot.attachments.length>0&&<><h3 className="font-semibold text-[#305367]">Attachments in AMSCO</h3>{snapshot.attachments.map((name,index)=><p key={index} className="break-words text-sm text-[#526B7B]">{name}</p>)}</>}</div>}
    {snapshot.warnings?.length>0&&<div className="rounded bg-[#FCF5E9] p-3 text-sm text-[#8A5A10]">{snapshot.warnings.map((notice,index)=><p key={index}>{notice}</p>)}</div>}
  </div>;
}
