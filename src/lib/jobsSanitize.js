// Centralized presentation-only sanitizer for the Jobs section.
// Strips money-bearing segments/lines and pricing labels from any text BEFORE
// it is rendered. Never mutates source records — pass rendered strings through
// sanitizeText() and render the result. Also exposes jobsStatus(), a wrapper
// around jobStatus() that never surfaces the "No charge" fallback label.
//
// Pipeline:
//   1. Remove "install" ticket/amount markers (install + separator + ticket/amount)
//      as a unit — only when install is followed by a separator and then ONLY a
//      ticket/amount marker (or nothing), so operational "finish install",
//      "install complete", "Installer to install" are preserved.
//   2. Strip inline dollar amounts and label+amount clauses from each line.
//   3. Split each line into clauses (on commas, semicolons, bullets) and drop any
//      clause that contains a billing concept. Empty clauses disappear.
//   4. Clean orphaned separator punctuation and collapse whitespace.

import { jobStatus, C } from "@/lib/feeUI";
import { protectUrls, urlPathWords } from "@/lib/fileLinks";

// Tier 2: "install" as a billing/ticket marker.
// Requires a separator after install AND that only a ticket/amount marker (or
// nothing) follows before the next clause boundary — so "install - windows
// delayed" survives but "INSTALL – WIN", "INSTALL - $75", "install:" (eol) drop.
const INSTALL_MARKER_RE =
  /\binstall\b\s*[-–—:]+\s*(?:win\d?|wty|warranty|\$?\s?\d+(?:[,.]\d{1,2})?\s*(?:dollars?|usd)?)?(?=\s*[,;·•\n]|$)/gi;

// Tier 1: concepts that make a whole clause pricing. If a clause contains any,
// the entire clause is dropped. "install" is intentionally absent — handled above.
const BILLING_CONCEPT_RE = new RegExp(
  "\\b(?:" + [
    "trip\\s+charge",
    "sub\\s*pay", "subpay",
    "labor\\s+(?:fee|amt|amount|charge|cost)",
    "install\\s+price",
    "invoice\\s+pricing",
    "profit\\s+split",
    "no\\s+charge",
    "chargeable",
    "amount\\s+(?:paid|due|remaining)",
    "remainder\\s+to\\s+invoice",
    "half\\s+already\\s+paid",
    "grand\\s+total",
    "labor", "fee", "price", "total", "profit", "remainder", "charge", "cost",
    "paid", "balance", "subtotal", "deposit", "owing", "owed", "net", "gross",
  ].join("|") + ")\\b",
  "i"
);

// Standalone billing phrases to excise inline (run before label-amount so
// multi-word phrases like "amount due" are removed whole, not split apart).
const INLINE_PHRASE_RE =
  /\b(?:half\s+already\s+paid|remainder\s+to\s+invoice|profit\s+split|no\s+charge|chargeable|amount\s+(?:paid|due|remaining)|labor\s+fee|install\s+price|invoice\s+pricing|sub\s*pay|subpay|trip\s+charge)\b/gi;

// Inline: a billing label + a dollar amount (e.g. "Labor- $75", "Trip charge $75").
const LABEL_AMOUNT_CLAUSE_RE =
  /\b(?:trip\s+charge|labor(?:\s+(?:fee|amt|amount|charge|cost))?|install\s+price|sub\s*pay|subpay|fee|price|total|profit(?:\s+split)?|remainder|charge|cost|paid|due|balance|subtotal|grand\s+total|deposit|owing|owed|net|gross)\b\s*[:\-]?\s*\$\s?\d+(?:[,.]\d{1,2})?\s*(?:dollars?|usd)?/gi;

function cleanInline(line) {
  let l = line;
  l = l.replace(INLINE_PHRASE_RE, " ");
  l = l.replace(LABEL_AMOUNT_CLAUSE_RE, " ");
  l = l.replace(/\$\s?\d+(?:[,.]\d{1,2})?/g, " ");
  return l;
}

// Split a line into sub-clauses on inline separators (comma, semicolon, bullet).
// Dashes stay attached so "INSTALL – WIN" and "DR Horton - Daybreak" remain whole.
function splitClauses(line) {
  return line.split(/\s*[,;·•]\s*/).map((s) => s.trim()).filter(Boolean);
}

function isPricingClause(clause) {
  return BILLING_CONCEPT_RE.test(clause);
}

export function sanitizeText(input) {
  if (input == null) return "";
  let str = String(input);
  if (!str) return "";

  // 0. Hold links aside so hosts like "cloudfront.net" or commas in a link never
  //    trigger clause drops or splits. A link whose own path names a billing
  //    concept (e.g. ".../Price-Sheet.pdf") is left in place and filtered as before.
  const links = protectUrls(str, (url) => !BILLING_CONCEPT_RE.test(urlPathWords(url)));
  str = links.text;

  // 1. Remove install ticket/amount markers as units.
  str = str.replace(INSTALL_MARKER_RE, " ");

  // 2–3. Per line: strip inline amounts, split into clauses, drop pricing clauses.
  const keptLines = [];
  for (const rawLine of str.split(/\n/)) {
    const cleaned = cleanInline(rawLine);
    const surviving = splitClauses(cleaned).filter((c) => !isPricingClause(c));
    if (surviving.length) keptLines.push(surviving.join(", "));
  }

  // 4. Clean orphaned separator punctuation and collapse whitespace.
  let out = keptLines.join("\n");
  out = out
    .replace(/^[-–—:·•,;]+|[-–—:·•,;]+$/gm, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return links.restore(out);
}

// Feed-specific cleaning for long operational text (scope notes, report
// messages, note bodies). Runs sanitizeText first, then strips <mailto:...>
// angle-bracket artifacts (keeping the bare address), de-duplicates adjacent
// repeated emails, and collapses 3+ consecutive newlines down to 2.
export function cleanFeedText(input) {
  let s = sanitizeText(input);
  if (!s) return "";
  s = s.replace(/<mailto:([^>]+)>/gi, "$1");
  s = s.replace(/([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})([\s,;]*)\1/gi, "$1");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// Wrapper that never returns the "No charge" status — zero-labor jobs read as Active.
// evidence: optional field-report evidence, see jobReports.buildReportEvidence.
// today: optional YYYY-MM-DD override (tests); defaults to the Denver date.
export function jobsStatus(rows, evidence, today) {
  const s = jobStatus(rows, evidence, today);
  if (s.key === "no_charge") {
    return { label: "Active", key: "active", bg: C.tagCal.bg, text: C.tagCal.text };
  }
  return s;
}