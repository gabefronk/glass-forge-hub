import { useRef, useState } from "react";
import { Plus, Upload, Trash2, FileSpreadsheet, ChevronDown } from "lucide-react";
import { emptyLine, parseTakeoff, validateLines, CSV_TEMPLATE, MAX_LINES } from "./takeoff";

export const inputClass = "w-full rounded-lg border border-[#CBD4E1] bg-white px-3 py-2 text-sm text-[#131A26] outline-none focus:border-[#2A5EA8] focus:ring-2 focus:ring-[#E7EEFA] disabled:bg-[#F6F8FC] disabled:text-[#77839A]";
export const secondaryClass = "inline-flex items-center justify-center gap-2 rounded-lg border border-[#DDE3EC] bg-white px-3 py-2 text-sm font-medium text-[#535E72] hover:bg-[#F6F8FC] disabled:opacity-50 disabled:cursor-not-allowed";

function Field({ label, children }) {
  return <label className="block min-w-0"><span className="mb-1 block text-xs font-medium text-[#616D81]">{label}</span>{children}</label>;
}

export default function TakeoffEditor({ lines, onChange, source, onSourceChange, disabled = false }) {
  const upload = useRef(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [parseError, setParseError] = useState("");
  const errors = validateLines(lines);
  const update = (index, patch) => onChange(lines.map((line, i) => i === index ? { ...line, ...patch } : line));
  const importText = (text, name) => {
    try {
      const parsed = parseTakeoff(text, name);
      onChange(parsed.lines); onSourceChange?.(parsed.source);
      setParseError(""); setPasteOpen(false);
    } catch (error) { setParseError(error.message); }
  };
  const readUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!/\.(csv|json)$/i.test(file.name)) { setParseError("Upload a CSV or JSON takeoff. PDF plans need a checked window schedule first."); return; }
    if (file.size > 2_000_000) { setParseError("Keep takeoffs under 2 MB."); return; }
    try { importText(await file.text(), file.name); } catch { setParseError("This file could not be read. Try a CSV or JSON text file."); }
  };
  const total = lines.reduce((sum, line) => sum + (Number.isInteger(Number(line.qty)) && Number(line.qty) > 0 ? Number(line.qty) : 0), 0);
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-semibold text-[#131A26]">Window schedule</h3><p className="text-xs text-[#616D81]">{lines.length ? `${lines.length} lines · ${total} windows / assemblies` : "Add checked takeoff data, or describe your windows in the conversation."}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={secondaryClass} disabled={disabled || lines.length >= MAX_LINES} onClick={() => onChange([...lines, emptyLine()])}><Plus size={14} />Add line</button>
        <button type="button" className={secondaryClass} disabled={disabled} onClick={() => setPasteOpen(!pasteOpen)}><FileSpreadsheet size={14} />Paste</button>
        <button type="button" className={secondaryClass} disabled={disabled} onClick={() => upload.current?.click()}><Upload size={14} />Upload</button>
        <input ref={upload} className="hidden" type="file" accept=".csv,.json,application/json,text/csv" onChange={readUpload} aria-label="Upload CSV or JSON window takeoff" />
      </div>
    </div>
    {source?.filename && <p className="text-xs text-[#616D81] break-all">Source: {source.filename}</p>}
    {pasteOpen && <div className="space-y-2 rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-3">
      <label className="block text-xs font-medium text-[#535E72]" htmlFor="takeoff-paste">Paste CSV or a JSON array of window lines</label>
      <textarea id="takeoff-paste" className={inputClass + " min-h-36 font-mono text-xs"} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={CSV_TEMPLATE} disabled={disabled} />
      <div className="flex flex-wrap items-center gap-2"><button type="button" className={secondaryClass} onClick={() => importText(raw)} disabled={disabled}>Preview takeoff</button><span className="text-xs text-[#616D81]">Replaces the current schedule after parsing.</span></div>
      <details className="text-xs text-[#616D81]"><summary className="cursor-pointer">Accepted columns and format</summary><p className="mt-2">Required: style, width, height, dimension_basis (frame, call, rough_opening), units (in), qty. Optional: mark, room, series, color, operation, glass, glass_thickness, glazing_method, tempered, hardware, screen, elevation, fin, viewing_direction. JSON may include an options object and source references. Quote CSV cells containing commas. Confirm the dimension basis and quantities from your takeoff.</p></details>
    </div>}
    {parseError && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{parseError}</p>}
    <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">
      {lines.map((line, index) => <details key={index} open={lines.length === 1 || undefined} className="group rounded-xl border border-[#DDE3EC] bg-white">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#E7EEFA] text-xs font-semibold text-[#1E4A85]">{index + 1}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-[#131A26]">{line.mark ? `${line.mark} · ` : ""}{line.style || "Window details needed"}</span><span className="text-xs text-[#616D81]">{line.width || "—"} × {line.height || "—"} {line.units || "units?"} · Qty {line.qty || "—"} · {(line.dimension_basis || "Choose dimension basis").replaceAll("_", " ")}</span></span>
          <ChevronDown size={15} className="text-[#77839A] group-open:rotate-180" />
        </summary>
        <div className="space-y-3 border-t border-[#E9EDF4] px-3 py-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Window mark"><input className={inputClass} value={line.mark || ""} disabled={disabled} onChange={(e) => update(index, { mark: e.target.value })} /></Field>
            <Field label="Style *"><input className={inputClass} placeholder="Single Vent, Single Hung…" value={line.style || ""} disabled={disabled} onChange={(e) => update(index, { style: e.target.value })} /></Field>
            <Field label="Quantity *"><input className={inputClass} type="number" min="1" step="1" value={line.qty ?? ""} disabled={disabled} onChange={(e) => update(index, { qty: e.target.value })} /></Field>
            <Field label="Width (inches) *"><input className={inputClass} type="number" min="0.001" step="any" value={line.width ?? ""} disabled={disabled} onChange={(e) => update(index, { width: e.target.value })} /></Field>
            <Field label="Height (inches) *"><input className={inputClass} type="number" min="0.001" step="any" value={line.height ?? ""} disabled={disabled} onChange={(e) => update(index, { height: e.target.value })} /></Field>
            <Field label="Dimension basis *"><select className={inputClass} value={line.dimension_basis || ""} disabled={disabled} onChange={(e) => update(index, { dimension_basis: e.target.value })}><option value="">Choose…</option><option value="frame">Frame size</option><option value="call">Call size</option><option value="rough_opening">Rough opening</option></select></Field>
            <Field label="Room"><input className={inputClass} value={line.room || ""} disabled={disabled} onChange={(e) => update(index, { room: e.target.value })} /></Field>
            <Field label="Units *"><select className={inputClass} value={line.units || ""} disabled={disabled} onChange={(e) => update(index, { units: e.target.value })}><option value="">Confirm units…</option><option value="in">Inches</option>{line.units && line.units !== "in" && <option value={line.units}>{line.units} — convert dimensions</option>}</select></Field>
          </div>
          <p className="text-xs text-[#616D81]">Enter specified options; leave unknowns blank for review.</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[["series", "Series / fin"], ["color", "Color"], ["operation", "Operation"], ["glass", "Glass"], ["glass_thickness", "Glass thickness"], ["glazing_method", "Glazing"], ["tempered", "Tempered"], ["hardware", "Hardware"], ["screen", "Screen"], ["elevation", "Elevation"], ["viewing_direction", "Viewing direction"]].map(([field, label]) => <Field key={field} label={label}><input className={inputClass} value={String(line.options?.[field] ?? "")} disabled={disabled} onChange={(e) => update(index, { options: { ...line.options, [field]: e.target.value } })} /></Field>)}
          </div>
          <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#8A4038]" disabled={disabled} onClick={() => onChange(lines.filter((_, i) => i !== index))}><Trash2 size={13} />Remove line</button>
        </div>
      </details>)}
    </div>
    {errors.length > 0 && <div role="alert" className="rounded-lg border border-[#EEDAB4] bg-[#FCF5E9] p-3 text-xs text-[#8A5A10]"><strong>Check these details before saving:</strong><ul className="mt-1 list-disc space-y-1 pl-4">{errors.slice(0, 12).map((error) => <li key={error}>{error}</li>)}</ul>{errors.length > 12 && <p className="mt-1">And {errors.length - 12} more issues.</p>}</div>}
  </section>;
}
