export const MAX_LINES = 200;
export const CSV_TEMPLATE = 'mark,style,width,height,dimension_basis,units,qty,room,series,color,operation,glass\nW1,Single Vent,59.25,47.25,frame,in,1,BASEMENT,Studio Flush Fin,Taupe,XO,CozE (LowE)';
const aliases = {
  quantity: "qty", count: "qty", window_mark: "mark", label: "mark", type: "style",
  window_style: "style", width_in: "width", height_in: "height", basis: "dimension_basis",
  dimension_type: "dimension_basis", unit: "units", location: "room",
};
const optionFields = ["series", "color", "operation", "glass", "glass_thickness", "glazing_method", "tempered", "hardware", "screen", "elevation", "fin", "viewing_direction"];
const key = (value) => String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");

export function emptyLine() {
  return { mark: "", style: "", width: "", height: "", dimension_basis: "", units: "in", qty: 1, room: "", options: {} };
}

export function validateSettings(settings = {}) {
  const errors = [];
  if (!["BFS", "BTB"].includes(settings.dealer)) errors.push("Choose the AMSCO dealer account.");
  if (!String(settings.yard || "").trim()) errors.push("Enter the shipping yard.");
  const margin = settings.gross_margin;
  if (margin === "" || margin === null || margin === undefined || !Number.isFinite(Number(margin)) || Number(margin) < 0 || Number(margin) >= 100) {
    errors.push("Enter a gross margin from 0 up to, but below, 100%.");
  }
  return errors;
}

export function validateLines(lines = []) {
  const errors = [];
  if (!Array.isArray(lines)) return ["Takeoff must contain an array of lines."];
  if (lines.length > MAX_LINES) errors.push(`Use at most ${MAX_LINES} lines per request.`);
  const marks = new Set();
  lines.forEach((line, i) => {
    const prefix = `Line ${i + 1}`;
    if (!String(line.style || "").trim()) errors.push(`${prefix}: window style is required.`);
    for (const field of ["width", "height"]) {
      if (line[field] === "" || !Number.isFinite(Number(line[field])) || Number(line[field]) <= 0) errors.push(`${prefix}: ${field} must be a positive number in inches.`);
    }
    if (!Number.isInteger(Number(line.qty)) || Number(line.qty) <= 0) errors.push(`${prefix}: quantity must be a positive whole number.`);
    if (!["frame", "call", "rough_opening"].includes(line.dimension_basis)) errors.push(`${prefix}: choose frame, call size or rough opening.`);
    if (line.units !== "in") errors.push(`${prefix}: use inches (units = in); convert other units before submitting.`);
    if (line.options !== undefined && (!line.options || typeof line.options !== "object" || Array.isArray(line.options))) errors.push(`${prefix}: options must be an object.`);
    const mark = String(line.mark || "").trim().toLowerCase();
    if (mark && marks.has(mark)) errors.push(`${prefix}: duplicate window mark "${line.mark}". Combine quantities or use distinct marks.`);
    if (mark) marks.add(mark);
  });
  return errors;
}

export function normalizeLines(lines) {
  return lines.map((line) => ({
    ...line, mark: String(line.mark || "").trim(), style: String(line.style || "").trim(),
    width: Number(line.width), height: Number(line.height), qty: Number(line.qty),
    units: "in", room: String(line.room || "").trim(), options: line.options || {},
  }));
}

// Supports commas/newlines within quoted cells and escaped double quotes.
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') { quoted = false; closed = true; }
      else cell += ch;
    } else if (ch === '"' && !cell && !closed) quoted = true;
    else if (ch === "," || ch === "\n" || ch === "\r") {
      row.push(cell); cell = ""; closed = false;
      if (ch !== ",") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push(row);
        row = [];
      }
    } else {
      if (closed && ch.trim()) throw new Error("Unexpected text after a quoted CSV cell.");
      if (ch === '"') throw new Error("Quote CSV cells that contain quotation marks.");
      cell += ch;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted cell.");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  if (rows.length < 2) throw new Error("Include a header row and at least one window.");
  const headers = rows.shift().map((h) => aliases[key(h)] || key(h));
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error("CSV headers must be nonempty and unique.");
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${values.length} cells; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((h, j) => [h, values[j].trim()]));
  });
}

export function parseTakeoff(text, filename = "") {
  if (!String(text).trim()) throw new Error("Paste a JSON or CSV takeoff first.");
  if (String(text).length > 2_000_000) throw new Error("Keep takeoffs under 2 MB.");
  const isJSON = /\.json$/i.test(filename) || /^[\s\uFEFF]*[\[{]/.test(text);
  const decoded = isJSON ? JSON.parse(text.replace(/^\uFEFF/, "")) : parseCSV(text.replace(/^\uFEFF/, ""));
  const records = Array.isArray(decoded) ? decoded : decoded.lines;
  if (!Array.isArray(records) || !records.length) throw new Error("Provide a JSON array, an object with lines, or CSV rows.");
  if (records.length > MAX_LINES) throw new Error(`Use at most ${MAX_LINES} lines per request.`);
  const lines = records.map((record, i) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error(`Line ${i + 1} must be an object.`);
    const row = Object.fromEntries(Object.entries(record).map(([k, v]) => [aliases[key(k)] || key(k), v]));
    let options = row.options || {};
    if (typeof options === "string") {
      try { options = JSON.parse(options); } catch { throw new Error(`Line ${i + 1}: options must be valid JSON.`); }
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(`Line ${i + 1}: options must be an object.`);
    options = { ...options };
    optionFields.forEach((field) => { if (row[field] !== undefined && row[field] !== "") options[field] = row[field]; });
    const basis = String(row.dimension_basis || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const units = String(row.units || "").toLowerCase().trim();
    return {
      ...row, options,
      dimension_basis: ({ rough: "rough_opening", ro: "rough_opening", frame_size: "frame", call_size: "call" })[basis] || basis,
      units: ["in", "inch", "inches", '"'].includes(units) ? "in" : units,
    };
  });
  const errors = validateLines(lines);
  return { lines: errors.length ? lines : normalizeLines(lines), errors, source: { filename: filename || "Pasted takeoff", format: isJSON ? "json" : "csv", ...(decoded.source && !Array.isArray(decoded) ? { supplied: decoded.source } : {}) } };
}
