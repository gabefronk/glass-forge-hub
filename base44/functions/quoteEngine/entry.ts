// GF Quoting Engine - Hub server function (branch: window-quoting-entities)
// AMSCO: formula engine on DimPricing ceiling grid (validated 16/16 exact offline).
// Pella: empirical anchor lookup with confidence bands. No external calls - catalog data only.
// Pure pricing/validation logic lives in ../../shared/quoteEnginePure.js and is unit-tested.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import {
  priceAmsco, pricePella, authorizeQuoteRequest, validateQuoteLines, summarizeValidationRules,
  projectQuoteResult
} from '../../shared/quoteEnginePure.js';
import { canQuoteFull } from '../../shared/quoteAccess.js';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const body = await req.json();
    const lines = body?.lines || [];
    // Authorize per vendor (final Oct 6, 9:16): AMSCO quoting is open to every
    // authenticated Hub user (including role 'user' and Jeremy Burr); Pella stays
    // admin/manager only. A user-role request carrying any Pella line is denied here,
    // before any catalog read. Managers (and any non-admin) receive sale-only fields;
    // internal cost is redacted. Admins retain full costs.
    const access = authorizeQuoteRequest(user, lines);
    if (!access.allowed) return Response.json({ ok: false, error: 'forbidden', reason: access.reason }, { status: 403 });
    // canSeeCost: admins (full cost) OR the narrow id allowlist (Jeremy/Israel). The projection
    // redacts dealer/internal fields for everyone else. isAdmin param is the "show full cost" flag.
    const canSeeCost = !!user && (String(user.role || '').toLowerCase() === 'admin' || canQuoteFull(user));

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
    const results = lines.map(line => {
      const pricing = line.vendor === 'AMSCO'
        ? priceAmsco(line, gridRows, adders, tiers, seriesRows)
        : pricePella(line, pellaAnchors);
      return projectQuoteResult(line, pricing, { isAdmin: canSeeCost });
    });
    return Response.json({ ok: true, results, validation: summarizeValidationRules(validationRules) });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
});