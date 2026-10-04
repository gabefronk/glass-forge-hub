import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { normalizeVendorQuote } from '../../shared/vendorQuoteParse.js';
import { QUOTE_SCHEMA, QUOTE_PROMPT, legacyTotals } from '../../shared/vendorQuoteSchema.js';
import { autofillBudget, budgetNameFor, fileNameHints } from '../../shared/jobBudgetAutofill.js';
import { computeJobBudget } from '../../shared/jobBudgetMath.js';

// TEMPORARY read-only probe: runs the quote extraction + autofill on stored budget PDFs and
// logs what the drop would fill. Writes nothing. Remove after verification.
export default async function budgetAutofillProbe(req) {
  const base44 = createClientFromRequest(req);
  const db = base44.asServiceRole.entities;
  const core = base44.asServiceRole.integrations.Core;
  const rows = await db.JobBudgets.list('-created_date', 10);
  const out = [];
  for (const r of rows || []) {
    if (!r.source_pdf_url || !/SANDY|AGREN|ANDERSEN100MULL|AMMON/i.test(r.source_pdf_url)) continue;
    try {
      const raw = await core.InvokeLLM({ prompt: QUOTE_PROMPT, response_json_schema: QUOTE_SCHEMA, file_urls: [r.source_pdf_url], add_context_from_internet: false });
      const quote = legacyTotals(normalizeVendorQuote(raw || {}));
      const name = budgetNameFor(quote, fileNameHints(r.source_pdf_name));
      if (name) quote.quote_name = name;
      const fill = autofillBudget(quote, { fileName: r.source_pdf_name });
      const c = computeJobBudget(fill.inputs);
      out.push({ id: r.id, file: r.source_pdf_name, name, po: quote.customer_po, levels: quote.price_levels, lines: quote.lines, inputs: fill.inputs, sources: fill.sources, notes: fill.notes, margin: c.actual_margin_pct, cost: c.total_cost_overhead, typed: r.inputs });
    } catch (e) { out.push({ id: r.id, error: String(e?.message || e) }); }
  }
  console.log(JSON.stringify(out));
  return Response.json({ out });
}
