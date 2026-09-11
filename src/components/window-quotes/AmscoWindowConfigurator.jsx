import { useEffect, useId, useRef, useState } from "react";
import { GLASS_THICKNESS_CHOICES, automaticOptionLabel, glassSpecification, resolvedWindowOptions, specificationValue } from "./windowSpecificationDisplay";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { AMSCO_SERIES, GRILLE_TYPES, selectedSeries, stylesForSeries, changeSeries, colorParts, changeColor, parseGrilles, serializeGrilles, diagramPanels } from "./amscoConfiguratorModel";
import { dimensionLabel, isStandardSize, standardHeights, standardSizeGrid, standardWidths } from "./amscoStandardSizes";

const steps = ["Product", "Size", "Options", "Review"];
const input = "min-h-11 w-full min-w-0 rounded-lg border border-[#B8C5CE] bg-white px-3 py-2 text-base text-[#263B49] focus:border-[#19718D] focus:outline-none focus:ring-2 focus:ring-[#19718D]/20 disabled:opacity-60 sm:text-sm";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#B8C6CF] bg-white px-3 py-2 text-sm font-semibold text-[#305367] hover:bg-[#F6F8FC] disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[#196C86] bg-[#196C86] px-4 py-2 text-sm font-semibold text-white hover:bg-[#145B71] disabled:opacity-50";
const money = value => typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value)) : "—";
function Row({ label, children, note }) {
  const id = useId();
  return <div className="grid min-w-0 gap-2 border-b border-[#E5EAEE] px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] sm:items-center">
    <label htmlFor={id} className="text-sm font-medium text-[#344F60]">{label}</label>
    <div className="min-w-0">{children(id)}{note && <p className="mt-1.5 text-xs leading-relaxed text-[#687E8B]">{note}</p>}</div>
  </div>;
}
function SelectRow({ label, value, choices, onChange, note, formatValue = String, disabled = false }) {
  const all = choices.map(choice => typeof choice === "string" ? { value: choice, label: formatValue(choice) } : choice);
  if (value !== undefined && value !== "" && !all.some(choice => String(choice.value) === String(value))) all.push({ value, label: formatValue(value) });
  return <Row label={label} note={note}>{id => <select id={id} className={input} value={value ?? ""} disabled={disabled} onChange={event => onChange(event.target.value)}>{all.map(choice => <option key={String(choice.value)} value={choice.value}>{choice.label}</option>)}</select>}</Row>;
}
function TextRow({ label, value, onChange, note, ...rest }) { return <Row label={label} note={note}>{id => <input id={id} className={input} value={value ?? ""} onChange={event => onChange(event.target.value)} {...rest} />}</Row>; }
function Note({ children }) { return <p className="px-4 py-4 text-sm leading-relaxed text-[#647C8B]">{children}</p>; }
function SummaryItem({ label, value }) { return <div className="rounded-xl bg-[#F6F8FC] p-3"><dt className="text-[10px] font-semibold uppercase tracking-wide text-[#77839A]">{label}</dt><dd className="mt-1 break-words text-sm font-semibold text-[#305367]">{value || "—"}</dd></div>; }
function WindowDrawing({ line, settings, grille }) {
  const { columns, rows, kind } = diagramPanels(line);
  const ratio = Math.min(2.6, Math.max(.35, (Number(line.width) || 36) / (Number(line.height) || 60)));
  const width = Math.min(236, 220 * ratio), height = width / ratio, x = (300 - width) / 2, y = 40;
  const pair = colorParts(line.options, settings), frame = /black/i.test(pair.exterior) ? "#272B2E" : /taupe/i.test(pair.exterior) ? "#AD9F8E" : "#FFF";
  const panels = Array.from({ length: columns * rows }, (_, index) => ({ x: x + 9 + index % columns * (width - 18) / columns, y: y + 9 + Math.floor(index / columns) * (height - 18) / rows, w: (width - 18) / columns, h: (height - 18) / rows, index }));
  return <svg role="img" aria-label={(line.style || "Window") + " illustration"} viewBox={"0 0 300 " + (height + 88)} className="mx-auto max-h-72 w-full max-w-80" fill="none">
    <rect x={x} y={y} width={width} height={height} fill={frame} stroke="#607786" strokeWidth="1.4" />
    {kind === "custom" ? <text x="150" y={y + height / 2} textAnchor="middle" fill="#526E7E" fontSize="12">Illustration pending</text> : panels.map(panel => {
      const grilleWide = grille.mode === "rectangular" ? Math.min(12, Number(grille.wide)) : 1;
      const grilleHigh = grille.mode === "rectangular" && grille.scope === "lite" ? Math.min(12, Number(grille.high)) : 1;
      const fixed = /fixed/i.test(line.options?.operation || "");
      const right = /^right|^rh$/i.test(line.options?.operation || "") || /left\s*\/\s*right/i.test(line.options?.operation || "") && panel.index % 2 === 1;
      return <g key={panel.index}>
        <rect x={panel.x + 3} y={panel.y + 3} width={panel.w - 6} height={panel.h - 6} fill="#E8F4FA" stroke="#627E8F" />
        {Array.from({ length: grilleWide - 1 }, (_, index) => <line key={"v" + index} x1={panel.x + panel.w * (index + 1) / grilleWide} x2={panel.x + panel.w * (index + 1) / grilleWide} y1={panel.y + 3} y2={panel.y + panel.h - 3} stroke={frame} strokeWidth="3" />)}
        {Array.from({ length: grilleHigh - 1 }, (_, index) => <line key={"h" + index} x1={panel.x + 3} x2={panel.x + panel.w - 3} y1={panel.y + panel.h * (index + 1) / grilleHigh} y2={panel.y + panel.h * (index + 1) / grilleHigh} stroke={frame} strokeWidth="3" />)}
        {kind === "casement" && !fixed && <polyline points={right ? [panel.x + 7, panel.y + 7, panel.x + panel.w - 7, panel.y + panel.h / 2, panel.x + 7, panel.y + panel.h - 7].join(" ") : [panel.x + panel.w - 7, panel.y + 7, panel.x + 7, panel.y + panel.h / 2, panel.x + panel.w - 7, panel.y + panel.h - 7].join(" ")} stroke="#6C8999" strokeDasharray="5 3" />}
        {kind === "awning" && !fixed && <polyline points={[panel.x + 7, panel.y + panel.h - 7, panel.x + panel.w / 2, panel.y + 7, panel.x + panel.w - 7, panel.y + panel.h - 7].join(" ")} stroke="#6C8999" strokeDasharray="5 3" />}
        {kind === "hung" && panel.index === 1 && <text x={panel.x + panel.w / 2} y={panel.y + panel.h / 2} fill="#526E7E" textAnchor="middle">↑</text>}
        {kind === "slider" && panel.index === (/^ox$/i.test(line.options?.operation || "") ? columns - 1 : 0) && <text x={panel.x + panel.w / 2} y={panel.y + panel.h / 2} fill="#526E7E" textAnchor="middle">{/^ox$/i.test(line.options?.operation || "") ? "←" : "→"}</text>}
      </g>;
    })}
    <line x1={x} x2={x + width} y1="24" y2="24" stroke="#91A4B0" />
    <text x="150" y="18" fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} in</text>
    <text x="150" y={height + 66} fill="#486475" fontSize="12" textAnchor="middle">{line.width || "—"} × {line.height || "—"} in · {line.dimension_basis || "call"}</text>
  </svg>;
}

export default function AmscoWindowConfigurator({ line, index, settings, disabled, tradeCode, onTradeCode, onApplyTradeCode, onChange, onOption, onCancel, onSave, price, priceStatus }) {
  const [step, setStep] = useState(0), [customGrille, setCustomGrille] = useState(false), [sizeMode, setSizeMode] = useState("standard");
  const stepRef = useRef(null), uid = useId();
  const series = selectedSeries(line), styles = stylesForSeries(series), options = line.options || {}, colors = colorParts(options, settings), grilles = parseGrilles(options.grilles), panel = diagramPanels(line);
  const sizeGrid = standardSizeGrid(line, series), widths = standardWidths(line, series), heights = standardHeights(line, series, Number(line.width));
  const standardCompatible = sizeGrid && isStandardSize(line, series, { allowPartial: true });
  useEffect(() => {
    if (!sizeGrid || !standardCompatible) setSizeMode("custom");
    else setSizeMode("standard");
  }, [sizeGrid?.key, standardCompatible]);
  const chooseStep = next => {
    setStep(next);
    requestAnimationFrame(() => stepRef.current?.querySelector('[data-step="' + next + '"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }));
  };
  const automatic = key => automaticOptionLabel(key, line, settings, price, priceStatus);
  const specifications = resolvedWindowOptions(line, settings, price), glassSummary = glassSpecification(line, settings, price);
  const optionRow = (label, key, choices) => <SelectRow label={label} value={options[key] ?? ""} formatValue={value => specificationValue(key, value)} choices={[{ value: "", label: automatic(key) }, ...choices]} onChange={value => onOption(key, value)} />;
  const boolRow = (label, key) => <SelectRow label={label} value={options[key] === undefined ? "" : String(options[key])} choices={[{ value: "", label: automatic(key) }, { value: "false", label: specificationValue(key, false) }, { value: "true", label: specificationValue(key, true) }]} onChange={value => onOption(key, value === "" ? "" : value === "true")} />;
  const updateGrilles = patch => onOption("grilles", serializeGrilles({ type: GRILLE_TYPES[0], wide: 2, high: 4, scope: "lite", color: colors.exterior, ...grilles, ...patch }));
  const chooseStandardWidth = value => {
    onTradeCode("");
    if (!value) { onChange({ width: "", height: "", dimension_basis: "call" }); return; }
    const width = Number(value), allowed = standardHeights(line, series, width);
    onChange({ width, height: allowed.includes(Number(line.height)) ? Number(line.height) : "", dimension_basis: "call" });
  };
  const chooseStandardHeight = value => {
    onTradeCode("");
    onChange({ height: value ? Number(value) : "", dimension_basis: "call" });
  };
  const productLabel = styles.find(item => item.value === line.style)?.label || line.style || "Choose a product";
  const seriesLabel = AMSCO_SERIES.find(item => item.value === series)?.label || series || "Choose a series";

  return <section className="min-w-0 overflow-hidden rounded-2xl border border-[#BDC8D0] bg-white shadow-sm" aria-label="AMSCO window configurator">
    <div className="flex items-center justify-between gap-3 bg-[#2F5366] px-4 py-3 text-white">
      <div><p className="text-[10px] uppercase tracking-widest text-[#D0E1EB]">Glass Forge · AMSCO</p><h2 className="mt-0.5 text-base font-semibold">{index < 0 ? "Add a window" : "Edit window " + (index + 1)}</h2></div>
      <button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg hover:bg-white/10" onClick={onCancel} disabled={disabled} aria-label="Cancel window edit"><X size={20} /></button>
    </div>

    <div ref={stepRef} role="tablist" aria-label="Window configuration steps" className="grid grid-cols-4 border-b border-[#D7E0E6] bg-[#F2F6F8]">
      {steps.map((label, stepIndex) => <button type="button" role="tab" id={uid + "-tab-" + stepIndex} aria-controls={uid + "-panel"} aria-selected={step === stepIndex} data-step={stepIndex} key={label} disabled={disabled} onClick={() => chooseStep(stepIndex)} className={"min-h-14 border-r border-[#D7E0E6] px-2 py-2 text-center text-xs font-semibold last:border-r-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#196C86] " + (step === stepIndex ? "bg-[#196C86] text-white" : "text-[#526D7D] hover:bg-white")}>
        <span className="mx-auto mb-1 flex h-5 w-5 items-center justify-center rounded-full bg-current/10 text-[10px]">{stepIndex + 1}</span>{label}
      </button>)}
    </div>

    <div className="grid min-w-0 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-[#D9E2E8] bg-[#FAFCFD] px-4 py-4 lg:border-b-0 lg:border-r" aria-label="Window preview">
        <div className="grid grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] items-center gap-3 lg:grid-cols-1">
          <WindowDrawing line={line} settings={settings} grille={grilles} />
          <div className="min-w-0"><p className="text-[10px] uppercase tracking-wide text-[#6E8390]">Your window</p><p className="mt-1 break-words text-sm font-semibold text-[#2E4F62]">{productLabel}</p><p className="mt-1 break-words text-xs text-[#6E8390]">{seriesLabel}</p><p className="mt-2 text-xs text-[#526D7D]">{colors.exterior} exterior / {colors.interior} interior</p><p aria-live="polite" className="mt-2 text-xs leading-relaxed text-[#526D7D]">{glassSummary || "Standard glass resolves as you choose the size."}</p></div>
        </div>
        <div className="mt-4 border-t border-[#D9E2E8] pt-3" aria-live="polite">
          <p className="text-xs font-semibold text-[#526D7D]">Customer price · each</p>
          {priceStatus === "loading" || ["calculating", "native_busy"].includes(price?.status) ? <p className="mt-2 flex items-center gap-2 text-sm text-[#6E8390]"><Loader2 size={15} className="animate-spin" />Checking AMSCO price…</p> : price?.status === "priced" ? <><p className="mt-1 text-2xl font-semibold text-[#286A54]">{money(price.unit_prices?.customer)}</p><p className="mt-1 text-xs text-[#6E8390]">{money(price.line_totals?.customer)} for this quantity</p></> : <p className="mt-2 text-sm leading-relaxed text-[#687E8B]">{price?.status === "amsco_lookup_needed" ? "This combination will be checked in AMSCO." : price?.status === "native_calculation_needed" ? "Ready for the AMSCO pricing engine." : priceStatus === "unavailable" || price?.status === "native_unavailable" ? "Pricing is temporarily unavailable; your choices are retained." : "Choose a product and size to see pricing."}</p>}
        </div>
        {price?.status === "priced" && <details className="mt-4 border-t border-[#D9E2E8] pt-3"><summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-[#305367]">Price breakdown</summary><dl className="grid grid-cols-2 gap-3 text-xs"><div><dt className="text-[#6E8390]">List / each</dt><dd className="mt-1 font-semibold text-[#305367]">{money(price.unit_prices?.list)}</dd></div><div><dt className="text-[#6E8390]">Dealer / each</dt><dd className="mt-1 font-semibold text-[#305367]">{money(price.unit_prices?.dealer)}</dd></div></dl></details>}
        <p className="mt-3 text-[11px] leading-relaxed text-[#8194A0]">Illustration only. AMSCO confirms final construction and ratings.</p>
      </aside>

      <div className="min-w-0" role="tabpanel" id={uid + "-panel"} aria-labelledby={uid + "-tab-" + step}>
        <div className="border-b border-[#D9E2E8] px-4 py-4"><h3 className="text-lg font-semibold text-[#305367]">{steps[step]}</h3><p className="mt-1 text-xs text-[#687E8B]">{step === 0 ? "Start with the frame series and operating style." : step === 1 ? "Pick a common AMSCO size, or switch to a custom measurement." : step === 2 ? "Only change what is different from your quote defaults." : "Check the essentials, then add the window."}</p></div>
        <fieldset disabled={disabled} className="min-w-0"><legend className="sr-only">{steps[step]}</legend>
          {step === 0 && <>
            <SelectRow label="Frame / install series" value={series} choices={[{ value: "", label: "Choose a series" }, ...AMSCO_SERIES]} onChange={value => onChange(changeSeries(line, value))} />
            <SelectRow label="Window type" value={line.style} choices={[{ value: "", label: "Choose a window type" }, ...styles, { value: "Custom", label: "Other / custom product" }]} onChange={value => { onTradeCode(""); onChange({ style: value, width: "", height: "", dimension_basis: "call" }); }} />
            {(!styles.length || line.style === "Custom" || line.style && !styles.some(item => item.value === line.style)) && <TextRow label="Requested AMSCO product" value={line.style === "Custom" ? "" : line.style} placeholder="Enter the product name" maxLength={250} onChange={value => onChange({ style: value || "Custom" })} />}
            <Note>The frame series already carries the installation setup. The next screen automatically loads the standard sizes for this window type.</Note>
          </>}

          {step === 1 && <>
            <Row label="Size choice" note={sizeGrid ? "Standard is fastest. Custom keeps exact field measurements." : "This product needs custom dimensions."}>{id => <div id={id} className="grid grid-cols-2 gap-2">
              <button type="button" className={(sizeMode === "standard" ? "border-[#196C86] bg-[#E8F4F7] text-[#145B71]" : "border-[#C7D2D9] bg-white text-[#526D7D]") + " min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-40"} disabled={!sizeGrid} onClick={() => setSizeMode("standard")}>Standard size</button>
              <button type="button" className={(sizeMode === "custom" ? "border-[#196C86] bg-[#E8F4F7] text-[#145B71]" : "border-[#C7D2D9] bg-white text-[#526D7D]") + " min-h-11 rounded-lg border px-3 text-sm font-semibold"} onClick={() => setSizeMode("custom")}>Custom size</button>
            </div>}</Row>
            {sizeMode === "standard" && sizeGrid ? <>
              <SelectRow label="Width" value={line.width ?? ""} choices={[{ value: "", label: "Choose width" }, ...widths.map(value => ({ value, label: dimensionLabel(value) }))]} onChange={chooseStandardWidth} note="Widths come from this AMSCO product’s imported PK361 size grid." />
              <SelectRow label="Height" value={line.height ?? ""} disabled={!line.width} choices={[{ value: "", label: line.width ? "Choose height" : "Choose width first" }, ...heights.map(value => ({ value, label: dimensionLabel(value) }))]} onChange={chooseStandardHeight} note={line.width ? "Height choices are narrowed to the selected width." : undefined} />
              <Note>Standard selections are saved as call sizes. Final availability and construction are checked when the quote is priced.</Note>
            </> : <>
              <SelectRow label="Measurement type" value={line.dimension_basis || "call"} choices={[{ value: "call", label: "Call size" }, { value: "frame", label: "Actual frame size" }, { value: "rough_opening", label: "Rough opening" }]} onChange={value => { onTradeCode(""); onChange({ dimension_basis: value }); }} />
              <Row label="Quick call code" note="Example: 3050 becomes 36 × 60 inches.">{id => <div className="flex gap-2"><input id={id} className={input} inputMode="numeric" maxLength={4} placeholder="3050" value={tradeCode} onChange={event => onTradeCode(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onApplyTradeCode(); } }} /><button type="button" className={button + " shrink-0"} onClick={onApplyTradeCode} disabled={!tradeCode.trim()}>Use</button></div>}</Row>
              <TextRow label="Width (inches)" value={line.width} type="number" inputMode="decimal" min=".001" step="any" onChange={value => { onTradeCode(""); onChange({ width: value }); }} />
              <TextRow label="Height (inches)" value={line.height} type="number" inputMode="decimal" min=".001" step="any" onChange={value => { onTradeCode(""); onChange({ height: value }); }} />
            </>}
            {["casement", "awning"].includes(panel.kind) && <><SelectRow label="Number wide" value={options.number_wide ?? ""} choices={[{ value: "", label: automatic("number_wide") }, "1", "2"]} onChange={value => onOption("number_wide", value === "" ? "" : Number(value))} />{optionRow("Operation", "operation", Number(options.number_wide) === 2 ? ["Left / Right", "Fixed / Fixed"] : ["Left", "Right", "Fixed"])}</>}
            {panel.kind === "slider" && optionRow("Operation", "operation", ["XO", "OX"])}
            <TextRow label="Room / location" value={line.room} maxLength={250} placeholder="Kitchen" onChange={value => onChange({ room: value })} />
            <TextRow label="Window mark" value={line.mark} maxLength={100} placeholder="W1" onChange={value => onChange({ mark: value })} />
          </>}

          {step === 2 && <>
            <SelectRow label="Exterior color" value={colors.exterior} choices={["White", "Taupe", "Black"]} onChange={value => onChange({ options: changeColor(options, settings, "exterior", value) })} />
            <SelectRow label="Interior color" value={colors.interior} choices={["White", "Taupe", "Black"]} onChange={value => onChange({ options: changeColor(options, settings, "interior", value) })} />
            {boolRow("Safety / tempered glass", "tempered")}
            {optionRow("Privacy glass", "patterned_glass", ["None", "Obscure"])}
            <SelectRow label="Grilles" value={customGrille ? "custom" : grilles.mode} choices={[{ value: "standard", label: automatic("grilles") }, { value: "none", label: "None" }, { value: "rectangular", label: "Rectangular grid" }, { value: "custom", label: "Custom specification" }]} onChange={mode => { setCustomGrille(mode === "custom"); if (mode !== "custom") updateGrilles({ mode }); }} />
            {!customGrille && grilles.mode === "rectangular" && <div className="border-y border-[#E5EAEE] bg-[#F8FAFC]">
              <SelectRow label="Grille type" value={grilles.type} choices={GRILLE_TYPES} onChange={type => updateGrilles({ type })} />
              <SelectRow label="Grille color" value={grilles.color} choices={["White", "Taupe", "Black"]} onChange={color => updateGrilles({ color })} />
              <SelectRow label="Lites wide" value={String(grilles.wide)} choices={Array.from({ length: 12 }, (_, number) => String(number + 1))} onChange={wide => updateGrilles({ wide: Number(wide) })} />
              <SelectRow label="Lites high" value={String(grilles.high)} choices={Array.from({ length: 12 }, (_, number) => String(number + 1))} onChange={high => updateGrilles({ high: Number(high) })} />
              <SelectRow label="Pattern applies to" value={grilles.scope} choices={[{ value: "lite", label: "Each sash / panel" }, { value: "window", label: "Whole window" }]} onChange={scope => updateGrilles({ scope })} />
            </div>}
            {(customGrille || grilles.mode === "custom") && <Row label="Grille specification">{id => <textarea id={id} className={input + " min-h-28"} value={options.grilles || ""} maxLength={500} onChange={event => onOption("grilles", event.target.value)} />}</Row>}
            <details className="border-b border-[#E5EAEE] bg-[#F8FAFC]">
              <summary className="min-h-12 cursor-pointer px-4 py-4 text-sm font-semibold text-[#526D7D]">More glass, screen, hardware and fin options</summary>
              {optionRow("Glass coating", "glass", ["CozE (LowE)"])}
              {optionRow("Glass thickness", "glass_thickness", GLASS_THICKNESS_CHOICES)}
              {optionRow("Glazing method", "glazing_method", [{ value: "3/4 Insulated", label: "3/4″ insulated glass unit" }])}
              {boolRow("Argon", "argon")}{boolRow("Super Spacer", "super_spacer")}{boolRow("Capillary tubes", "capillary_tubes")}
              {optionRow("Elevation", "elevation", ["None", "Above 8001", "6501 to 8000", "2501 to 6500", "1001 to 2500", "Below 1000"])}
              {optionRow("Hardware color", "hardware_color", ["White", "Taupe", "Black"])}
              {optionRow("Screen", "screen", ["White", "Taupe", "Black", "None"])}
              {optionRow("Fin override", "fin", ["Nail Fin", "Flush Fin"])}
            </details>
            <Note>Automatic options use the verified AMSCO configuration. Open the advanced section only when the job calls for something different.</Note>
          </>}

          {step === 3 && <div className="p-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <SummaryItem label="Product" value={seriesLabel + " · " + productLabel} />
              <SummaryItem label="Size" value={line.width && line.height ? line.width + " × " + line.height + " in · " + (line.dimension_basis || "call").replace("_", " ") : "Choose width and height"} />
              <SummaryItem label="Finish" value={colors.exterior + " exterior / " + colors.interior + " interior"} />
              <SummaryItem label="Glass" value={glassSummary || "Automatic AMSCO construction"} />
              <SummaryItem label="Quantity" value={String(line.qty || 1)} />
              <SummaryItem label="Location" value={[line.mark, line.room].filter(Boolean).join(" · ") || "Not labeled"} />
            </dl>
            {Object.keys(specifications).length > 0 && <details className="mt-4 rounded-xl border border-[#DDE3EC] p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-[#526D7D]">Full configuration details</summary><dl className="grid gap-x-4 gap-y-2 pb-2 text-xs sm:grid-cols-2">{Object.entries(specifications).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => <div key={key}><dt className="capitalize text-[#77839A]">{key.replaceAll("_", " ")}</dt><dd className="mt-0.5 break-words font-medium text-[#535E72]">{specificationValue(key, value, specifications)}</dd></div>)}</dl></details>}
            <p className="mt-4 text-sm leading-relaxed text-[#647C8B]">If this looks right, add it to the quote. You can duplicate the line afterward for matching windows.</p>
          </div>}
        </fieldset>
        <div className="flex flex-wrap justify-between gap-2 border-t border-[#D9E2E8] px-4 py-4">
          <button type="button" className={button} disabled={disabled || step === 0} onClick={() => chooseStep(step - 1)}><ArrowLeft size={15} />Back</button>
          {step < steps.length - 1 && <button type="button" className={primary} disabled={disabled} onClick={() => chooseStep(step + 1)}>Next<ArrowRight size={15} /></button>}
        </div>
      </div>
    </div>

    <div className="sticky bottom-24 z-10 flex flex-wrap items-end justify-between gap-3 border-t border-[#BDC8D0] bg-white px-4 py-3 shadow-[0_-2px_8px_#00000008] sm:bottom-4">
      <label className="w-28 text-xs font-semibold text-[#526D7D]">Quantity<input className={input + " mt-1"} type="number" inputMode="numeric" min="1" max="1000" step="1" value={line.qty ?? 1} disabled={disabled} onChange={event => onChange({ qty: event.target.value })} /></label>
      <button type="button" className={primary} disabled={disabled} onClick={onSave}>{index < 0 ? <Plus size={17} /> : <Check size={17} />}{index < 0 ? "Add to quote" : "Save window"}</button>
    </div>
  </section>;
}
