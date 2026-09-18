// Pure helpers for rendering links and file attachments in the Jobs section.
// No React and no "@/" imports, so node tests can load this file directly.

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

// Placeholder markers from the Unicode private-use area: they are not word
// characters, whitespace or separators, so text cleaners leave them alone.
const MARK_OPEN = String.fromCharCode(0xe000);
const MARK_CLOSE = String.fromCharCode(0xe001);
const MARK_RE = new RegExp(MARK_OPEN + "(\\d+)" + MARK_CLOSE, "g");

// Sentence punctuation that follows a pasted link is not part of it.
function trimUrl(raw) {
  const m = raw.match(/[.,;:!?)\]]+$/);
  return m ? raw.slice(0, -m[0].length) : raw;
}

// True when the URL points at a PDF by path (query strings and case ignored).
export function isPdfUrl(url) {
  if (typeof url !== "string" || !url) return false;
  if (/^data:application\/pdf[;,]/i.test(url)) return true;
  try {
    return /\.pdf$/i.test(new URL(url, "https://files.invalid").pathname);
  } catch {
    return false;
  }
}

// Short display name for a file URL ("plans.pdf"), falling back to "File".
export function fileLabel(url) {
  try {
    const name = decodeURIComponent(new URL(url, "https://files.invalid").pathname.split("/").pop() || "");
    return name || "File";
  } catch {
    return "File";
  }
}

// Split text into [{type:"text"|"link", value}] so http(s) links can be rendered as anchors.
export function splitLinks(text) {
  const s = text == null ? "" : String(text);
  const parts = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    if (m.index > last) parts.push({ type: "text", value: s.slice(last, m.index) });
    parts.push({ type: "link", value: url });
    last = m.index + url.length;
  }
  if (last < s.length) parts.push({ type: "text", value: s.slice(last) });
  return parts;
}

// Replace links with opaque placeholders so text cleaners that split on commas or
// match whole words never cut or drop them; `restore` puts the originals back.
// Links for which shouldProtect(url) is false are left in place for the cleaner.
export function protectUrls(text, shouldProtect = () => true) {
  const urls = [];
  const masked = String(text ?? "").replace(URL_RE, (raw) => {
    const url = trimUrl(raw);
    if (!shouldProtect(url)) return raw;
    urls.push(url);
    return MARK_OPEN + (urls.length - 1) + MARK_CLOSE + raw.slice(url.length);
  });
  return { text: masked, restore: (s) => String(s).replace(MARK_RE, (_, i) => urls[Number(i)] ?? "") };
}

// Path and file name only (not the host, not the query), with separators as spaces,
// for checking whether a link itself names a billing document.
export function urlPathWords(url) {
  try {
    const path = new URL(url).pathname;
    let decoded = path;
    try { decoded = decodeURIComponent(path); } catch {}
    return decoded.replace(/[-_./+]+/g, " ");
  } catch {
    return "";
  }
}
