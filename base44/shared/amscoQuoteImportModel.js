// Saved manufacturer quotes are imported snapshots, never re-priced by our window engine.
export class ImportError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = message => { throw new ImportError(400, message); };
const obj = v => v && typeof v === "object" && !Array.isArray(v);
function text(v, label, max = 2000, required = false) {
  if (v == null && !required) return "";
  if (typeof v !== "string" || v.length > max || (required && !v.trim())) fail("Invalid " + label);
  return v.trim();
}
export function quoteNumber(value) {
  const n = text(value, "AMSCO quote number", 30, true);
  if (!/^\d{1,20}$/.test(n)) fail("Enter the numeric AMSCO quote number.");
  return n;
}
const guid = v => typeof v === "string" && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
function money(value, label, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > .00001) fail("Invalid " + label);
  return value;
}
function pairs(value, label) {
  if (value == null) return {};
  if (!obj(value) || Object.keys(value).length > 100) fail("Invalid " + label);
  return Object.fromEntries(Object.entries(value).map(([k,v]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9 _/().%-]{0,100}$/.test(k) || /token|secret|password|cookie|authorization|__proto__|constructor|prototype/i.test(k)) fail("Invalid " + label + " field");
    if (!["string","number","boolean"].includes(typeof v) || (typeof v === "string" && v.length > 10000) || (typeof v === "number" && !Number.isFinite(v))) fail("Invalid " + label + " value");
    return [k,v];
  }));
}
function paragraphs(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 300) fail("Invalid " + label);
  return value.map(v => text(v, label, 20000, true));
}
export function imagePath(value) {
  if (!value) return "";
  const path = text(value, "drawing path", 250);
  if (!/^\/api\/app\/images\/\d+\/_dynamic\/\d+\/\d{4}-\d{2}-\d{2}\/\d{1,4}x\d{1,4}\/\d+\.(?:png|jpg)$/i.test(path)) fail("Invalid AMSCO drawing path");
  return path;
}
export function validateImportedSnapshot(raw, expectedNumber) {
  if (!obj(raw) || JSON.stringify(raw).length > 2500000) fail("Invalid or oversized quote snapshot");
  if (quoteNumber(raw.quote_number) !== quoteNumber(expectedNumber)) fail("AMSCO returned a different quote number.");
  if (!guid(raw.quote_id)) fail("The saved AMSCO quote identity is missing.");
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 300 || raw.line_count !== raw.lines.length) fail("The complete saved line count must match the imported lines.");
  if (!obj(raw.checked) || !["quote_details","customer","notes","line_items","totals"].every(k => raw.checked[k] === true)) fail("Read the quote details, customer, notes, all line items and pricing totals before importing.");
  const ids = new Set(), numbers = new Set();
  const lines = raw.lines.map((v,index) => {
    if (!obj(v) || !guid(v.native_line_id) || ids.has(v.native_line_id.toLowerCase())) fail("Missing or duplicate saved line identity.");
    ids.add(v.native_line_id.toLowerCase());
    const num = String(v.native_line_number ?? "");
    if (!/^\d{1,8}$/.test(num) || numbers.has(num)) fail("Missing or duplicate saved line number.");
    numbers.add(num);
    if (!Number.isInteger(v.qty) || v.qty < 1 || v.qty > 10000) fail("Invalid quantity on line " + num);
    if (!["window","door","service","other"].includes(v.kind)) fail("Invalid line type.");
    const line = {
      id:v.native_line_id.toLowerCase(), native_line_id:v.native_line_id.toLowerCase(), native_line_number:num,
      kind:v.kind, qty:v.qty, room:text(v.room,"room",500), style:text(v.style,"product description",1000,true),
      description:text(v.description,"saved specifications",30000,true), notes:text(v.notes,"line notes",20000),
      options:pairs(v.options,"options"), ratings:pairs(v.ratings,"ratings"),
      image_path:imagePath(v.image_path), units:"in", dimension_basis:"frame",
      unit_prices:{}, line_totals:{}, imported:true
    };
    for (const key of ["width","height"]) {
      if (v[key] != null) {
        if (typeof v[key] !== "number" || !Number.isFinite(v[key]) || v[key] <= 0 || v[key] > 1000) fail("Invalid saved frame dimension");
        line[key] = v[key];
      }
    }
    for (const kind of ["list","dealer","customer"]) {
      line.unit_prices[kind] = money(v.unit_prices?.[kind],kind + " unit price",true);
      line.line_totals[kind] = money(v.line_totals?.[kind],kind + " extended price",true);
      if (Math.abs(Math.round(line.unit_prices[kind]*100)*v.qty - Math.round(line.line_totals[kind]*100)) > v.qty) fail("Saved prices do not match quantity on line " + num);
    }
    return line;
  });
  const totals = {};
  if (!obj(raw.totals)) fail("Saved quote totals are required.");
  for (const key of ["customer_total","dealer_total","list_total","subtotal","tax","labor","freight","shipping","handling","discount","misc"]) {
    const value = money(raw.totals[key],key,["customer_total","dealer_total","subtotal"].includes(key));
    if (value != null) totals[key] = value;
  }
  totals.currency = "USD";
  const extensions = Object.fromEntries(["list","dealer","customer"].map(k => [k, lines.reduce((sum,l)=>sum+Math.round(l.line_totals[k]*100),0)/100]));
  // Header adjustments are separate from line prices. Never replace the saved customer total with our own calculation.
  if (Math.abs(totals.subtotal - extensions.customer) > .02) fail("Customer subtotal does not match the complete saved line items.");
  const additions = ["tax","labor","freight","shipping","handling","misc"].reduce((n,k)=>n+(totals[k]||0),0) - (totals.discount||0);
  if (Math.abs(totals.subtotal + additions - totals.customer_total) > .02) fail("Read every quote-level charge so the saved customer total reconciles.");
  return {
    schema_version:1, quote_number:raw.quote_number, quote_id:raw.quote_id.toLowerCase(),
    title:text(raw.title,"quote name",200,true), customer:pairs(raw.customer,"customer"), details:pairs(raw.details,"quote details"),
    notes:paragraphs(raw.notes,"quote notes"), attachments:paragraphs(raw.attachments,"attachment names"),
    lines, line_count:lines.length, unit_count:lines.reduce((n,l)=>n+l.qty,0), totals, line_subtotals:extensions,
    checked:{quote_details:true,customer:true,notes:true,line_items:true,totals:true},
    warnings:paragraphs(raw.warnings,"import notices")
  };
}
export function importedQuoteRecord(snapshot, owner, now, importId) {
  return {
    request_id:"amsco-import:" + snapshot.quote_id, title:snapshot.title, requester_email:owner,
    input_revision:1,state_version:0,worker_status:"ready",sales_status:"open",lines:snapshot.lines,
    settings:{},source:{kind:"amsco_saved_import",import_id:importId,imported_at:now},
    result:{verified:false,native_source:"amsco_saved_import",native_quote_number:snapshot.quote_number,snapshot,totals:{...snapshot.totals,total:snapshot.totals.customer_total}},
    missing_details:[],history:[],conversation:[],job_id:"",accepted_revision:0,lease_token:"",conversion_token:""
  };
}
