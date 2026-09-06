import { useId } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, FileText, PanelsTopLeft } from "lucide-react";

const primaryClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#2A5EA8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#234F8E] disabled:cursor-not-allowed disabled:opacity-50";
const present = (value) => value !== undefined && value !== null && value !== "";
const numeric = (value) => present(value) && typeof value !== "boolean" && Number.isFinite(Number(value)) ? Number(value) : null;
const positive = (value) => numeric(value) > 0 ? numeric(value) : null;
const display = (value) => value === true ? "Yes" : value === false ? "No" : present(value) ? String(value) : "Not supplied";
const basisLabel = (basis) => ({ call: "Call size", frame: "Frame size", rough_opening: "Rough opening" }[basis] || "Size · basis not supplied");
const unitLabel = (unit) => ({ inch: "in", inches: "in", '"': "in", millimeters: "mm", centimeters: "cm", feet: "ft" }[unit] || unit || "units not supplied");
const unitFactor = (unit) => ({ in: 1, inch: 1, inches: 1, '"': 1, mm: 1 / 25.4, millimeters: 1 / 25.4, cm: 1 / 2.54, centimeters: 1 / 2.54, ft: 12, feet: 12 }[unit]);
function money(value, currency) {
  const number = numeric(value);
  if (number === null) return "Not supplied";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(number); }
  catch { return `${number.toFixed(2)} ${currency || "USD"}`; }
}
function dimensions(width, height, units) {
  return present(width) && present(height) ? `${width} × ${height} ${unitLabel(units)}` : "Not supplied";
}
function titleCase(key) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
const optionLabels = {
  series: "Series / frame", color: "Color", interior_color: "Interior color", exterior_color: "Exterior color",
  glass: "Glass", glass_thickness: "Glass thickness", glazing_method: "Glazing", tempered: "Tempered",
  argon: "Argon", super_spacer: "Super Spacer", grilles: "Grilles", grids: "Grids", grille_pattern: "Grille pattern",
  hardware: "Hardware", screen: "Screen", elevation: "Elevation", number_wide: "Number wide",
  handing: "Handing", operation: "Operation", fin: "Fin", fin_setback: "Fin setback", u_factor: "U-factor", shgc: "SHGC",
};
function configurationEntries(configuration) {
  if (!configuration || typeof configuration !== "object" || Array.isArray(configuration)) return [];
  return Object.entries(configuration).filter(([key, value]) => {
    // Only human-readable product choices; never expose URLs, internal IDs or access fields.
    if (/(?:^|_)(?:id|url|uri|password|token|secret|login|auth|cookie|session)(?:_|$)/i.test(key)) return false;
    return present(value) && ["string", "number", "boolean"].includes(typeof value) && !/https?:\/\//i.test(String(value));
  }).map(([key, value]) => [optionLabels[key] || titleCase(key), value]);
}
function drawingFor(line) {
  const frame = line.frame_dimensions;
  const hasFrame = frame && typeof frame === "object" && positive(frame.width) && positive(frame.height);
  const width = hasFrame ? positive(frame.width) : positive(line.width);
  const height = hasFrame ? positive(frame.height) : positive(line.height);
  const units = hasFrame ? (frame.units || line.units) : line.units;
  const factor = unitFactor(units);
  const style = String(line.style || "").toLowerCase().replace(/[-_]/g, " ");
  let type = /single\s*hung/.test(style) ? "single-hung" : /double\s*hung/.test(style) ? "double-hung" : /picture|fixed/.test(style) ? "picture" : /slider|sliding/.test(style) ? "slider" : /casement/.test(style) ? "casement" : null;
  const options = line.options || {};
  const shape = String(options.shape || line.shape || "");
  const shapeIsSpecial = /arch|circle|round|ellipse|trapez|triangle|rake|octagon|radius|bay|bow|garden/i.test(style + " " + shape);
  const compound = positive(options.number_wide) > 1 || positive(options.number_high) > 1;
  if (shapeIsSpecial || compound) type = null;
  return {
    width, height, units, type,
    widthInches: width && factor ? width * factor : null,
    heightInches: height && factor ? height * factor : null,
    basis: hasFrame ? "frame" : line.dimension_basis,
    hasFrame,
    available: Boolean(width && height && factor && type),
    grilles: options.grilles ?? options.grids ?? options.grille_pattern,
  };
}
function WindowSchematic({ line, drawing, scale }) {
  const titleID = useId();
  const descriptionID = useId();
  if (!drawing.available) return <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-[#CBD4E1] bg-[#F6F8FC] px-6 py-8 text-center">
    <PanelsTopLeft size={32} strokeWidth={1.25} className="text-[#77839A]" />
    <p className="mt-3 text-sm font-medium text-[#535E72]">Schematic unavailable</p>
    <p className="mt-2 max-w-xs text-xs leading-relaxed text-[#616D81]">{!drawing.width || !drawing.height ? "Complete dimensions are needed to draw this window." : !unitFactor(drawing.units) ? "Dimension units are needed to draw this window to proportion." : "This configuration needs a product-specific drawing. Its supplied specifications are listed alongside."}</p>
  </div>;

  const width = drawing.widthInches * scale;
  const height = drawing.heightInches * scale;
  const x = (300 - width) / 2;
  const y = 43 + (207 - height) / 2;
  // The outer envelope is proportional. No actual frame-profile or sash split measurements were returned.
  const inset = Math.min(5, width / 12, height / 12);
  const frameColor = /^taupe$/i.test(String(line.options?.color || "").trim()) ? "#AAA69A" : "#D6DDE7";
  const isHung = ["single-hung", "double-hung"].includes(drawing.type);
  const omittedGrilles = present(drawing.grilles) && !/^(none|no|false)$/i.test(String(drawing.grilles).trim());
  const caption = [
    `${basisLabel(drawing.basis)} proportions`,
    isHung ? "sash division indicative" : drawing.type === "slider" ? "panel layout not supplied" : drawing.type === "casement" ? "handing not illustrated" : null,
    omittedGrilles ? "grille layout not illustrated" : null,
  ].filter(Boolean).join(" · ");
  const shortCaption = [`${basisLabel(drawing.basis)} proportions`, "color illustrative", drawing.type === "slider" ? "panels not shown" : drawing.type === "casement" ? "handing not shown" : null, omittedGrilles ? "grilles not shown" : null].filter(Boolean).join(" · ");
  const arrowSize = Math.min(12, height / 12, width / 6);
  return <figure className="rounded-xl border border-[#E0E6EF] bg-[#F8FAFD] px-3 pb-4 pt-2">
    <svg viewBox="0 0 300 285" className="mx-auto block w-full max-w-[310px]" role="img" aria-labelledby={`${titleID} ${descriptionID}`}>
      <title id={titleID}>{line.style || "Window"} schematic, {dimensions(drawing.width, drawing.height, drawing.units)}</title>
      <desc id={descriptionID}>{caption}. Color is illustrative; frame profile, glass appearance and hardware are not represented.</desc>
      <g fill="none" stroke="#97A6BB" strokeWidth="0.8">
        <path d={`M ${x} ${y - 8} V 27 M ${x + width} ${y - 8} V 27 M ${x} 32 H ${x + width}`} />
        <path d={`M ${x - 3} 29 l 6 6 M ${x + width - 3} 29 l 6 6`} />
        <path d={`M ${x + width + 8} ${y} H 269 M ${x + width + 8} ${y + height} H 269 M 264 ${y} V ${y + height}`} />
        <path d={`M 261 ${y - 3} l 6 6 M 261 ${y + height - 3} l 6 6`} />
      </g>
      <text x="150" y="20" textAnchor="middle" fill="#535E72" fontSize="11">{drawing.width} {unitLabel(drawing.units)}</text>
      <text x="282" y={y + height / 2} textAnchor="middle" fill="#535E72" fontSize="11" transform={`rotate(-90 282 ${y + height / 2})`}>{drawing.height} {unitLabel(drawing.units)}</text>
      <rect x={x} y={y} width={width} height={height} fill={frameColor} stroke="#424B52" strokeWidth="1.4" />
      <rect x={x + inset} y={y + inset} width={width - inset * 2} height={height - inset * 2} fill="#F1F5F8" stroke="#69747D" strokeWidth="0.8" />
      {isHung && <g fill="none" stroke="#69747D" strokeWidth="1.2">
        <rect x={x + inset * 1.7} y={y + inset * 1.7} width={width - inset * 3.4} height={height / 2 - inset * 2.2} />
        <rect x={x + inset * 1.7} y={y + height / 2 + inset * 0.5} width={width - inset * 3.4} height={height / 2 - inset * 2.2} />
        <path d={`M ${x + inset} ${y + height / 2} H ${x + width - inset}`} stroke={frameColor} strokeWidth="3.5" />
        <path d={`M 150 ${y + height * 0.76 + arrowSize / 2} v ${-arrowSize} m ${-arrowSize / 3} ${arrowSize / 3} l ${arrowSize / 3} ${-arrowSize / 3} l ${arrowSize / 3} ${arrowSize / 3}`} stroke="#424B52" />
        {drawing.type === "double-hung" && <path d={`M 150 ${y + height * 0.24 - arrowSize / 2} v ${arrowSize} m ${-arrowSize / 3} ${-arrowSize / 3} l ${arrowSize / 3} ${arrowSize / 3} l ${arrowSize / 3} ${-arrowSize / 3}`} stroke="#424B52" />}
      </g>}
      <text x="150" y="276" textAnchor="middle" fill="#77839A" fontSize="10" letterSpacing="1.2">SCHEMATIC</text>
    </svg>
    <figcaption className="mx-auto max-w-xs text-center text-[10px] leading-relaxed text-[#616D81]">{shortCaption}</figcaption>
  </figure>;
}
function Specification({ label, value }) {
  return <div className="min-w-0"><dt className="text-[10px] font-medium uppercase tracking-wide text-[#77839A]">{label}</dt><dd className="mt-1 break-words text-xs leading-relaxed text-[#131A26]">{display(value)}</dd></div>;
}
function WindowSheet({ line, index, currency, drawing, scale }) {
  const frame = line.frame_dimensions;
  const options = configurationEntries(line.options);
  const native = configurationEntries(line.native_configuration || line.configuration);
  const unitPrice = line.customer_unit ?? line.unit_prices?.customer ?? line.customer_price ?? line.unit_price;
  const extendedPrice = line.customer_extended ?? line.line_totals?.customer ?? line.extended_price ?? line.total;
  const qty = line.qty ?? line.quantity;
  const costRows = [
    ["List", line.list_unit ?? line.unit_prices?.list, line.list_extended ?? line.line_totals?.list],
    ["Dealer", line.dealer_unit ?? line.unit_prices?.dealer, line.dealer_extended ?? line.line_totals?.dealer],
  ].filter(([, unit, total]) => present(unit) || present(total));
  return <article className="overflow-hidden rounded-2xl border border-[#DDE3EC] bg-white print:break-inside-avoid">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9EDF4] px-5 py-4">
      <div className="min-w-0"><div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#77839A]">{present(line.native_line_number) ? `AMSCO line ${line.native_line_number}` : `Window ${index + 1}`}</div><h4 className="break-words text-base font-semibold text-[#131A26]">{line.mark ? `${line.mark} · ` : ""}{line.style || line.description || "Window type not supplied"}</h4><p className="mt-1 break-words text-xs text-[#616D81]">{line.room ? `Location: ${line.room}` : "Location not supplied"}</p></div>
      <span className="rounded-lg bg-[#E7EEFA] px-3 py-1.5 text-xs font-semibold text-[#1E4A85]">Qty {display(qty)}</span>
    </header>
    <div className="grid items-start gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(200px,0.9fr)_minmax(0,1.4fr)]">
      <WindowSchematic line={line} drawing={drawing} scale={scale} />
      <div className="min-w-0 space-y-5">
        <dl className="grid grid-cols-2 gap-4 rounded-xl bg-[#F6F8FC] p-4">
          <Specification label={basisLabel(line.dimension_basis)} value={dimensions(line.width, line.height, line.units)} />
          <Specification label="Frame size" value={typeof frame === "string" ? frame : dimensions(frame?.width, frame?.height, frame?.units || line.units)} />
        </dl>
        <section><h5 className="mb-3 text-xs font-semibold text-[#535E72]">Saved configuration</h5>{options.length ? <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{options.map(([label, value]) => <Specification key={label} label={label} value={value} />)}</dl> : <p className="text-xs text-[#616D81]">Product options were not supplied in this result.</p>}</section>
        {native.length > 0 && <details className="border-t border-[#E9EDF4] pt-3"><summary className="cursor-pointer text-xs font-semibold text-[#535E72]">Native configuration values</summary><dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">{native.map(([label, value]) => <Specification key={label} label={label} value={value} />)}</dl></details>}
      </div>
    </div>
    <div className="border-t border-[#E9EDF4] bg-[#FAFBFD] px-5 py-4">
      <div className="grid grid-cols-2 gap-4"><div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#77839A]">Customer unit price</p><p className="mt-1 text-base font-semibold tabular-nums text-[#131A26]">{money(unitPrice, currency)}</p></div><div className="text-right"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#77839A]">Line total · Qty {display(qty)}</p><p className="mt-1 text-xl font-semibold tabular-nums text-[#1E4A85]">{money(extendedPrice, currency)}</p></div></div>
      {(costRows.length > 0 || present(line.gross_margin)) && <details className="mt-3 border-t border-[#E9EDF4] pt-3"><summary className="cursor-pointer text-xs font-medium text-[#616D81]">Cost and margin</summary><div className="mt-3 space-y-2 text-xs text-[#535E72]">{costRows.length > 0 && <table className="w-full text-right"><thead className="text-[10px] text-[#77839A]"><tr><th className="pb-2 text-left font-medium">Price basis</th><th className="pb-2 font-medium">Per unit</th><th className="pb-2 font-medium">Extended</th></tr></thead><tbody>{costRows.map(([label, unit, total]) => <tr key={label}><th className="py-1 text-left font-medium">{label}</th><td className="py-1 tabular-nums">{money(unit, currency)}</td><td className="py-1 tabular-nums">{money(total, currency)}</td></tr>)}</tbody></table>}{present(line.gross_margin) && <p>Gross margin <span className="font-semibold text-[#131A26]">{display(line.gross_margin)}%</span></p>}</div></details>}
    </div>
  </article>;
}

export default function WindowQuoteResults({ quote, onWon, busy }) {
  const result = quote?.result;
  const verified = quote?.worker_status === "ready" && result?.verified === true;
  if (!verified) return <div className="rounded-xl border border-dashed border-[#CBD4E1] bg-[#F6F8FC] px-5 py-10 text-center"><FileText size={28} className="mx-auto mb-3 text-[#77839A]" /><h3 className="font-semibold text-[#131A26]">Your verified quote will appear here</h3><p className="mx-auto mt-2 max-w-sm text-sm text-[#616D81]">Window schematics, saved specifications and prices appear after the quote has been checked.</p></div>;
  const lines = Array.isArray(result.lines) ? result.lines : [];
  const drawings = lines.map(drawingFor);
  const drawable = drawings.filter((drawing) => drawing.available);
  // All supported units are converted solely for drawing scale; displayed dimensions stay native.
  const scale = Math.min(180 / Math.max(1, ...drawable.map((drawing) => drawing.widthInches)), 207 / Math.max(1, ...drawable.map((drawing) => drawing.heightInches)));
  const quantities = lines.map((line) => positive(line.qty ?? line.quantity));
  const count = quantities.length && quantities.every((qty) => qty !== null) ? quantities.reduce((sum, qty) => sum + qty, 0) : null;
  const totals = result.totals || {};
  const currency = totals.currency || result.currency || "USD";
  const summaryRows = [["Subtotal", totals.subtotal], ["Labor", totals.labor], ["Delivery", totals.delivery], ["Freight", totals.freight], ["Tax", totals.tax]].filter(([, value]) => present(value));
  const revision = result.input_revision ?? quote.input_revision;
  return <div className="space-y-5">
    <section className="overflow-hidden rounded-2xl border border-[#DDE3EC] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5"><div><span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#EAF5EE] px-2.5 py-1 text-[11px] font-semibold text-[#276449]"><CheckCircle2 size={12} />Verified quote</span><h3 className="font-heading text-xl font-semibold text-[#131A26]">{present(result.native_quote_number) ? `AMSCO quote ${result.native_quote_number}` : "Window quote"}</h3><p className="mt-1 text-xs text-[#616D81]">{lines.length} {lines.length === 1 ? "line" : "lines"}{count !== null ? ` · ${count} ${count === 1 ? "window / assembly" : "windows / assemblies"}` : " · quantity not supplied"}{present(revision) ? ` · Revision ${revision}` : ""}</p></div><div className="sm:text-right"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#77839A]">Customer total</p><p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums text-[#1E4A85]">{money(totals.total ?? totals.customer_total, currency)}</p></div></div>
      <dl className="grid gap-3 border-t border-[#E9EDF4] bg-[#F6F8FC] px-5 py-4 sm:grid-cols-2"><Specification label="Dealer" value={result.dealer_name || result.dealer || quote.settings?.dealer} /><Specification label="Shipping yard" value={result.yard || quote.settings?.yard} /></dl>
    </section>
    {lines.map((line, index) => <WindowSheet key={line.native_line_id || line.id || index} line={line} index={index} currency={currency} drawing={drawings[index]} scale={scale} />)}
    {!lines.length && <p className="rounded-xl border border-[#DDE3EC] p-5 text-sm text-[#616D81]">Line details were not supplied in this result.</p>}
    <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5">
      <h4 className="text-sm font-semibold text-[#131A26]">Package totals</h4>
      <dl className="mt-4 space-y-2.5 text-sm">{summaryRows.map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-[#616D81]">{label}</dt><dd className="tabular-nums text-[#131A26]">{money(value, currency)}</dd></div>)}<div className="flex items-baseline justify-between gap-4 border-t border-[#E9EDF4] pt-3"><dt className="font-semibold text-[#131A26]">Customer total</dt><dd className="text-xl font-semibold tabular-nums text-[#1E4A85]">{money(totals.total ?? totals.customer_total, currency)}</dd></div></dl>
      {[totals.list_total, totals.dealer_total ?? totals.dealer_cost, totals.gross_margin].some(present) && <details className="mt-4 border-t border-[#E9EDF4] pt-3"><summary className="cursor-pointer text-xs font-medium text-[#616D81]">Package cost and margin</summary><dl className="mt-3 space-y-2 text-xs">{[["List total", totals.list_total], ["Dealer cost", totals.dealer_total ?? totals.dealer_cost]].filter(([, value]) => present(value)).map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt className="text-[#616D81]">{label}</dt><dd className="tabular-nums text-[#131A26]">{money(value, currency)}</dd></div>)}{present(totals.gross_margin) && <div className="flex justify-between gap-4"><dt className="text-[#616D81]">Gross margin</dt><dd className="text-[#131A26]">{display(totals.gross_margin)}%</dd></div>}</dl></details>}
      <p className="mt-4 text-[11px] leading-relaxed text-[#77839A]">Prices are the saved quote values. Schematics show overall proportions and are not fabrication drawings.</p>
    </section>
    {quote.job_id ? <Link to={`/jobs/${encodeURIComponent(quote.job_id)}`} className="flex items-center justify-between rounded-xl border border-[#CADFCF] bg-[#EAF5EE] p-4 text-sm font-semibold text-[#276449]"><span className="flex items-center gap-2"><BriefcaseBusiness size={17} />Won · Open linked job</span><ArrowUpRight size={16} /></Link> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DDE3EC] bg-white p-4"><div><h4 className="text-sm font-semibold text-[#131A26]">Won the sale?</h4><p className="mt-1 text-xs text-[#616D81]">Accept this revision and move it into Jobs.</p></div><button type="button" className={primaryClass} disabled={busy || quote.sales_status === "won"} onClick={onWon}><CheckCircle2 size={15} />Mark won</button></div>}
  </div>;
}