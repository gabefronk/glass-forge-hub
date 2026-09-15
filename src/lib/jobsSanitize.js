// Centralized presentation-only sanitizer for the Jobs section.
// Strips money-bearing clauses/lines and pricing labels from any text BEFORE
// it is rendered. Never mutates source records — pass rendered strings through
// sanitizeText() and render the result. Also exposes jobsStatus(), a wrapper
// around jobStatus() that never surfaces the "No charge" fallback label.

import { jobStatus, C } from "@/lib/feeUI";

// A bare dollar amount: $75, $1,791, $ 150, 150 dollars, 150 usd
const DOLLAR_RE = /\$\s?\d+(?:[,.]\d{1,2})?|\b\d+(?:[,.]\d{1,2})?\s*(?:dollars?|usd)\b/i;

// Multi-word phrases that are inherently billing and have no operational meaning.
const BILLING_PHRASE_RE = /\b(?:half\s+already\s+paid|remainder\s+to\s+invoice|profit\s+split|no\s+charge|chargeable|amount\s+(?:paid|due|remaining)|labor\s+fee|install\s+price|invoice\s+pricing|sub\s*pay|subpay)\b/i;

// A line that is ONLY a billing label, optionally followed by a separator and a
// number/amount, and nothing else. e.g. "Total", "Profit", "Total: 1791", "Labor- $75".
const BARE_LABEL_LINE_RE = /^\s*(?:labor|fee|price|total|profit|remainder|charge|cost|paid|due|balance|subtotal|grand\s+total|deposit|owing|owed|net|gross|subpay|sub\s+pay)\b\s*[:\-]?\s*(?:\$?\s?\d+(?:[,.]\d{1,2})?\s*(?:dollars?|usd)?)?\s*$/i;

// Inline clause: a billing label, optional separator, then a dollar amount.
// Only matches when a dollar sign is present so operational "Labor: 2 men" survives.
const LABEL_AMOUNT_CLAUSE_RE = /\b(?:labor(?:\s+(?:fee|amt|amount|charge|cost))?|install\s+price|sub\s*pay|subpay|fee|price|total|profit(?:\s+split)?|remainder|charge|cost|paid|due|balance|subtotal|grand\s+total|deposit|owing|owed|net|gross)\b\s*[:\-]?\s*\$\s?\d+(?:[,.]\d{1,2})?\s*(?:dollars?|usd)?/gi;

// Standalone billing phrases to excise inline.
const INLINE_PHRASE_RE = /\b(?:half\s+already\s+paid|remainder\s+to\s+invoice|profit\s+split|no\s+charge|chargeable|amount\s+(?:paid|due|remaining)|labor\s+fee|install\s+price|invoice\s+pricing|sub\s*pay|subpay)\b/gi;

function cleanInline(line) {
  let l = line;
  l = l.replace(LABEL_AMOUNT_CLAUSE_RE, " ");
  l = l.replace(INLINE_PHRASE_RE, " ");
  l = l.replace(/\$\s?\d+(?:[,.]\d{1,2})?/g, " ");
  return l;
}

export function sanitizeText(input) {
  if (input == null) return "";
  const str = String(input);
  if (!str) return "";
  const out = str.split(/\n/).map((line) => {
    const t = line.trim();
    if (!t) return "";
    if (BARE_LABEL_LINE_RE.test(t)) return "";
    return cleanInline(line).trim();
  }).filter((l) => l !== "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Wrapper that never returns the "No charge" status — zero-labor jobs read as Active.
export function jobsStatus(rows) {
  const s = jobStatus(rows);
  if (s.key === "no_charge") {
    return { label: "Active", key: "active", bg: C.tagCal.bg, text: C.tagCal.text };
  }
  return s;
}