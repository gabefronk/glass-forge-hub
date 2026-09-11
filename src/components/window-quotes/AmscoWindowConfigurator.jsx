import { useId, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Copy, List, Loader2, Plus, RotateCcw, X, ZoomIn } from "lucide-react";
import { GLASS_THICKNESS_CHOICES, automaticOptionLabel, glassSpecification, resolvedWindowOptions, specificationValue } from "./windowSpecificationDisplay";
import { AMSCO_SERIES, GRILLE_TYPES, selectedSeries, stylesForSeries, colorParts, changeColor, parseGrilles, serializeGrilles, diagramPanels } from "./amscoConfiguratorModel";
import { CONFIGURATOR_PAGES, COZE_CHOICES, newConfiguratorLine, numberWideChoices, changeProduct, changeConfiguratorSeries, changeNumberWide, callSizeMenu, chooseCallWidth, configurationReadiness, frameSize } from "./amscoConfiguratorFlow";
import "./amscoConfigurator.css";

const input = "amsco-select";
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded border border-[#8c969d] bg-white px-3 py-2 text-sm text-[#40525e] hover:bg-[#f5f7fa] disabled:cursor-not-allowed disabled:opacity-40";
const primary = button + " !border-[#247d9d] !bg-[#247d9d] !text-white";
const money = value => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : "—";
function Row({ label, children, note = "", required = false }) {
  const id = useId();
  return <div className="amsco-row"><label htmlFor={id} className="amsco-row-label">{required && <AlertTriangle size={16} className="text-[#d83c50]" aria-label="Selection required" />}{label}</label><div className="amsco-row-value">{children(id)}{note && <p className="mt-2 text-xs leading-relaxed text-[#75838c]">{note}</p>}</div></div>;
}
function SelectRow({ label, value, choices, onChange, note = "", disabled = false, required = false }) {
  const all = choices.map(choice => typeof choice === "object" ? choice : { value: choice, label: String(choice) });
  if (value !== undefined && value !== "" && !all.some(choice => String(choice.value) === String(value))) all.push({ value, label: String(value) + " (saved selection)" });
  // When the inherited value has the same label as a selectable value, show it
  // once and retain the currently selected value so saved overrides stay intact.
  const unique = [...new Set(all.map(choice => choice.label))].map(label => all.find(choice => choice.label === label && String(choice.value) === String(value ?? "")) || all.find(choice => choice.label === label));
  return <Row label={label} note={note} required={required && !value}>{id => <select id={id} className={input} value={value ?? ""} disabled={disabled} aria-required={required} onChange={event => onChange(event.target.value)}>{unique.map(choice => <option key={String(choice.value)} value={choice.value}>{choice.label}</option>)}</select>}</Row>;
}
function TextRow({ label, value, onChange, note = "", ...rest }) { return <Row label={label} note={note}>{id => <input id={id} className={input} value={value ?? ""} onChange={event => onChange(event.target.value)} {...rest} />}</Row>; }
function ReadRow({ label, value, note = "" }) { return <Row label={label} note={note}>{id => <output id={id} className="amsco-readout">{value === "" || value == null ? "Awaiting AMSCO configuration" : String(value)}</output>}</Row>; }
function Note({ children }) { return <p className="mx-4 mb-4 text-sm leading-relaxed text-[#75838c]">{children}</p>; }
function WindowDrawing({ line, settings, grille }) {
  const { rows, kind, columns: baseColumns } = diagramPanels(line);
  const columns = kind === "hung" ? Math.min(6, Number(line.options?.number_wide) || 1) : baseColumns;
  const gradient = useId();
  const ratio = Math.min(2.6, Math.max(.35, (Number(line.width) || 36) / (Number(line.height) || 60)));
  const width = Math.min(236, 220 * ratio), height = width / ratio, x = (300 - width) / 2, y = 40;
  const pair = colorParts(line.options, settings), frame = /black/i.test(pair.exterior) ? "#272B2E" : /taupe/i.test(pair.exterior) ? "#AD9F8E" : "#FFF";
  const panels = Array.from({ length: columns * rows }, (_, index) => ({ x: x + 9 + index % columns * (width - 18) / columns, y: y + 9 + Math.floor(index / columns) * (height - 18) / rows, w: (width - 18) / columns, h: (height - 18) / rows, index }));
  return <svg role="img" aria-label={(line.style || "Window") + " illustration"} viewBox={"0 0 300 " + (height + 88)} className="mx-auto max-h-[460px] w-full max-w-[420px]" fill="none">
    <defs><linearGradient id={gradient} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#b8e1e8" /><stop offset=".6" stopColor="#f9fcff" /><stop offset="1" stopColor="#c9e6ed" /></linearGradient></defs>
    <rect x={x} y={y} width={width} height={height} fill={frame} stroke="#607786" strokeWidth="1.4" />
    {kind === "custom" ? <text x="150" y={y + height / 2} textAnchor="middle" fill="#526E7E" fontSize="12">Illustration pending</text> : panels.map(panel => {
      const grilleWide = grille.mode === "rectangular" ? Math.min(12, Number(grille.wide)) : 1;
      const grilleHigh = grille.mode === "rectangular" && grille.scope === "lite" ? Math.min(12, Number(grille.high)) : 1;
      const fixed = /fixed/i.test(line.options?.operation || "");
      const right = /^right|^rh$/i.test(line.options?.operation || "") || /left\s*\/\s*right/i.test(line.options?.operation || "") && panel.index % 2 === 1;
      return <g key={panel.index}>
        <rect x={panel.x + 3} y={panel.y + 3} width={panel.w - 6} height={panel.h - 6} fill={"url(#" + gradient + ")"} stroke="#627E8F" />
        {Array.from({ length: grilleWide - 1 }, (_, index) => <line key={"v" + index} x1={panel.x + panel.w * (index + 1) / grilleWide} x2={panel.x + panel.w * (index + 1) / grilleWide} y1={panel.y + 3} y2={panel.y + panel.h - 3} stroke={frame} strokeWidth="3" />)}
        {Array.from({ length: grilleHigh - 1 }, (_, index) => <line key={"h" + index} x1={panel.x + 3} x2={panel.x + panel.w - 3} y1={panel.y + panel.h * (index + 1) / grilleHigh} y2={panel.y + panel.h * (index + 1) / grilleHigh} stroke={frame} strokeWidth="3" />)}
        {kind === "casement" && !fixed && <polyline points={right ? [panel.x + 7, panel.y + 7, panel.x + panel.w - 7, panel.y + panel.h / 2, panel.x + 7, panel.y + panel.h - 7].join(" ") : [panel.x + panel.w - 7, panel.y + 7, panel.x + 7, panel.y + panel.h / 2, panel.x + panel.w - 7, panel.y + panel.h - 7].join(" ")} stroke="#6C8999" strokeDasharray="5 3" />}
        {kind === "awning" && !fixed && <polyline points={[panel.x + 7, panel.y + panel.h - 7, panel.x + panel.w / 2, panel.y + 7, panel.x + panel.w - 7, panel.y + panel.h - 7].join(" ")} stroke="#6C8999" strokeDasharray="5 3" />}
        {kind === "hung" && panel.index >= columns && <text x={panel.x + panel.w / 2} y={panel.y + panel.h / 2} fill="#526E7E" textAnchor="middle">↑</text>}
        {kind === "slider" && panel.index === (/^ox$/i.test(line.options?.operation || "") ? columns - 1 : 0) && <text x={panel.x + panel.w / 2} y={panel.y + panel.h / 2} fill="#526E7E" textAnchor="middle">{/^ox$/i.test(line.options?.operation || "") ? "←" : "→"}</text>}
      </g>;
    })}
    <line x1={x} x2={x + width} y1="24" y2="24" stroke="#91A4B0" />
    <text x="150" y="18" fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} in</text>
    <text x="150" y={height + 66} fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} × {line.height || "—"} in · {line.dimension_basis || "call"}</text>
  </svg>;
}

export default function AmscoWindowConfigurator({ line, index, settings, disabled, tradeCode, onTradeCode, onApplyTradeCode, onChange, onOption, onCancel, onSave, price, priceStatus }) {
  const [step, setStep] = useState(0), [visited, setVisited] = useState([0]), [summary, setSummary] = useState(false), [zoom, setZoom] = useState(false);
  const [customGrille, setCustomGrille] = useState(false), [customWidth, setCustomWidth] = useState(false), [customHeight, setCustomHeight] = useState(false);
  const uid = useId(), tabs = useRef(null), heading = useRef(null);
  const [legacyProduct, setLegacyProduct] = useState(index >= 0);
  const series = selectedSeries(line), styles = stylesForSeries(series), options = line.options || {};
  const colors = colorParts(options, settings), grilles = parseGrilles(options.grilles), panel = diagramPanels(line);
  const ready = configurationReadiness(line, { legacy: legacyProduct });
  const menu = callSizeMenu(line, series), heights = menu?.heightsByWidth[String(line.width)] || [];
  const frame = frameSize(line, ready.size ? price : undefined);
  const widthCustom = customWidth || !menu || !!line.width && !menu.widths.includes(Number(line.width));
  const heightCustom = customHeight || !menu || !!line.height && !heights.includes(Number(line.height));
  const productLabel = styles.find(item => item.value === line.style)?.label || line.style || "Product Selection";
  const seriesLabel = AMSCO_SERIES.find(item => item.value === series)?.label || series || "Choose a series";
  const specifications = resolvedWindowOptions(line, settings, ready.size ? price : undefined);
  const glassSummary = glassSpecification(line, settings, ready.size ? price : undefined);
  const canVisit = target => target === 0 || target === 1 && ready.product || target > 1 && ready.size;
  const chooseStep = target => {
    if (!canVisit(target)) return;
    setStep(target); setSummary(false); setVisited(current => [...new Set([...current, target])]);
    requestAnimationFrame(() => {
      tabs.current?.querySelector('[data-step="' + target + '"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
      heading.current?.focus({ preventScroll: true });
    });
  };
  const resetBranch = patch => { setLegacyProduct(false); onTradeCode(""); setCustomWidth(false); setCustomHeight(false); setVisited([0]); onChange(patch); };
  const auto = key => automaticOptionLabel(key, line, settings, ready.size ? price : undefined, priceStatus);
  const optionRow = (label, key, choices) => <SelectRow label={label} value={options[key] ?? ""} choices={[{ value: "", label: auto(key) }, ...choices]} onChange={value => onOption(key, value)} />;
  const boolRow = (label, key) => <SelectRow label={label} value={options[key] === undefined ? "" : String(options[key])} choices={[{ value: "", label: auto(key) }, { value: "false", label: "No" }, { value: "true", label: "Yes" }]} onChange={value => onOption(key, value === "" ? "" : value === "true")} />;
  const updateGrilles = patch => onOption("grilles", serializeGrilles({ type: GRILLE_TYPES[0], wide: 2, high: 4, scope: "lite", color: colors.exterior, ...grilles, ...patch }));
  const pending = !ready.size ? "Complete product and size selections" : "Available with the completed AMSCO configuration";
  const nativeInformation = price?.status === "priced" ? price.informational_values || {} : {};
  const nativeRatings = price?.status === "priced" ? price.ratings || {} : {};
  const review = <div className="space-y-3 p-4"><h3 className="font-semibold">Configuration summary</h3><dl className="space-y-3 text-sm">{[
    ["Series", seriesLabel], ["Style / Operation", productLabel], ["Number Wide", options.number_wide ?? (legacyProduct ? 1 : "Choose number wide")],
    ["Size", line.width && line.height ? line.width + " × " + line.height + " in · " + line.dimension_basis.replaceAll("_", " ") : "Choose width and height"],
    ["Finish", colors.exterior + " exterior / " + colors.interior + " interior"], ["Glass", glassSummary || "Automatic"], ["Quantity", line.qty], ["Location", [line.mark, line.room].filter(Boolean).join(" · ") || "—"]
  ].map(([label, value]) => <div key={label}><dt className="text-xs text-[#75838c]">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
  <details><summary className="min-h-11 cursor-pointer py-3 text-sm">Full configuration details</summary><dl className="space-y-3 text-sm">{Object.entries(specifications).map(([key, value]) => <div key={key}><dt className="text-xs capitalize text-[#75838c]">{key.replaceAll("_", " ")}</dt><dd className="break-words">{specificationValue(key, value, specifications)}</dd></div>)}</dl></details></div>;

  return <section className="amsco-configurator min-w-0 rounded border border-[#bdcbd4] bg-white" aria-label="AMSCO window configurator">
    <div className="flex items-center justify-between gap-3 border-b border-[#e3e7eb] px-4 py-2">
      <div className="text-xs text-[#7b8994]">Glass Forge / Line Items / <span className="text-[#30475b]">{index < 0 ? "Create Line" : "Edit Line " + (index + 1)}</span></div>
      <button type="button" className="flex min-h-10 min-w-10 items-center justify-center" onClick={onCancel} disabled={disabled} aria-label="Cancel window edit"><X size={18} /></button>
    </div>
    <div ref={tabs} role="tablist" aria-label="Window configuration pages" className="amsco-pages">
      {CONFIGURATOR_PAGES.map((label, target) => {
        const complete = target === 0 ? ready.product : target === 1 ? ready.size : visited.includes(target);
        return <button type="button" role="tab" id={uid + "-tab-" + target} aria-controls={uid + "-panel"} aria-selected={step === target} data-step={target} key={label} disabled={disabled || !canVisit(target)} onClick={() => chooseStep(target)} className={"amsco-page " + (step === target ? "active" : visited.includes(target) ? "visited" : "")}>
          {label}{target < 2 && !complete ? <AlertTriangle size={14} aria-label="Needs selection" /> : complete ? <Check size={14} aria-label={target < 2 ? "Selections complete" : "Page visited"} /> : null}
        </button>;
      })}
    </div>
    <div className="amsco-columns">
      <aside className="min-w-0" aria-label="Window preview">
        {ready.product && <h2 className="mb-4 rounded bg-[#cef3fa] px-3 py-3 text-center text-xl font-semibold text-[#627d88]">{AMSCO_SERIES.find(item => item.value === series)?.family} {productLabel}</h2>}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1 text-sm"><div className="flex items-center gap-2">List: <span className="rounded border border-[#263c74] px-3 py-2 text-[#263c74]">{ready.size && price?.status === "priced" ? money(price.unit_prices?.list) : "—"}</span></div><button type="button" className={button} onClick={() => setSummary(value => !value)} aria-expanded={summary}><List size={15} />Summary</button></div>
        {!ready.product ? <div className="flex min-h-44 items-center justify-center rounded border border-[#efefef] p-6 text-center text-sm text-[#607788]">Keep making selections to see an image!</div> :
          <><div className={"py-3 " + (zoom ? "scale-110 my-6" : "")}><WindowDrawing line={line} settings={settings} grille={grilles} /></div><div className="mb-5 flex justify-center"><button type="button" className={button} onClick={() => setZoom(value => !value)}><ZoomIn size={14} />{zoom ? "Zoom Out" : "Zoom In"}</button></div></>}
        {summary && review}
        {ready.product && <div className="mx-2 mt-4 border-t border-[#e4e8ec] pt-4 text-sm" aria-live="polite"><p className="text-xs text-[#7e8b96]">Customer price · each</p>{ready.size && price?.status === "priced" ? <><p className="mt-1 text-2xl font-semibold text-[#276449]">{money(price.unit_prices?.customer)}</p><p className="mt-1 text-xs">{money(price.line_totals?.customer)} for this quantity</p></> : ready.size && (priceStatus === "loading" || ["calculating", "native_busy"].includes(price?.status)) ? <p className="mt-2 flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Checking AMSCO price…</p> : <p className="mt-2 text-xs leading-relaxed">{ready.size ? "This configuration will be checked for AMSCO pricing." : "Choose width and height to see pricing."}</p>}<p className="mt-4 text-[11px] text-[#8a98a2]">Illustration only. Final construction and ratings come from AMSCO.</p></div>}
      </aside>
      <div className="min-w-0" role="tabpanel" id={uid + "-panel"} aria-labelledby={uid + "-tab-" + step}>
        <h3 ref={heading} tabIndex={-1} className="sr-only">{CONFIGURATOR_PAGES[step]}</h3>
        <fieldset disabled={disabled} className="min-w-0"><legend className="sr-only">{CONFIGURATOR_PAGES[step]}</legend>
          {step === 0 && <>
            <SelectRow label="Series" value={series} required choices={[{ value: "", label: "— Select —" }, ...AMSCO_SERIES]} onChange={value => resetBranch(changeConfiguratorSeries(line, value))} />
            {series && <SelectRow label="Style / Operation" value={line.style} required choices={[{ value: "", label: "— Select —" }, ...styles, { value: "Custom", label: "Other / custom product" }]} onChange={value => resetBranch(changeProduct(line, value))} />}
            {line.style && <SelectRow label="Number Wide" value={options.number_wide ?? (legacyProduct ? 1 : "")} required choices={[{ value: "", label: "— Select —" }, ...numberWideChoices(line)]} onChange={value => resetBranch(changeNumberWide(line, value))} />}
            {line.style && !styles.some(item => item.value === line.style) && <TextRow label="Requested AMSCO Product" value={line.style === "Custom" ? "" : line.style} maxLength={250} placeholder="Enter product name" onChange={value => onChange({ style: value || "Custom" })} />} 
            {line.style && !styles.some(item => item.value === line.style) && <Note>This product will need an AMSCO specialist to confirm the product and available options.</Note>}
            {!line.style && <Note>Choose the operation first. Its unit details, sizes, and design options will follow.</Note>}
          </>}
          {step === 1 && <>
            <SelectRow label="Measurement Type" value={line.dimension_basis || "call"} choices={[{ value: "call", label: "Call Size" }, { value: "frame", label: "Frame Size" }, { value: "rough_opening", label: "Rough Opening" }]} onChange={value => { onTradeCode(""); onChange({ dimension_basis: value, width: "", height: "" }); setCustomWidth(false); setCustomHeight(false); }} />
            <ReadRow label="Overall Frame Width" value={frame?.width || ""} /><ReadRow label="Overall Frame Height" value={frame?.height || ""} />
            {line.dimension_basis === "call" && menu ? <>
              <SelectRow label="Call Width" value={widthCustom ? "custom" : line.width} required choices={[{ value: "", label: "— Select —" }, ...menu.widths, { value: "custom", label: "Custom" }]} onChange={value => { onTradeCode(""); setCustomWidth(value === "custom"); setCustomHeight(false); onChange(value === "custom" ? { width: "", height: "" } : chooseCallWidth(line, value, menu)); }} />
              {widthCustom && <TextRow label="Custom Call Width (inches)" value={line.width} type="number" min=".001" step="any" onChange={value => onChange({ width: value, height: "" })} />}
              <SelectRow label="Call Height" value={heightCustom || widthCustom ? "custom" : line.height} required disabled={!Number(line.width)} choices={[{ value: "", label: line.width ? "— Select —" : "Choose width first" }, ...heights, { value: "custom", label: "Custom" }]} onChange={value => { onTradeCode(""); setCustomHeight(value === "custom"); onChange({ height: value === "custom" ? "" : Number(value) || "" }); }} />
              {(heightCustom || widthCustom) && <TextRow label="Custom Call Height (inches)" value={line.height} type="number" min=".001" step="any" disabled={!Number(line.width)} onChange={value => onChange({ height: value })} />}
              {menu.source === "pricebook" && <Note>Standard sizes are available from the imported product size grid. AMSCO checks the final combination.</Note>}
            </> : <>
              <TextRow label={(line.dimension_basis === "frame" ? "Frame" : line.dimension_basis === "rough_opening" ? "Rough Opening" : "Call") + " Width (inches)"} value={line.width} type="number" min=".001" step="any" onChange={value => { onTradeCode(""); onChange({ width: value }); }} />
              <TextRow label={(line.dimension_basis === "frame" ? "Frame" : line.dimension_basis === "rough_opening" ? "Rough Opening" : "Call") + " Height (inches)"} value={line.height} type="number" min=".001" step="any" onChange={value => { onTradeCode(""); onChange({ height: value }); }} />
              {!menu && <Note>Enter the overall assembly dimensions. AMSCO will confirm sizes for this product and number wide.</Note>}
            </>}
            {line.dimension_basis === "call" && <details className="mx-4 mb-4"><summary className="min-h-10 cursor-pointer py-2 text-xs">Enter a four-digit call code</summary><Row label="Quick Call Code" note="3050 = 36 × 60 inches.">{id => <div className="flex gap-2"><input id={id} className={input} value={tradeCode} inputMode="numeric" maxLength={4} placeholder="3050" onChange={event => onTradeCode(event.target.value)} /><button type="button" className={button} disabled={!tradeCode.trim()} onClick={onApplyTradeCode}>Use</button></div>}</Row></details>}
            {panel.kind === "hung" && <SelectRow label="Sash Split" value="Even" choices={["Even"]} onChange={() => {}} />}
            <SelectRow label="Unit Type" value="Complete Unit" choices={["Complete Unit"]} onChange={() => {}} />
            {["casement", "awning"].includes(panel.kind) ? optionRow("Operation / Venting", "operation", Number(options.number_wide) === 2 ? ["Left / Right", "Fixed / Fixed"] : ["Left", "Right", "Fixed"]) : panel.kind === "slider" ? optionRow("Operation / Venting", "operation", /double vent/i.test(line.style) ? ["XOX"] : ["XO", "OX"]) : <ReadRow label="Operation / Venting" value={productLabel} />}
            <ReadRow label="Frame Width" value={frame?.width || ""} /><ReadRow label="Frame Height" value={frame?.height || ""} />
          </>}
          {step === 2 && <>
            <SelectRow label="Exterior Color" value={colors.exterior} choices={["White", "Taupe", "Black"]} onChange={value => onChange({ options: changeColor(options, settings, "exterior", value) })} />
            <SelectRow label="Interior Color" value={colors.interior} choices={["White", "Taupe", "Black"]} onChange={value => onChange({ options: changeColor(options, settings, "interior", value) })} />
            {boolRow("Tempered", "tempered")}
            {optionRow("Glass Type · CozE Glass", "glass", COZE_CHOICES)}
            {optionRow("Patterned Glass", "patterned_glass", ["None", "Obscure"])}
            <SelectRow label="Thermal Gas Added" value={options.argon === undefined ? "" : String(options.argon)} choices={[{ value: "", label: auto("argon") }, { value: "false", label: "None" }, { value: "true", label: "Argon" }]} onChange={value => onOption("argon", value === "" ? "" : value === "true")} />
            {optionRow("Window Installation Elevation (Ft Above Sea Level)", "elevation", ["None", "Above 8001", "6501 to 8000", "2501 to 6500", "1001 to 2500", "Below 1000"])}
            {boolRow("Super Spacer", "super_spacer")}
            {panel.kind !== "fixed" && optionRow("Hardware Type", "hardware", panel.kind === "hung" ? ["Cam Latch"] : [])}
          </>}
          {step === 3 && <>
            {optionRow("Glazing Method", "glazing_method", [{ value: "3/4 Insulated", label: '3/4" Insulated' }])}
            {optionRow("Glass Thickness", "glass_thickness", GLASS_THICKNESS_CHOICES)}
            {boolRow("Capillary Tubes", "capillary_tubes")}
            {panel.kind !== "fixed" && <SelectRow label="Hardware Finish" value={colors.interior} choices={[colors.interior]} onChange={() => {}} note="Matches the interior color." />}
            {panel.kind !== "fixed" && <SelectRow label="Screen" value={/^none$/i.test(String(options.screen ?? "")) ? "None" : colors.interior} choices={[colors.interior, "None"]} onChange={value => onOption("screen", value)} note="Screen finish matches the interior color." />}
            <Note>Automatic glass construction updates with the window size. Explicit changes stay with this line.</Note>
          </>}
          {step === 4 && <>
            <SelectRow label="Grille Type" value={customGrille ? "custom" : grilles.mode} choices={[{ value: "standard", label: auto("grilles") }, { value: "none", label: "None" }, { value: "rectangular", label: "Rectangular grid" }, { value: "custom", label: "Custom specification" }]} onChange={mode => { setCustomGrille(mode === "custom"); if (mode !== "custom") updateGrilles({ mode }); }} />
            {!customGrille && grilles.mode === "rectangular" && <>
              <SelectRow label="Grille Profile" value={grilles.type} choices={GRILLE_TYPES} onChange={type => updateGrilles({ type })} />
              <ReadRow label="Grille Pattern" value="Rectangular" />
              <SelectRow label="Grille Color" value={grilles.color} choices={["White", "Taupe", "Black"]} onChange={color => updateGrilles({ color })} />
              <SelectRow label="Lites Wide" value={String(grilles.wide)} choices={Array.from({ length: 12 }, (_, number) => String(number + 1))} onChange={wide => updateGrilles({ wide: Number(wide) })} />
              <SelectRow label="Lites High" value={String(grilles.high)} choices={Array.from({ length: 12 }, (_, number) => String(number + 1))} onChange={high => updateGrilles({ high: Number(high) })} />
              <SelectRow label="Pattern Applies To" value={grilles.scope} choices={[{ value: "lite", label: "Each sash / panel" }, { value: "window", label: "Whole window" }]} onChange={scope => updateGrilles({ scope })} />
            </>}
            {(customGrille || grilles.mode === "custom") && <Row label="Grille Specification">{id => <textarea id={id} className={input + " min-h-28"} value={options.grilles || ""} maxLength={500} onChange={event => onOption("grilles", event.target.value)} />}</Row>}
          </>}
          {step === 5 && <>
            <ReadRow label="Series / Installation Frame" value={seriesLabel} />
            {optionRow("Installation Fin", "fin", ["Nail Fin", "Flush Fin"])}
            <Note>The series carries the standard installation setup. Job labor and flashing are selected in the quote’s Installation section.</Note>
          </>}
          {step === 6 && <><ReadRow label="Request Type" value="New product quote" /><Note>Service and replacement-part requests require the AMSCO specialist. This line stays a new-product quote.</Note></>}
          {step === 7 && <>
            <ReadRow label="Overall Frame Width" value={frame?.width || ""} /><ReadRow label="Overall Frame Height" value={frame?.height || ""} />
            <ReadRow label="Ventilation Opening (Sq.Ft.)" value={nativeInformation.ventilation_opening ?? pending} />
            <ReadRow label="Daylight Opening (Sq.Ft.)" value={nativeInformation.daylight_opening ?? pending} />
            <ReadRow label="Screen Size (w × h)" value={nativeInformation.screen_size ?? pending} />
            <ReadRow label="Sash Size (w × h)" value={nativeInformation.sash_size ?? pending} />
            <ReadRow label="Series Type" value={AMSCO_SERIES.find(item => item.value === series)?.family || series} />
          </>}
          {step === 8 && <>
            <ReadRow label="NFRC" value={nativeRatings.nfrc ?? pending} /><ReadRow label="Sound" value={nativeRatings.sound ?? pending} />
            <ReadRow label="Performance Rating" value={nativeRatings.performance ?? pending} /><ReadRow label="Air Infiltration" value={nativeRatings.air_infiltration ?? pending} /><ReadRow label="Water Penetration" value={nativeRatings.water_penetration ?? pending} />
            <Note>Ratings depend on the exact size, glass, and construction. Only returned AMSCO ratings are displayed.</Note>
          </>}
          {step === 9 && <>
            <TextRow label="Room / Location" value={line.room} maxLength={250} placeholder="Kitchen" onChange={value => onChange({ room: value })} />
            <TextRow label="Window Mark" value={line.mark} maxLength={100} placeholder="W1" onChange={value => onChange({ mark: value })} />
            <ReadRow label="Product Description" value={[seriesLabel, productLabel, line.width && line.height ? line.width + " × " + line.height + " in" : "", colors.exterior].filter(Boolean).join(" · ")} />
            {review}
          </>}
        </fieldset>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[#e4e8ec] px-4 py-4">
          <button type="button" className={button} disabled={disabled || step === 0} onClick={() => chooseStep(step - 1)}><ArrowLeft size={15} />Back</button>
          {step < CONFIGURATOR_PAGES.length - 1 && <button type="button" className={primary} disabled={disabled || !canVisit(step + 1)} onClick={() => chooseStep(step + 1)}>{CONFIGURATOR_PAGES[step + 1]}<ArrowRight size={15} /></button>}
        </div>
      </div>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-3 border-t border-[#bdcbd4] bg-[#f3f5f7] px-4 py-3">
      <label className="w-28 text-xs">Quantity<input className={input + " mt-1"} type="number" min="1" max="1000" step="1" value={line.qty ?? 1} disabled={disabled} onChange={event => onChange({ qty: event.target.value })} /></label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={disabled} onClick={onCancel}>Cancel</button>
        <button type="button" className={button} disabled={disabled} onClick={() => { const fresh = newConfiguratorLine(); resetBranch({ ...fresh, id: line.id }); setStep(0); setSummary(false); }}><RotateCcw size={14} />Start Over</button>
        <button type="button" className={button} disabled={disabled || !ready.canSave} onClick={() => onSave("copy")}><Copy size={14} />Save & Copy</button>
        <button type="button" className={button} disabled={disabled || !ready.canSave} onClick={() => onSave("new")}><Plus size={14} />Save & New</button>
        <button type="button" className={primary} disabled={disabled || !ready.canSave} onClick={() => onSave()}><Check size={15} />{index < 0 ? "Add to Quote" : "Save Window"}</button>
      </div>
    </div>
  </section>;
}

