// Bilingual visit notes: the feed shows each line in the viewer's preferred
// language. Israel and Yelian read Spanish; everyone else reads English. A
// ?feedlang=es (or =en) URL param overrides the viewer for testing.
//
// Calendar notes can carry the same content in both languages (one English
// line, one Spanish line). filterLang keeps only the lines that match the
// viewer's language. When no line clearly matches a language — all English
// notes for an English viewer, or a note with no language signal — the
// original list comes back unchanged so nothing ever disappears.

const SPANISH_SPEAKERS = new Set(["israel", "yelian"]);

// Spanish indicators: accents, ñ, inverted punctuation, and a few common
// words short enough to be safe as whole-word matches.
const SPANISH_RE = /[áéíóúüñ¿¡]/i;
const SPANISH_WORDS = /\b(?:el|la|los|las|un|una|unos|unas|de|del|que|con|por|para|sin|sobre|entre|como|pero|más|menos|también|ya|aún|todavía|aquí|allí|esto|eso|esa|ese|estos|esos|estas|ese|son|es|fue|ser|está|están|estaba|estaban|tiene|tienen|tener|hacer|hace|hacen|puede|pueden|va|van|fue|fueron|ventana|ventanas|puerta|puertas|instalación|instalar|reparar|revisión|garantía|servicio|cliente|casa|obra|trabajo|día|semana|mes|año|hora|mañana|tarde|noche|hoy|ayer|mañana|cuando|donde|quien|cómo|cuál|cuánto|por\s+qué|porque|sí|no|gracias|por\s+favor)\b/i;

function looksSpanish(text) {
  const s = String(text || "");
  if (!s.trim()) return false;
  if (SPANISH_RE.test(s)) return true;
  // Count Spanish whole-word hits; need at least two to avoid false positives
  // from short words that overlap English ("es", "ya", "va", "no", "sin").
  const hits = (s.match(new RegExp(SPANISH_WORDS.source, "gi")) || []).length;
  return hits >= 2;
}

export function preferredLang(authUser) {
  const name = `${authUser?.full_name || ""} ${authUser?.email || ""}`.toLowerCase();
  for (const speaker of SPANISH_SPEAKERS) {
    if (name.includes(speaker)) return "es";
  }
  return "en";
}

// Keep only the lines in the viewer's language. If filtering would remove
// everything (no line matched the language), return the original list so a
// note never comes back empty.
export function filterLang(lines, lang = "en") {
  if (!Array.isArray(lines) || lines.length === 0) return lines || [];
  if (lang === "en") {
    const en = lines.filter((l) => !looksSpanish(l));
    return en.length ? en : lines;
  }
  if (lang === "es") {
    const es = lines.filter((l) => looksSpanish(l));
    return es.length ? es : lines;
  }
  return lines;
}