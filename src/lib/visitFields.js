// One calendar event's notes, sorted into the rows the job page shows for a visit:
// Work, Issue, Details, Heads up, People, Result and Other. Pure (no React, no API)
// so it can be tested against real calendar text.
//
// Rules the job page relies on:
// - Never returns money. Labor, trip charges, sale amounts and any "$" line go to
//   `hidden` (the page also runs every string through sanitizeText).
// - Never returns PO, OE, vendor order numbers or the "Gabe/Ragen" rep pair; those
//   live in the header's Job info dropdown. They go to `hidden` too.
// - Never drops a line silently: every non-blank line lands in exactly one bucket
//   (`placed === lineCount`), and anything unrecognized goes to `other`.
// - Never rewrites wording. All-caps lines are softened to sentence case; that's all.

const BRANDS = [
  ["amsco", "Amsco"], ["andersen", "Andersen"], ["pella", "Pella"], ["windor", "WinDor"],
  ["western", "Western"], ["milgard", "Milgard"], ["jeld-wen", "Jeld-Wen"], ["jeldwen", "Jeld-Wen"],
  ["bonelli", "Bonelli"], ["nuvista", "NuVista"],
];
const BRAND_RE = /\b(amsco|andersen|pella|windor|western|milgard|jeld-?wen|bonelli|nuvista)\b/i;
const brandName = (word) => {
  const w = String(word || "").toLowerCase().replace("jeldwen", "jeld-wen");
  return (BRANDS.find(([k]) => k === w) || [null, ""])[1];
};

// Codes that stay uppercase when an all-caps line is softened.
const KEEP_UPPER = new Set(["SGD", "SV", "SH", "XO", "OX", "XX", "OXXO", "XOX", "PW", "PD", "OPS", "BFS", "ISR", "OSR", "H/O",
  "PO", "OE", "VPO", "W/C", "B/O", "AM", "PM", "SPR", "SRW", "IG", "HOA", "ETA", "DMG", "GLS", "WHT", "BLK", "BRZ", "FX",
  "ADA", "LI", "YA", "SW", "NW", "NE", "SE", "UT", "TBD", "OA", "COI", "RO", "PO#", "OE#"]);
const PROPER = new Map(BRANDS.map(([k, v]) => [k.toUpperCase(), v]).concat([["ISRAEL", "Israel"], ["GABE", "Gabe"], ["RAGEN", "Ragen"]]));

export function softenCaps(line) {
  const s = String(line || "");
  if (/[a-z]/.test(s) || !/[A-Z]{2}/.test(s)) return s;
  let first = true;
  return s.replace(/[A-Za-z0-9#'/.-]+/g, (tok) => {
    const bare = tok.replace(/[.:,;]+$/, "");
    const tail = tok.slice(bare.length);
    let out;
    if (/\d/.test(bare) || KEEP_UPPER.has(bare)) out = bare;
    else if (PROPER.has(bare)) out = PROPER.get(bare);
    else out = bare.toLowerCase();
    if (first && /^[a-z]/.test(out)) out = out[0].toUpperCase() + out.slice(1);
    first = false;
    return out + tail;
  });
}

// A service head like "*Amsco WTY / No Charge per OSR*" -> "Amsco Warranty". Billing words
// (chargeable, no charge, per ISR/OSR) never become a tag.
function serviceTag(head) {
  const s = String(head || "").replace(/[*!]/g, " ")
    .replace(/\b(?:chargeable|no\s*charge)\b(?:\s*per\s+[a-z]+)?/gi, " ")
    .replace(/\bper\s+(?:isr|osr|spr|super|[a-z]+)\s*$/gi, " ")
    .replace(/\b(?:wty|warr?a?n?ty|warrnty)\b/gi, "Warranty")
    .split("/").map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(" / ");
  return s ? tagCase(s).replace(/\bWarranty\b/g, "Warranty") : "";
}

// Every word capitalized ("ANDERSEN INVESTIGATION/ADJUST" -> "Andersen Investigation/Adjust").
function tagCase(text) {
  return String(text || "").toLowerCase().replace(/(^|[\s/-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\b(Sgd|Isr|Osr|Bfs|Vpo|Ops)\b/g, (m) => m.toUpperCase()).replace(/\bWindor\b/g, "WinDor");
}

// "9/23" or "5/04/2026" -> "2026-09-23"; year fills in when the note leaves it off.
export function parseMD(md, year) {
  const m = String(md || "").trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return "";
  let y = m[3] ? Number(m[3]) : Number(year);
  if (y < 100) y += 2000;
  const mm = Number(m[1]), dd = Number(m[2]);
  if (!y || mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function plainText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<mailto:[^>]*>/gi, "")
    .replace(/<\/?(?:p|div|span|li|ul|ol|b|i|u|em|strong|a|font|table|tbody|thead|tr|td|th|h[1-6]|blockquote|pre|code|small|sup|sub|hr|img|html|body|head|meta|style)\b[^>]*>/gi, " ")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, "\"");
}

const LABELS = { install: "Install visit", return: "Return trip", service: "Service visit", order: "Order placed", custom: "Visit" };
const DATE = "(\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)";
const DELIVERY_RE = /^(?:\*+\s*)?(?:(amsco|andersen|pella|windor|western|milgard|jeld-?wen|bfs|installer)\b).*?\b(direct|dir\.?\s*sh(?:i)?p|del(?:iver(?:y|ed)?)?\s*to\s*bfs|will\s*call|w\/c|to\s+del)\b/i;
const MONEY_RE = /\$\s?-?\d|^\s*(?:sub\s*)?labor\b|^sub\s*pay|^sale\s*:|paid in full|^invoice\b/i;
const PERSON_RE = /^(h\/?o|spr|super(?:intendent)?|osr|oser|isr)\s*[:\-–]\s*(.*)$/i;
const ROLE = { ho: "Homeowner", "h/o": "Homeowner", spr: "Super", super: "Super", superintendent: "Super", osr: "OSR", oser: "OSR", isr: "ISR" };
const COORD_RE = /^\(?(darlene|rachel|cam|rp)\b:?(.*?)\)?$/i;
const ISR_NAMES_RE = /^(kaitlyn|kayly|kayla|kayley|toni|tori)\b([\s\d().-]*)$/i;
const REPS = "gabe|ragen|todd|wartman|kayly|kaitlyn|toni|tori|pete";
const REP_PAIR_RE = new RegExp(`^[a-z]+\\.?(?:\\s[a-z]+\\.?)?\\s*\\/\\s*[a-z]+\\.?$`, "i");
const REP_RE = new RegExp(`\\b(${REPS})\\b`, "i");

// PO / OE / vendor-order numbers written inline ("*PO#: 6977819 / 6977826", "78916751-00").
function scrub(s) {
  return String(s || "")
    .replace(/\*?\s*\(?(?:orig(?:inal)?\.?\s*)?\b(?:po|oe|s\.o\.?|so(?=\s*#)|oso|vendor order)\s*#?\)?\s*:?\s*\d[\d\s/\\.,-]*\*?/gi, " ")
    .replace(/\(?\b(?:vendor\s+)?order\s*#\)?[\s:*|]*(?:[A-Z0-9][A-Z0-9.-]*)?\*?/gi, " ")
    .replace(/\b(?:case\s*#|confirmation\s*(?:number|#))\s*:?\s*[A-Z0-9-]+/gi, " ")
    .replace(/\b(?:milg|q)\s*#\s*:?\s*\S+/gi, " ")
    .replace(/\b\d{8}-\d{2}\b/g, " ")
    .replace(/\b[67]\d{6}\b/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/(\s*\|\s*)+$/g, "").replace(/^(\s*\|\s*)+/g, "").replace(/\|\s*(?=\|)/g, "")
    .replace(/\s{2,}/g, " ").replace(/[\s*,;:-]+$/g, "").trim();
}
const VERB_RE = /^(please|install|pull|replace|adjust|check|deliver|pick\s*up|reinstall|re-install|finish|bring|send|take|seal|reseal|remove|investigate|tear|caulk|fix|repair|meet|order|measure|swap|set|hang|trim|clean)\b/i;

function eventType(text, title) {
  const all = `${title || ""}\n${text}`;
  if (/sales tracker|^\s*sale\s*:/im.test(text)) return "order";
  if (/per report|warr|\bwty\b|investigation|chargeable|no charge|\bservice\b|tech(?:nician)? instructions|installer instructions|tech notes/i.test(all)) return "service";
  if (text.split("\n").some((l) => DELIVERY_RE.test(l.trim())) || /^\s*qty\b/im.test(text)) return "install";
  if (/sheetrock|\bsrw\b|framing|finish (the )?install|remaining .*deliver|reinstall|dormer window|install one window/i.test(text)) return "return";
  return "custom";
}

export function visitFields(ev) {
  const text = plainText(ev?.scope_notes);
  const year = Number(String(ev?.event_date || "").slice(0, 4)) || new Date().getFullYear();
  const type = eventType(text, ev?.job_name);
  const f = {
    type, label: LABELS[type], brand: "", tags: [], delivery: null, received: [], vendors: [], qty: null, method: "",
    work: [], issues: [], people: [], details: [], headsUp: [], moves: [], result: [], other: [], hidden: [],
    lineCount: 0, placed: 0, merged: 0, unplaced: [], year,
  };
  const addTag = (t) => { if (!t) return; if (f.tags.includes(t)) f.merged += 1; else f.tags.push(t); };
  const addDetail = (k, v, replace = false) => {
    if (!v) return;
    const i = f.details.findIndex((d) => d.k === k);
    if (i < 0) f.details.push({ k, v });
    else if (replace) f.details[i] = { k, v };
    else if (f.details[i].v.split(" · ").includes(v)) f.merged += 1;
    else f.details[i] = { k, v: `${f.details[i].v} · ${v}` };
  };
  const setBrand = (b) => { if (b && !f.brand) f.brand = b; };
  const addPerson = (role, txt) => {
    const t = String(txt || "").replace(/\s+/g, " ").trim();
    const same = (p) => p.role === role && p.text.toLowerCase() === t.toLowerCase();
    const found = f.people.find(same);
    if (found) { f.merged += 1; return found; }
    const p = { role, text: t };
    f.people.push(p);
    return p;
  };

  if (type === "return") {
    if (/sheetrock|\bsrw\b/i.test(text)) addTag("Sheetrock windows");
    if (/framing/i.test(text)) addTag("Framing fixed");
  }
  for (const a of ev?.event_attachments || []) {
    const t = String(a?.title || "");
    if (!f.method && /install(ation)?\s*(method|type)|sill pan|nail-on|typar|tyvek|\bzip\b/i.test(t)) {
      f.method = t.replace(/\.pdf$/i, "").replace(/^new\s+/i, "").replace(/\s*(window\s+)?install(ation)?\s+method\b/i, "").trim();
    }
  }

  let mode = null; // continuation for the lines under a heading
  let vendor = null;
  let person = null;
  const snapshot = () => JSON.stringify([f.work, f.issues, f.people, f.details, f.headsUp, f.moves, f.result, f.other, f.hidden, f.tags, f.vendors, f.received, f.qty, f.delivery, f.brand, f.merged]);
  const handle = (raw) => {
      const line = raw.replace(/^(?:[*•·]\s+|-\s+)+/, "").replace(/\s+/g, " ").trim();
      const starred = /^\*{1,3}[^*].*\*{1,3}$/.test(raw) || /^!{2,}/.test(raw);
      const unstar = (s) => s.replace(/^[*!\s]+|[*!\s]+$/g, "").trim();
      let m;

      // System lines and references the header already shows.
      if (/^\|?\s*auto-reconciled/i.test(line) || /^sales tracker/i.test(line) || /^arrival\s*:/i.test(line)) { f.hidden.push(line); return; }
      if (/^\(?address confirmed/i.test(line)) { f.hidden.push(line); mode = "address"; return; }
      if (mode === "address" && /^\d+\s+\S/.test(line)) { f.hidden.push(line); return; }
      if (/vpo#?\s*required/i.test(line)) { addDetail("VPO", "Required"); f.hidden.push(line); mode = null; return; }
      if (/vpo#\s*:\s*\d/i.test(line)) { addDetail("VPO", "Received", true); f.hidden.push(line); return; }
      if (MONEY_RE.test(line)) { f.hidden.push(line); return; }
      if (/^(?:orig(?:inal)?\.?\s*)?po\s*#?\s*:?\s*\d/i.test(line) || /^\d{7}(?:\s|$)/.test(line)) {
        const ship = line.match(/ship\s*date\s*:?\s*([\d/]+)/i);
        if (ship) addDetail("Ship date", ship[1]);
        f.hidden.push(line); mode = null; return;
      }
      if (/^oe\s*#?\s*:?\s*\d/i.test(line) || /^\d{8}(?:-\d{2})?\b/.test(line)) {
        const coord = line.match(/\(\s*([A-Z][a-z]+)\s*:\s*([\d.\-() ]{10,})\)/);
        if (coord) addPerson("Service coord.", `${coord[1]} ${coord[2].trim()}`);
        f.hidden.push(line); mode = null; return;
      }
      if (REP_PAIR_RE.test(line) && REP_RE.test(line)) { f.hidden.push(line); return; }
      if (/^_{3,}$/.test(line)) { f.hidden.push(line); mode = null; person = null; return; }
      if (/^\*+$|^win\s*\d*\.?$/i.test(line) || /^(gabe|ragen)\b[\s\d().-]*$/i.test(line) || /^(?:milg|q)\s*#/i.test(line)) { f.hidden.push(line); return; }
      if (/^(?:microsoft teams meeting|join(?: the meeting)?\s*:|meeting id\s*:|passcode\s*:|need help\?|for organizers\s*:|\[company logo\]|dial in by phone|phone conference id\s*:|find a local number)/i.test(line)) { f.hidden.push(line); return; }
      if ((/order\s*#|vendor order|^memo oe\b|^oe for\b/i.test(line) && !/product eta|screen service/i.test(line)) || /^(?:amsco|andersen|pella|milgard|windor)\s*#?\s+(?:\d+\s+)?\d{2}-\d{3,4}/i.test(line) || /^\d{2}-\d{3,4}(?:\.\d+)?\b/.test(line)) { f.hidden.push(line); return; }
      if ((m = line.match(ISR_NAMES_RE))) { addPerson("ISR", (tagCase(m[1]) + m[2]).trim()); return; }

      // Order (sales tracker) fields.
      if ((m = line.match(/^brand\s*:\s*(.+)$/i))) { setBrand(brandName(m[1].trim().split(/\s+/)[0]) || m[1].trim()); return; }
      if ((m = line.match(/^ordered\s*:\s*(\S+)/i))) { addDetail("Ordered", m[1]); return; }
      if ((m = line.match(/^flag\s*:\s*(.+)$/i))) { f.headsUp.push(softenCaps(m[1].trim())); return; }

      // Delivery ("Amsco direct – 9/23", "Andersen del to BFS – 10/6", "BFS to will call at Amsco").
      if ((m = line.match(DELIVERY_RE))) {
        const b = brandName((line.match(BRAND_RE) || [])[1]);
        const date = (line.match(new RegExp(DATE)) || [])[1] || "";
        const how = m[2].toLowerCase();
        const method = /direct|dir/.test(how) ? `${b || "Vendor"} direct`
          : /bfs/.test(how) ? "To BFS"
            : /will|w\/c/.test(how) ? (b ? `Will call at ${b}` : "Will call")
              : "BFS delivers";
        setBrand(b);
        if (!f.delivery) f.delivery = { method, date };
        vendor = { brand: b, qty: null, here: "" };
        f.vendors.push(vendor);
        mode = null;
        return;
      }

      // Quantity lines: "QTY.29", "QTY.8 | here: 8/18/2026", "QTY.12 - *mull required* | Here: 4/24/2026".
      if ((m = line.match(/^qty\.?\s*(\d+)\b(.*)$/i))) {
        const n = Number(m[1]);
        if (!vendor || vendor.qty != null) { vendor = { brand: f.brand, qty: null, here: "" }; f.vendors.push(vendor); }
        vendor.qty = n;
        f.qty = (f.qty || 0) + n;
        for (const part of m[2].split("|")) {
          const here = part.match(new RegExp(`(?:here|received)\\s*:?\\s*${DATE}`, "i"));
          if (here) { vendor.here = here[1]; f.received.push(here[1]); continue; }
          const star = part.match(/\*([^*]+)\*/);
          if (star) f.headsUp.push(softenCaps(star[1].trim()));
        }
        mode = null;
        return;
      }
      if (/^\d{1,2}\/\d{1,2}\s*[-–]\s*moved\b/i.test(line)) { f.moves.push(line); return; }
      if ((m = line.match(new RegExp(`^(?:here|received)\\s*:?\\s*${DATE}`, "i")))) {
        if (type === "service") addDetail("Parts received", m[1]); else f.received.push(m[1]);
        return;
      }
      if ((m = line.match(/^(?:here|received)\s*:?\s*(.*)$/i))) {
        if (m[1].trim()) { if (type === "service") addDetail("Parts received", m[1].trim()); else f.received.push(m[1].trim()); } else f.hidden.push(line);
        return;
      }
      if ((m = line.match(/^screens requested date\s*:?\s*(.+)$/i))) { addDetail("Screens requested", m[1].trim()); return; }
      if (/^\d+f$/i.test(line) || (line.length <= 50 && /sill pan|tyvek install|typar|zip install|standard install/i.test(line))) {
        addDetail("Install type", softenCaps(line));
        return;
      }
      if ((m = line.match(/^(amsco|andersen|pella|milgard|windor|western)\s+screen service\s*:?\s*(.*)$/i))) {
        setBrand(brandName(m[1]));
        addTag(`${brandName(m[1])} Screen Service`);
        if (scrub(m[2])) f.work.push(softenCaps(scrub(m[2])));
        return;
      }
      if (/product eta/i.test(line)) {
        const eta = line.match(new RegExp(`product eta\\s*[–-]?\\s*(wk of\\s*:?\\s*)?${DATE}`, "i"));
        if (eta) addDetail("Parts ETA", `${eta[1] ? "Wk of " : ""}${eta[2]}`); else f.hidden.push(line);
        return;
      }

      // Service template.
      if ((m = line.match(/^(.*?)\s*-?\s*per report\s*:\s*(.*)$/i))) {
        addTag(serviceTag(unstar(m[1])));
        const lineRef = (m[2].match(/\(\s*line\s*#?\s*:?\s*([\w-]+)\s*\)/i) || [])[1] || "";
        const body = m[2].replace(/\(\s*line\s*#?\s*:?\s*[\w-]+\s*\)/gi, " ").replace(/\*?\s*orig(?:inal)?\.?\s*po\s*#?\s*:?\s*[\w\s\\/-]*\*?/gi, " ")
          .replace(/[*]/g, " ").replace(/\s+/g, " ").replace(/[\s\-–]+$/, "").trim();
        if (body) f.issues.push({ text: softenCaps(body), line: lineRef });
        mode = null;
        return;
      }
      if ((m = line.match(/^(?:tech(?:nician)?\s*(?:instructions|notes)|installer instructions)\s*:?\s*(.*)$/i))) {
        if (m[1].trim()) f.work.push(softenCaps(m[1].trim())); else f.merged += 1; // bare heading
        mode = "work";
        return;
      }
      if ((m = line.match(/^location\s*@?\s*site\s*:?\s*(.*)$/i))) {
        if (m[1].trim()) addDetail("Location", m[1].trim()); else f.merged += 1; // bare heading
        mode = "location";
        return;
      }
      if ((m = line.match(PERSON_RE))) {
        const role = ROLE[m[1].toLowerCase()] || ROLE[m[1].toLowerCase().replace("/", "")] || "Contact";
        const who = /[a-z]/.test(m[2]) ? m[2].trim() : tagCase(m[2].trim());
        person = addPerson(role, who);
        mode = "person";
        return;
      }
      if (mode === "person" && person && (/^(email|phone|cell)\s*:/i.test(line) || (/@|\d{3}[\s.-]\d{3}[\s.-]\d{4}/.test(line) && line.replace(/\S+@\S+|[\d().\s-]+|email|phone|cell|:/gi, "").length < 4))) {
        const bits = line.replace(/\b(email|phone|cell)\s*:\s*/gi, " ").trim().split(/\s{2,}|\s+(?=\(?\d{3}\)?[.\-\s]\d{3})/).map((s) => s.trim()).filter(Boolean);
        if (bits.length) person.text = [person.text, ...bits].filter(Boolean).join(" · "); else f.merged += 1; // empty label line
        return;
      }
      if ((m = line.match(COORD_RE)) && line.length < 80) { addPerson("Service coord.", (tagCase(m[1]) + m[2]).trim()); mode = null; return; }
      if (/^complete\b|^\(?job is complete|^per\s+(?:tech|install(?:er)?)\b|^(?:reschedule|incomplete)\b/i.test(line)) { f.result.push(line); mode = "result"; return; }
      if (mode === "result") { f.result.push(line); return; }

      // Heads up: starred / !!! lines, backorders.
      if (starred) { f.headsUp.push(softenCaps(unstar(raw))); mode = null; return; }
      if (/\bb\/o\b|back\s*order/i.test(line)) { f.headsUp.push(softenCaps(line)); return; }

      // Short tag headers: "ANDERSEN INVESTIGATION/ADJUST", "Milgard warranty", "Bonelli Investigation – ...".
      if ((m = line.match(/^((?:(?:amsco|andersen|pella|windor|western|milgard|jeld-?wen|bonelli)\s*\/?\s*)?(?:warr?a?n?ty|wty|investigation(?:\s*\/\s*adjust)?|adjust(?:ment)?|service))\s*(?:[–-]\s*(.*))?$/i)) && m[1].length <= 40) {
        setBrand(brandName((m[1].match(BRAND_RE) || [])[1]));
        addTag(serviceTag(m[1].replace(/\s*\/\s*/g, "/").trim()).replace(/ \/ /g, "/"));
        if (m[2]) f.work.push(softenCaps(m[2].trim()));
        mode = null;
        return;
      }

      if (mode === "work") { f.work.push(softenCaps(line)); return; }
      if (mode === "location") { addDetail("Location", [f.details.find((d) => d.k === "Location")?.v, line].filter(Boolean).join(", "), true); return; }
      if (type === "return" || type === "custom" || VERB_RE.test(line)) { f.work.push(softenCaps(line)); return; }
      f.other.push(softenCaps(line));
  };
  for (const rawLine of text.split("\n")) {
    const raw = rawLine.trim();
    if (!raw) continue;
    f.lineCount += 1;
    const before = snapshot();
    handle(raw);
    if (snapshot() !== before) f.placed += 1;
    else f.unplaced.push(raw);
  }
  if (!f.brand) setBrand(brandName((String(text).match(BRAND_RE) || [])[1]));
  const clean = (list) => list.map(scrub).filter(Boolean);
  f.work = clean(f.work); f.headsUp = clean(f.headsUp); f.other = clean(f.other); f.result = clean(f.result);
  f.issues = f.issues.map((i) => ({ ...i, text: scrub(i.text) })).filter((i) => i.text);
  f.people = f.people.map((p) => ({ ...p, text: scrub(p.text) })).filter((p) => p.text);
  f.details = f.details.map((d) => ({ ...d, v: /date|ordered|eta|received|requested/i.test(d.k) ? d.v : scrub(d.v) })).filter((d) => d.v);
  return f;
}

// The calendar text as written, minus what the page keeps out of visits (PO/OE and
// vendor-order lines, rep pairs, money lines) — for the "Original calendar notes" toggle.
export function visibleNotes(ev) {
  const hidden = new Set(visitFields(ev).hidden);
  return plainText(ev?.scope_notes).split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((raw) => !hidden.has(raw.replace(/^(?:[*•·]\s+|-\s+)+/, "").replace(/\s+/g, " ").trim()))
    .map(scrub).filter(Boolean).join("\n");
}
