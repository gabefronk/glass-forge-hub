// Display-only title case for job names: capitalize the first letter of each
// word, leave letters that are already capitals alone ("AV24", "RETRO", "McKay").
// The stored name is never changed.
export function titleCase(value) {
  return String(value || "").replace(/(^|[\s\-–—/(&.,#])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}
