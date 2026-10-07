// Pure helpers for the purchasingMoney backend: owner-id auth, payload
// validation, money rounding, and output sanitization. No I/O, no SDK.
// Imported by base44/functions/purchasingMoney/entry.ts and by tests.
//
// Owner binding is by immutable auth user id (base44.auth.me().id), never
// role or email. Admin-only is NOT enough: multiple users are admin.
// Frontend twin: src/lib/purchasingMoneyAccess.js (reuses ownerAccess ids).
export const OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea',
  '6a8229a9801b2aef9278ff47',
]);

export const isPurchasingMoneyOwner = (user) => !!user && OWNER_IDS.has(user.id);

export const roundMoney = (n) =>
  Math.round((Number(n) + Number.EPSILON * Math.max(1, Math.abs(Number(n)))) * 100) / 100;

// Accept null/empty (withhold) or a finite nonnegative number. Strings are
// rejected at the boundary so callers cannot smuggle arbitrary text.
export const finiteNonneg = (v) =>
  v == null || v === '' ||
  (typeof v === 'number' && Number.isFinite(v) && v >= 0);

export const ALLOWED_SAVE_FIELDS = new Set([
  'action', 'job_id', 'rough_labor_material', 'sale_price',
]);

// Validate a save payload BEFORE any entity read. Returns { ok, job_id,
// rough_labor_material, sale_price } or { error }. Rejects extra fields,
// missing/blank job_id, and malformed/negative amounts. Null amounts are
// valid (withhold the tile). Money is rounded to cents.
export function validateSavePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'invalid_body' };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_SAVE_FIELDS.has(key)) return { error: 'unexpected_field', field: key };
  }
  const { job_id, rough_labor_material, sale_price } = body;
  if (typeof job_id !== 'string' || !job_id.trim()) return { error: 'missing_job' };
  if (!finiteNonneg(rough_labor_material)) return { error: 'invalid_rough_labor_material' };
  if (!finiteNonneg(sale_price)) return { error: 'invalid_sale_price' };
  const rlm = rough_labor_material == null || rough_labor_material === '' ? null : roundMoney(rough_labor_material);
  const sp = sale_price == null || sale_price === '' ? null : roundMoney(sale_price);
  return { ok: true, job_id: job_id.trim(), rough_labor_material: rlm, sale_price: sp };
}

// Return only the safe public fields of a money input row. Never leak
// internal metadata, created_by, or anything beyond what the card needs.
export function sanitizeInput(row) {
  if (!row) return null;
  return {
    id: row.id,
    job_id: row.job_id,
    rough_labor_material: row.rough_labor_material,
    sale_price: row.sale_price,
  };
}