import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { lookupManufacturerSpecs } from '../../shared/manufacturerSpecLookup.js';

// Read-only, authenticated manufacturer spec lookup for integration testing.
// No entity reads/writes, no arbitrary URL fetching — the shared helper only
// reaches official brand domains via the Anthropic web_fetch server tool.
const BOUNDS = { series: 200, product: 200, question: 1000, body: 8000 };

function validateInput(body) {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON' };
  const manufacturer = body.manufacturer;
  if (manufacturer !== 'Pella' && manufacturer !== 'AMSCO') return { error: 'manufacturer must be Pella or AMSCO' };
  const series = body.series;
  if (typeof series !== 'string' || !series.trim() || series.length > BOUNDS.series) return { error: 'series is required' };
  const product = body.product;
  if (typeof product !== 'string' || !product.trim() || product.length > BOUNDS.product) return { error: 'product is required' };
  const question = body.question;
  if (typeof question !== 'string' || !question.trim() || question.length > BOUNDS.question) return { error: 'question is required' };
  return { value: { manufacturer, series: series.trim(), product: product.trim(), question: question.trim() } };
}

export default async function(req) {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    let user;
    try { user = await base44.auth.me(); } catch { return Response.json({ error: 'Sign in required' }, { status: 401 }); }
    if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });

    const raw = await req.text();
    if (raw.length > BOUNDS.body) return Response.json({ error: 'Request too large' }, { status: 413 });
    let body;
    try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const input = validateInput(body);
    if (input.error) return Response.json({ error: input.error }, { status: 400 });

    const result = await lookupManufacturerSpecs(input.value);
    return Response.json({ ...result, diagnostic_revision: 'endpoint-probe-3' }, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}