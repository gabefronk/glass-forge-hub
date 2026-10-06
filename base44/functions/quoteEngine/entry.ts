// GF Quoting Engine - Hub server function (branch: window-quoting-entities)
// AMSCO: formula engine on DimPricing ceiling grid (validated 16/16 exact offline).
// Pella: empirical anchor lookup with confidence bands. No external calls - catalog data only.
// Pure pricing/validation logic lives in ../../shared/quoteEnginePure.js and is unit-tested.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import {
  priceAmsco, pricePella, checkQuoteAccess, validateQuoteLines, summarizeValidationRules
} from '../../shared/quoteEnginePure.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Authorize: pricing/cost data is admin + manager only. Crew may not call this.
    const user = await base44.auth.me().catch(() => null);
    const access = checkQuoteAccess(user);
    if (!access.allowed) return Response.json({ ok: false, error: 'forbidden', reason: access.reason }, { status: 403 });

    const body = await req.json();
    const lines = body?.lines || [];
    const inputErrors = validateQuoteLines(lines);
    if (inputErrors.length) return Response.json({ ok: false, error: 'invalid input', details: inputErrors }, { status: 400 });

    const [seriesRows, adders, tiers, validationRules] = await Promise.all([
      base44.asServiceRole.entities.CatalogSeries.list('-created_date', 500),
      base44.asServiceRole.entities.PriceAdder.list('-created_date', 200),
      base44.asServiceRole.entities.TierDiscount.list('-created_date', 50),
      base44.asServiceRole.entities.ValidationRule.list('-created_date', 200).catch(() => []),
    ]);
    const amscoLines = lines.filter(l => l.vendor === 'AMSCO');
    const neededCodes = [...new Set(amscoLines.map(l => {
      const s = seriesRows.find(x => x.vendor === 'AMSCO' && x.series_name === l.product);
      return s ? s.price_code : null;
    }).filter(Boolean))];
    const gridChunks = await Promise.all(neededCodes.map(c =>
      base44.asServiceRole.entities.PriceGridRow.filter({ price_code: c }, '-created_date', 1000)));
    const gridRows = gridChunks.flat();
    const pellaSeries = [...new Set(lines.filter(l => l.vendor !== 'AMSCO').map(l => String(l.series || '')))];
    const pellaChunks = await Promise.all(pellaSeries.map(s =>
      base44.asServiceRole.entities.PellaEmpiricalPrice.filter({ series: s }, '-created_date', 2000)));
    const pellaAnchors = pellaChunks.flat();
    const results = lines.map(line =>
      line.vendor === 'AMSCO'
        ? { ...line, pricing: priceAmsco(line, gridRows, adders, tiers, seriesRows) }
        : { ...line, pricing: pricePella(line, pellaAnchors) }
    );
    return Response.json({ ok: true, results, validation: summarizeValidationRules(validationRules) });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});