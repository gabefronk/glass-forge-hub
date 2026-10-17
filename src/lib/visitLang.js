// Per-login language for bilingual event notes (Gabriel 10/17: Israel sees
// Spanish, everyone else English). Display-only: the note text is untouched.
// Spanish crew by Hub login email; a name match covers a future Yelian account.
export const SPANISH_EMAILS = ["iryedra@gmail.com"];
const SPANISH_NAME_RE = /\b(israel|yelian)\b/i;

export function preferredLang(user) {
  const email = String(user?.email || "").toLowerCase();
  const name = String(user?.full_name || "");
  return SPANISH_EMAILS.includes(email) || SPANISH_NAME_RE.test(name) ? "es" : "en";
}

const MARK_RE = /^(english|ingl[eé]s|español|espanol|spanish)\.?$/i;

// Split a bullet list on English/Español marker lines and keep only the block
// for lang. If the list has no markers, or only the other language exists,
// return it unchanged.
export function filterLang(items, lang) {
  const hasMark = items.some((t) => MARK_RE.test(String(t).trim()));
  if (!hasMark) return items;
  const pre = [];
  const blocks = { en: [], es: [] };
  let cur = null;
  for (const t of items) {
    const m = String(t).trim().match(MARK_RE);
    if (m) { cur = /español|espanol|spanish/i.test(m[1]) ? "es" : "en"; continue; }
    if (cur) blocks[cur].push(t); else pre.push(t);
  }
  const mine = blocks[lang];
  const theirs = blocks[lang === "es" ? "en" : "es"];
  const pick = mine.length ? mine : theirs;
  if (!pick.length) return items;
  return [...pre, ...pick];
}
