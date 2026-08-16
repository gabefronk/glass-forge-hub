// Sanitize text for the installer calendar: remove all dollar figures and
// pricing-adjacent lines so crews never see money. Fail closed: if any "$"
// survives, drop the entire description and flag the event.

const PRICING_WORDS = ['labor', 'cost', 'price', 'quote', 'vpo', 'spr', 'invoice', 'bid', 'total'];

// A pricing word "adjacent to a number": the word and a digit appear on the
// same line. Conservative — drops the whole line toward hiding money.
function pricingWordAdjacentToNumber(line) {
  const lower = line.toLowerCase();
  if (!/\d/.test(line)) return false;
  for (const w of PRICING_WORDS) {
    if (lower.indexOf(w) !== -1) return true;
  }
  return false;
}

export function sanitizeForInstaller(text) {
  if (!text) return { text: '', flagged: false };
  const lines = String(text).split(/\r?\n/);
  const kept = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { kept.push(raw); continue; }
    if (line.includes('$')) continue;                  // drop any line with $
    if (pricingWordAdjacentToNumber(line)) continue;   // drop pricing+number line
    kept.push(raw);
  }
  let out = kept.join('\n').trim();
  // FAIL CLOSED: if any $ survived, drop everything and flag
  let flagged = false;
  if (out.includes('$')) {
    out = '';
    flagged = true;
  }
  return { text: out, flagged };
}