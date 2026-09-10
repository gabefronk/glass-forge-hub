import { useId, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { AMSCO_SERIES, GRILLE_TYPES, selectedSeries, stylesForSeries, changeSeries, colorParts, changeColor, parseGrilles, serializeGrilles, diagramPanels } from "./amscoConfiguratorModel";

const steps = ["Product Selection", "Size & Unit Details", "Design Options", "Advanced Options", "Grilles", "Installation Options", "Service", "Informational Values", "Ratings", "Line Level Attributes"];
const input = "min-h-11 w-full min-w-0 rounded border border-[#aab8c3] bg-white px-3 py-2 text-base text-[#263b49] focus:border-[#19718d] focus:outline-none focus:ring-2 focus:ring-[#19718d]/20 disabled:opacity-60 sm:text-sm";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded border border-[#b8c6cf] bg-white px-3 py-2 text-sm font-semibold text-[#305367] disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded border border-[#196c86] bg-[#196c86] px-4 py-2 text-sm font-semibold text-white hover:bg-[#145b71] disabled:opacity-50";
const money = value => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : "—";
function Row({ label, children, note }) {
  const id = useId();
  return <div className="grid min-w-0 gap-2 border-b border-[#e5eaee] px-4 py-3 odd:bg-[#f1f4f6] sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] sm:items-center">
    <label htmlFor={id} className="text-sm font-medium text-[#344f60]">{label}</label><div className="min-w-0">{children(id)}{note && <p className="mt-1 text-xs leading-relaxed text-[#687e8b]">{note}</p>}</div>
  </div>;
}
function SelectRow({ label, value, choices, onChange, note }) {
  const all = choices.map(choice => typeof choice === "string" ? { value: choice, label: choice } : choice);
  if (value !== undefined && value !== "" && !all.some(choice => String(choice.value) === String(value))) all.push({ value, label: String(value) });
  return <Row label={label} note={note}>{id => <select id={id} className={input} value={value ?? ""} onChange={e => onChange(e.target.value)}>{all.map(choice => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select>}</Row>;
}
function TextRow({ label, value, onChange, ...rest }) { return <Row label={label}>{id => <input id={id} className={input} value={value ?? ""} onChange={e => onChange(e.target.value)} {...rest} />}</Row>; }
function Note({ children }) { return <p className="px-4 py-4 text-sm leading-relaxed text-[#647c8b]">{children}</p>; }
function WindowDrawing({ line, settings, grille }) {
  const { columns, rows, kind } = diagramPanels(line);
  const ratio = Math.min(2.6, Math.max(.35, (Number(line.width) || 36) / (Number(line.height) || 60)));
  const width = Math.min(236, 220 * ratio), height = width / ratio, x = (300 - width) / 2, y = 40;
  const pair = colorParts(line.options, settings), frame = /black/i.test(pair.exterior) ? "#272b2e" : /taupe/i.test(pair.exterior) ? "#ad9f8e" : "#fff";
  const panels = Array.from({ length: columns * rows }, (_, i) => ({ x: x + 9 + i % columns * (width - 18) / columns, y: y + 9 + Math.floor(i / columns) * (height - 18) / rows, w: (width - 18) / columns, h: (height - 18) / rows, i }));
  return <svg role="img" aria-label={(line.style || "Window") + " illustration"} viewBox={"0 0 300 " + (height + 88)} className="mx-auto max-h-72 w-full max-w-80" fill="none">
    <rect x={x} y={y} width={width} height={height} fill={frame} stroke="#607786" strokeWidth="1.4" />
    {kind === "custom" ? <text x="150" y={y + height / 2} textAnchor="middle" fill="#526e7e" fontSize="12">Illustration pending</text> : panels.map(p => {
      const gw = grille.mode === "rectangular" ? Math.min(12, Number(grille.wide)) : 1, gh = grille.mode === "rectangular" && grille.scope === "lite" ? Math.min(12, Number(grille.high)) : 1;
      const fixed = /fixed/i.test(line.options?.operation || ""), right = /^right|^rh$/i.test(line.options?.operation || "") || /left\s*\/\s*right/i.test(line.options?.operation || "") && p.i % 2 === 1;
      return <g key={p.i}>
        <rect x={p.x + 3} y={p.y + 3} width={p.w - 6} height={p.h - 6} fill="#e8f4fa" stroke="#627e8f" />
        {Array.from({ length: gw - 1 }, (_, n) => <line key={"v" + n} x1={p.x + p.w * (n + 1) / gw} x2={p.x + p.w * (n + 1) / gw} y1={p.y + 3} y2={p.y + p.h - 3} stroke={frame} strokeWidth="3" />)}
        {Array.from({ length: gh - 1 }, (_, n) => <line key={"h" + n} x1={p.x + 3} x2={p.x + p.w - 3} y1={p.y + p.h * (n + 1) / gh} y2={p.y + p.h * (n + 1) / gh} stroke={frame} strokeWidth="3" />)}
        {kind === "casement" && !fixed && <polyline points={right ? [p.x + 7, p.y + 7, p.x + p.w - 7, p.y + p.h / 2, p.x + 7, p.y + p.h - 7].join(" ") : [p.x + p.w - 7, p.y + 7, p.x + 7, p.y + p.h / 2, p.x + p.w - 7, p.y + p.h - 7].join(" ")} stroke="#6c8999" strokeDasharray="5 3" />}
        {kind === "awning" && !fixed && <polyline points={[p.x + 7, p.y + p.h - 7, p.x + p.w / 2, p.y + 7, p.x + p.w - 7, p.y + p.h - 7].join(" ")} stroke="#6c8999" strokeDasharray="5 3" />}
        {kind === "hung" && p.i === 1 && <text x={p.x + p.w / 2} y={p.y + p.h / 2} fill="#526e7e" textAnchor="middle">↑</text>}
        {kind === "slider" && p.i === (/^ox$/i.test(line.options?.operation || "") ? columns - 1 : 0) && <text x={p.x + p.w / 2} y={p.y + p.h / 2} fill="#526e7e" textAnchor="middle">{/^ox$/i.test(line.options?.operation || "") ? "←" : "→"}</text>}
      </g>;
    })}
    <line x1={x} x2={x + width} y1="24" y2="24" stroke="#91a4b0" /><text x="150" y="18" fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} in</text>
    <text x="150" y={height + 66} fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} × {line.height || "—"} in · {line.dimension_basis || "call"}</text>
  </svg>;
}
export default function AmscoWindowConfigurator({ line, index, settings, disabled, tradeCode, onTradeCode, onApplyTradeCode, onChange, onOption, onCancel, onSave, price, priceStatus }) {
  const [step, setStep] = useState(0), [customGrille, setCustomGrille] = useState(false);
  const stepRef = useRef(null), uid = useId();
  const series = selectedSeries(line), styles = stylesForSeries(series), options = line.options || {}, colors = colorParts(options, settings), grilles = parseGrilles(options.grilles), panel = diagramPanels(line);
  const chooseStep = next => { setStep(next); requestAnimationFrame(() => stepRef.current?.querySelector('[data-step="' + next + '"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })); };
  const optionRow = (label, key, choices, standard = "Use AMSCO standard") => <SelectRow label={label} value={options[key] ?? ""} choices={[{ value: "", label: standard }, ...choices]} onChange={value => onOption(key, value)} />;
  const boolRow = (label, key) => <SelectRow label={label} value={options[key] === undefined ? "" : String(options[key])} choices={[{ value: "", label: "Use AMSCO standard" }, { value: "false", label: "No" }, { value: "true", label: "Yes" }]} onChange={value => onOption(key, value === "" ? "" : value === "true")} />;
  const updateGrilles = patch => onOption("grilles", serializeGrilles({ type: GRILLE_TYPES[0], wide: 2, high: 4, scope: "lite", color: colors.exterior, ...grilles, ...patch }));
  return <section className="min-w-0 rounded-lg border border-[#bdcbd4] bg-white shadow-sm" aria-label="AMSCO window configurator">
    <div className="flex items-center justify-between gap-3 rounded-t-lg bg-[#405e70] px-4 py-3 text-white"><div><p className="text-[10px] uppercase tracking-widest text-[#d0e1eb]">Glass Forge · AMSCO</p><h2 className="mt-0.5 text-base font-semibold">{index < 0 ? "Configure a window" : "Edit window " + (index + 1)}</h2></div><button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-white/10" onClick={onCancel} disabled={disabled} aria-label="Cancel window edit"><X size={20} /></button></div>
    <div ref={stepRef} role="tablist" aria-label="Window configuration steps" className="flex min-w-0 overflow-x-auto border-b border-[#c8d3da] bg-[#edf1f4]">{steps.map((label, n) => <button type="button" role="tab" id={uid + "-tab-" + n} aria-controls={uid + "-panel"} aria-selected={step === n} data-step={n} key={label} disabled={disabled} onClick={() => chooseStep(n)} className={"inline-flex min-h-14 shrink-0 items-center gap-2 border-r border-[#c8d3da] px-3 py-2 text-left text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#196c86] " + (step === n ? "bg-[#196c86] text-white" : "text-[#426172] hover:bg-[#dfe9ef]")}><span className={"flex h-5 w-5 items-center justify-center rounded-full text-[10px] " + (step === n ? "bg-white/20" : "bg-white")}>{n + 1}</span><span className="max-w-28">{label}</span><ChevronRight size={13} /></button>)}</div>
    <div className="grid min-w-0 lg:grid-cols-[minmax(0,.75fr)_minmax(0,1.25fr)]">
      <aside className="min-w-0 border-b border-[#d9e2e8] bg-[#fafcfd] px-4 py-4 lg:border-b-0 lg:border-r" aria-label="Window preview">
        <div className="grid grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] items-center gap-3 lg:grid-cols-1"><WindowDrawing line={line} settings={settings} grille={grilles} /><div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-[#6e8390]">Product summary</p><p className="mt-1 break-words text-sm font-semibold text-[#2e4f62]">{styles.find(item => item.value === line.style)?.label || line.style || "Choose a product"}</p><p className="mt-1 break-words text-xs text-[#6e8390]">{AMSCO_SERIES.find(item => item.value === series)?.label || series}</p><p className="mt-2 text-xs text-[#526d7d]">{colors.exterior} exterior / {colors.interior} interior</p>{options.tempered === true && <p className="mt-1 text-xs font-semibold text-[#526d7d]">Tempered glass</p>}</div></div>
        <div className="mt-4 border-t border-[#d9e2e8] pt-3" aria-live="polite"><p className="text-xs font-semibold text-[#526d7d]">Customer price · each</p>{priceStatus === "loading" || ["calculating", "native_busy"].includes(price?.status) ? <p className="mt-2 flex items-center gap-2 text-sm text-[#6e8390]"><Loader2 size={15} className="animate-spin" />{price?.status === "calculating" ? "Calculating AMSCO price…" : price?.status === "native_busy" ? "Waiting for pricing…" : "Checking price…"}</p> : price?.status === "priced" ? <><p className="mt-1 text-2xl font-semibold text-[#286a54]">{money(price.unit_prices?.customer)}</p><p className="mt-1 text-xs text-[#6e8390]">{price.price_source === "native_live" ? "Verified AMSCO configuration" : "Previously verified configuration"} · {money(price.line_totals?.customer)} for this quantity</p></> : <p className="mt-2 text-sm leading-relaxed text-[#687e8b]">{price?.status === "amsco_lookup_needed" ? "These selections need an AMSCO online quote." : price?.status === "native_calculation_needed" ? "Supported by the AMSCO pricing engine." : priceStatus === "unavailable" || price?.status === "native_unavailable" ? "Live pricing is unavailable. Your selections are still here." : "Choose the product and enter its size."}</p>}</div>
        <p className="mt-3 text-[11px] leading-relaxed text-[#8194a0]">Illustration only. Final construction and ratings come from AMSCO.</p>
      </aside>
      <div className="min-w-0" role="tabpanel" id={uid + "-panel"} aria-labelledby={uid + "-tab-" + step}><h3 className="border-b border-[#d9e2e8] px-4 py-4 text-base font-semibold text-[#305367]">{steps[step]}</h3><fieldset disabled={disabled} className="min-w-0"><legend className="sr-only">{steps[step]}</legend>
        {step === 0 && <>
          <SelectRow label="Series" value={series} choices={[{ value: "", label: "Select a series" }, ...AMSCO_SERIES]} onChange={value => onChange(changeSeries(line, value))} />
          <SelectRow label="Style" value={line.style} choices={[{ value: "", label: "Select a style" }, ...styles, { value: "Custom", label: "Other product" }]} onChange={value => onChange({ style: value })} />
          {(!styles.length || line.style === "Custom" || line.style && !styles.some(item => item.value === line.style)) && <TextRow label="Requested product" value={line.style === "Custom" ? "" : line.style} placeholder="Enter the AMSCO product" maxLength={250} onChange={value => onChange({ style: value || "Custom" })} />}
          <Note>Choose the series and style used in AMSCO. Standard construction stays automatic; change only the options required for this job.</Note>
        </>}
        {step === 1 && <>
          <SelectRow label="Measurement Type" value={line.dimension_basis || "call"} choices={[{ value: "call", label: "Call" }, { value: "frame", label: "Frame" }, { value: "rough_opening", label: "Rough opening" }]} onChange={value => { onTradeCode(""); onChange({ dimension_basis: value }); }} note="Use the measurement basis recorded on site." />
          <Row label="Quick Call Code" note="3050 = 36 × 60 in. Applying a code selects Call measurements.">{id => <div className="flex gap-2"><input id={id} className={input} inputMode="numeric" maxLength={4} placeholder="3050" value={tradeCode} onChange={e => onTradeCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onApplyTradeCode(); } }} /><button type="button" className={button + " shrink-0"} onClick={onApplyTradeCode} disabled={!tradeCode.trim()}>Apply</button></div>}</Row>
          <TextRow label="Width (in)" value={line.width} type="number" inputMode="decimal" min=".001" step="any" onChange={value => { onTradeCode(""); onChange({ width: value }); }} />
          <TextRow label="Height (in)" value={line.height} type="number" inputMode="decimal" min=".001" step="any" onChange={value => { onTradeCode(""); onChange({ height: value }); }} />
          {["casement", "awning"].includes(panel.kind) && <><SelectRow label="Number Wide" value={options.number_wide ?? ""} choices={[{ value: "", label: "Use AMSCO standard" }, "1", "2"]} onChange={value => onOption("number_wide", value === "" ? "" : Number(value))} />{optionRow("Operation", "operation", Number(options.number_wide) === 2 ? ["Left / Right", "Fixed / Fixed"] : ["Left", "Right", "Fixed"])}</>}
          {panel.kind === "slider" && optionRow("Operation", "operation", ["XO", "OX"])}
          <TextRow label="Room / Location" value={line.room} maxLength={250} placeholder="Kitchen" onChange={value => onChange({ room: value })} />
        </>}
        {step === 2 && <>
          <SelectRow label="Exterior Color" value={colors.exterior} choices={["White", "Taupe", "Black"]} onChange={value => onChange({ options: changeColor(options, settings, "exterior", value) })} />
          <SelectRow label="Interior Color" value={colors.interior} choices={["White", "Taupe", "Black"]} onChange={value => onChange({ options: changeColor(options, settings, "interior", value) })} />
          {boolRow("Tempered", "tempered")}{optionRow("Glass", "glass", ["CozE (LowE)"], "Use quote default · " + (settings.glass || "AMSCO standard"))}{optionRow("Patterned Glass", "patterned_glass", ["None", "Obscure"])}{boolRow("Argon", "argon")}{optionRow("Elevation", "elevation", ["None", "Above 8001", "6501 to 8000", "2501 to 6500", "1001 to 2500", "Below 1000"])}{boolRow("Super Spacer", "super_spacer")}
        </>}
        {step === 3 && <><Note>Leave these on AMSCO standard unless the job requires an override. AMSCO chooses glass construction appropriate to the product and size.</Note>{optionRow("Glazing Method", "glazing_method", ["3/4 Insulated"])}{optionRow("Glass Thickness", "glass_thickness", ["SS", "DS"])}{boolRow("Capillary Tubes", "capillary_tubes")}{optionRow("Hardware Color", "hardware_color", ["White", "Taupe", "Black"])}{optionRow("Screen", "screen", ["White", "Taupe", "Black", "None"])}</>}
        {step === 4 && <>
          <SelectRow label="Grille Pattern" value={customGrille ? "custom" : grilles.mode} choices={[{ value: "standard", label: "Use AMSCO standard" }, { value: "none", label: "None" }, { value: "rectangular", label: "Rectangular" }, { value: "custom", label: "Custom / existing specification" }]} onChange={mode => { setCustomGrille(mode === "custom"); if (mode !== "custom") updateGrilles({ mode }); }} />
          {!customGrille && grilles.mode === "rectangular" && <>
            <SelectRow label="Grille Type" value={grilles.type} choices={GRILLE_TYPES} onChange={type => updateGrilles({ type })} />
            <SelectRow label="Grille Color" value={grilles.color} choices={["White", "Taupe", "Black"]} onChange={color => updateGrilles({ color })} />
            <SelectRow label="Lites Wide" value={String(grilles.wide)} choices={Array.from({ length: 12 }, (_, n) => String(n + 1))} onChange={wide => updateGrilles({ wide: Number(wide) })} />
            <SelectRow label="Lites High" value={String(grilles.high)} choices={Array.from({ length: 12 }, (_, n) => String(n + 1))} onChange={high => updateGrilles({ high: Number(high) })} />
            <SelectRow label="Apply Pattern To" value={grilles.scope} choices={[{ value: "lite", label: "Each sash / panel" }, { value: "window", label: "Whole window" }]} onChange={scope => updateGrilles({ scope })} />
            <Note>{grilles.wide} wide × {grilles.high} high = {grilles.wide * grilles.high} lites {grilles.scope === "lite" ? "in each sash or panel. A slider uses the pattern on both panels." : "across the whole window. AMSCO will confirm bar alignment between sashes."}</Note>
          </>}
          {(customGrille || grilles.mode === "custom") && <Row label="Grille Specification">{id => <textarea id={id} className={input + " min-h-28"} value={options.grilles || ""} maxLength={500} onChange={e => onOption("grilles", e.target.value)} />}</Row>}
        </>}
        {step === 5 && <>{optionRow("Installation Fin", "fin", ["Nail Fin", "Flush Fin"], "Use selected series standard")}<Note>The frame series determines the standard installation setup. Explicit installation requirements are retained for AMSCO to verify.</Note></>}
        {step === 6 && <Note>This configurator builds new windows. Describe service, replacement parts or special installation requirements in the AI guide so they stay with the quote.</Note>}
        {step === 7 && <Note>Final frame dimensions, glass construction and manufacturing values will appear in the verified AMSCO result.</Note>}
        {step === 8 && <Note>U-factor, SHGC, visible transmittance, performance grade and certification values come from AMSCO after pricing. They are not estimated here.</Note>}
        {step === 9 && <><TextRow label="Location" value={line.room} maxLength={250} onChange={value => onChange({ room: value })} /><TextRow label="Window Mark" value={line.mark} maxLength={100} placeholder="W1" onChange={value => onChange({ mark: value })} /><Note>Location and mark identify this line on your window schedule.</Note></>}
      </fieldset><div className="flex flex-wrap justify-between gap-2 px-4 py-4"><button type="button" className={button} disabled={disabled || step === 0} onClick={() => chooseStep(step - 1)}><ArrowLeft size={15} />Back</button>{step < steps.length - 1 && <button type="button" className={button} disabled={disabled} onClick={() => chooseStep(step + 1)}>Next<ArrowRight size={15} /></button>}</div></div>
    </div>
    <div className="sticky bottom-24 z-10 flex flex-wrap items-end justify-between gap-3 rounded-b-lg border-t border-[#bdcbd4] bg-white px-4 py-3 shadow-[0_-2px_8px_#00000008] sm:bottom-4"><label className="w-24 text-xs font-semibold text-[#526d7d]">Qty<input className={input + " mt-1"} type="number" inputMode="numeric" min="1" max="1000" step="1" value={line.qty ?? 1} disabled={disabled} onChange={e => onChange({ qty: e.target.value })} /></label><button type="button" className={primary} disabled={disabled} onClick={onSave}>{index < 0 ? <Plus size={17} /> : <Check size={17} />}{index < 0 ? "Add to Quote" : "Save Window"}</button></div>
  </section>;
}

