import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, Minus, Pencil, Plus, Search, Trash2 } from "lucide-react";
import WindowDrawing from "./AmscoWindowDrawing";
import { colorParts, parseGrilles, selectedSeries } from "./amscoConfiguratorModel";
import { resolvedWindowOptions, specificationValue } from "./windowSpecificationDisplay";
import "./amscoQuoteSchedule.css";
import { additionalLineSpecifications } from "./quoteScheduleModel";

const money = (value, currency = "USD") => value != null && value !== "" && Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value)) : "—";
const action = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded border border-[#AAB2BE] bg-white px-3 text-sm text-[#305367] hover:bg-[#EDF3FA] disabled:opacity-40";
const optionLabels = {fin:"Fin",glass:"Glass",tempered:"Tempered",patterned_glass:"Patterned glass",screen:"Screen",hardware:"Hardware",hardware_color:"Hardware finish",glass_thickness:"Glass thickness",glazing_method:"Glazing",elevation:"Installation elevation",argon:"Thermal gas",super_spacer:"Super Spacer",capillary_tubes:"Capillary tubes",grilles:"Grilles",operation:"Operation",sash_split:"Sash split",number_wide:"Number wide",unit_type:"Unit type"};
const priceLabel = price => price?.status === "priced" ? "Priced" : price?.status === "amsco_lookup_needed" ? "AMSCO quote needed" : price?.status === "native_unavailable" ? "Pricing unavailable" : ["calculating","native_busy"].includes(price?.status) ? "Calculating…" : "Not priced";

function WindowLine({line,index,settings,price,disabled,condensed,onEdit,onCopy,onRemove,onUpdate,currency}) {
  const [expanded,setExpanded] = useState(true);
  const options = resolvedWindowOptions(line,settings,price);
  const colors = colorParts(options,settings);
  const details = !condensed && expanded;
  const entries = Object.entries(options).filter(([key,value]) => optionLabels[key] && value !== undefined && value !== null && value !== "");
  const drawingLine = {...line,options};
  const frame = line.frame_dimensions;
  const additional = additionalLineSpecifications(line);
  const lineNumber = line.native_line_number ?? (index+1)*100;
  const changeQty = value => onUpdate?.(index,{qty:value});
  return <article className="amsco-line-item">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CCD2D9] bg-[#F8F8F8] px-4 py-2">
      <div className="min-w-0 break-words text-sm text-[#305367]"><span className="font-semibold">Line {lineNumber}</span>{line.mark && <span className="ml-3">{line.mark}</span>}</div>
      {(onEdit || onCopy || onRemove) && <div className="flex flex-wrap gap-1.5">
        {onEdit && <button type="button" className={action} disabled={disabled} onClick={()=>onEdit(line,index)} aria-label={`Edit window ${index+1}`}><Pencil size={14}/>Edit</button>}
        {onCopy && <button type="button" className={action} disabled={disabled} onClick={()=>onCopy(line)} aria-label={`Duplicate window ${index+1}`}><Copy size={14}/>Copy</button>}
        {onRemove && <button type="button" className={action+" text-[#914438]"} disabled={disabled} onClick={()=>onRemove(index)} aria-label={`Remove window ${index+1}`}><Trash2 size={14}/>Delete</button>}
      </div>}
    </header>
    <div className="amsco-line-body">
      <div className="amsco-line-drawing">
        <WindowDrawing line={drawingLine} settings={settings} grille={parseGrilles(options.grilles)} />
        {!condensed && <button className="inline-flex min-h-11 items-center gap-1 text-sm text-[#20386E] underline underline-offset-2" onClick={()=>setExpanded(value=>!value)} aria-expanded={details} aria-label={`${details?"Hide":"Show"} details for line ${lineNumber}`}>{details?"Hide details":"Show details"}{details?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#305367]">
          <span className="font-medium">Room</span>
          {onUpdate ? <input aria-label={`Room for line ${lineNumber}`} className="min-h-11 min-w-0 flex-1 rounded border border-[#AAB2BE] px-3 text-base sm:text-sm" value={line.room||""} maxLength={250} placeholder="None assigned" disabled={disabled} onChange={event=>onUpdate(index,{room:event.target.value})}/> : <span className="break-words">{line.room||"None assigned"}</span>}
        </div>
        <h3 className="mt-4 break-words text-base font-medium leading-relaxed text-[#305367]">{line.style||"Window"}</h3>
        <p className="mt-1 text-sm leading-relaxed text-[#526B7B]">{line.width} × {line.height} {line.units||"in"} · {line.dimension_basis === "frame" ? "Frame size" : line.dimension_basis === "rough_opening" ? "Rough opening" : "Call size"}</p>
        <p className="mt-1 break-words text-sm leading-relaxed text-[#526B7B]">{selectedSeries(line)}</p>
        {frame?.width && frame?.height && <p className="mt-1 text-sm text-[#526B7B]">Frame: {frame.width} × {frame.height} {frame.units||line.units||"in"}</p>}
        <p className="mt-3 break-words text-sm leading-relaxed text-[#526B7B]">{colors.exterior} exterior / {colors.interior} interior</p>
        {details && <div className="mt-3 space-y-3">
          <p className="break-words text-sm leading-7 text-[#526B7B]">{entries.map(([key,value])=>`${optionLabels[key]}: ${specificationValue(key,value,options)}`).join(" · ")}</p>
          {(line.notes || line.description) && <div className="border-l-2 border-[#D8E2EA] pl-3"><p className="mb-1 text-xs font-semibold text-[#526B7B]">Notes</p><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#526B7B]">{line.notes||line.description}</p></div>}
          {additional.length > 0 && <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-[#526B7B]">Additional specifications</summary><dl className="grid gap-3 text-xs sm:grid-cols-2">{additional.map(([label,value])=><div key={label} className="min-w-0"><dt className="capitalize text-[#7A8B97]">{label}</dt><dd className="mt-1 break-words text-[#526B7B]">{value}</dd></div>)}</dl></details>}
          {price?.pricing_evidence?.source === "amsco_source_engine" && <details><summary className="min-h-11 cursor-pointer py-3 text-xs text-[#526B7B]">Pricebook breakdown</summary><dl className="space-y-2 text-xs">{(price.pricing_evidence.components||[]).map((component,i)=><div key={i} className="flex justify-between gap-3"><dt>{component.name}</dt><dd>{money(component.value,currency)}</dd></div>)}</dl></details>}
        </div>}
      </div>
      <div className="amsco-line-prices">
        <label className="mb-2 block text-sm font-medium text-[#305367]" htmlFor={`line-qty-${line.id||index}`}>Qty</label>
        {onUpdate ? <div className="flex h-11 rounded border border-[#8C969D]">
          <button className="inline-flex min-w-11 items-center justify-center disabled:opacity-30" disabled={disabled||Number(line.qty)<=1} aria-label={`Decrease quantity for line ${lineNumber}`} onClick={()=>changeQty(Math.max(1,(Number(line.qty)||1)-1))}><Minus size={17}/></button>
          <input id={`line-qty-${line.id||index}`} aria-label={`Quantity for line ${lineNumber}`} type="number" inputMode="numeric" min={1} max={1000} step={1} value={line.qty??""} disabled={disabled} onChange={event=>changeQty(event.target.value===""?"":Number(event.target.value))} className="min-w-0 flex-1 border-x border-[#8C969D] text-center text-base tabular-nums" />
          <button className="inline-flex min-w-11 items-center justify-center disabled:opacity-30" disabled={disabled||Number(line.qty)>=1000} aria-label={`Increase quantity for line ${lineNumber}`} onClick={()=>changeQty(Math.min(1000,(Number(line.qty)||0)+1))}><Plus size={17}/></button>
        </div> : <p className="flex min-h-11 items-center justify-center rounded border border-[#AAB2BE] text-sm tabular-nums text-[#305367]">{line.qty??"—"}</p>}
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-4">
          {["list","dealer","customer"].map(kind=><div key={kind} className="contents">
            <div><div className="mb-1.5 text-xs text-[#526B7B]">{kind[0].toUpperCase()+kind.slice(1)}</div><div className="rounded bg-[#F0F1F3] px-2 py-2.5 text-right text-sm tabular-nums text-[#305367]">{money(price?.unit_prices?.[kind],currency)}</div></div>
            <div><div className="mb-1.5 text-xs text-[#526B7B]">Ext. {kind[0].toUpperCase()+kind.slice(1)}</div><div className={`rounded px-2 py-2.5 text-right text-sm tabular-nums ${kind==="customer"?"bg-[#EAF5EE] font-semibold text-[#276449]":"bg-[#F0F1F3] text-[#305367]"}`}>{money(price?.line_totals?.[kind],currency)}</div></div>
          </div>)}
        </div>
        <p className="mt-3 text-xs text-[#687D8B]" aria-live="polite">{priceLabel(price)}</p>
      </div>
    </div>
  </article>;
}

export default function AmscoQuoteSchedule({lines,settings={},prices=[],disabled=false,onEdit,onCopy,onRemove,onUpdate,currency="USD"}) {
  const [search,setSearch] = useState("");
  const [condensed,setCondensed] = useState(false);
  const rows = lines.map((line,index)=>({line,index,price:prices[index]})).filter(({line,index})=>[(index+1)*100,line.native_line_number,line.style,line.room,line.mark,line.notes,line.description,line.width+" x "+line.height].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="min-w-0">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <label className="flex min-h-11 items-center gap-2 text-sm text-[#526B7B]"><input type="checkbox" checked={condensed} onChange={event=>setCondensed(event.target.checked)} className="h-5 w-5 accent-[#20386E]"/>Condensed view</label>
      <label className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded border border-[#AAB2BE] bg-white px-3 sm:max-w-md"><Search size={17} className="shrink-0 text-[#687D8B]"/><input aria-label="Filter quote line items" type="search" placeholder="Line number, room, description" value={search} onChange={event=>setSearch(event.target.value)} className="w-full min-w-0 bg-transparent text-base outline-none sm:text-sm"/></label>
    </div>
    <div className="space-y-3">{rows.map(({line,index,price})=><WindowLine key={line.id||line.native_line_id||index} line={line} index={index} settings={settings} price={price} disabled={disabled} condensed={condensed} onEdit={onEdit} onCopy={onCopy} onRemove={onRemove} onUpdate={onUpdate} currency={currency}/>)}</div>
    {!rows.length&&<p className="rounded border border-[#CCD2D9] bg-white px-4 py-8 text-center text-sm text-[#687D8B]">{lines.length?"No line items match your filter.":"Add a window to build this quote."}</p>}
    {!!rows.length&&<p className="mt-3 text-xs leading-relaxed text-[#7A8B97]">Window illustrations show the selected configuration. Final construction and ratings come from AMSCO.</p>}
  </div>;
}
