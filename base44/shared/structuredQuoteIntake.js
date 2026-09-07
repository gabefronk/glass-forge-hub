import { normalizeEasyRequest } from './easyRequest.js';
import { buildQuotePlan } from './amscoQuotePlan.js';

const singleHung = style => /^(studio)?singlehung$/.test(String(style || '').toLowerCase().replace(/[^a-z]/g, ''));

// Called only after the server has interpreted the conversation. This bypasses
// the old prose grammar, while retaining recipe consent and the real planner.
export function normalizeConversationalSchedule(quote) {
  const clean = { ...structuredClone(quote), message: '', request_text: '', conversation: [], history: [] };
  const normalized = normalizeEasyRequest(clean);
  const unsupported = (quote.lines || []).some(line => line.style && !singleHung(line.style));
  if (!unsupported) return normalized;
  // The Single Hung recipe must not turn an unrecognized product into a made-up
  // configuration with Single Hung hardware, glass thickness or fin choices.
  normalized.quote.lines = normalized.quote.lines.map((line, index) => {
    const original = quote.lines[index];
    return original?.style && !singleHung(original.style) ? structuredClone(original) : line;
  });
  const checked = buildQuotePlan(normalized.quote);
  const issues = checked.issues || [];
  return { ...normalized, ok: checked.ok, issues, questions: [...new Set(issues.map(issue => issue.message))],
    ...(checked.ok ? { plan: checked.plan } : {}), preview: structuredClone(normalized.quote.lines) };
}
