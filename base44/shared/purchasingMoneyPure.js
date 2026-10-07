// Pure helpers for the purchasingMoney backend: owner-id auth, payload
// validation, money rounding, and output sanitization. No I/O, no SDK.
// Imported by base44/shared/purchasingMoneyHandle.js (injectable handler) and
// by tests.
//
// Owner binding is by immutable auth user id (base44.auth.me().id), never
// role or email. Admin-only is NOT enough: multiple users are admin.
// Frontend twin: src/lib/purchasingMoneyAccess.js (reuses ownerAccess ids).
export const OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea',
  '6a8229a9801b2aef9278ff47',
]);

export const isPurchasingMoneyOwner = (user) => !!user && OWNER_IDS.has(user.id);

// Round to cents. Returns NaN for non-finite input so callers can reject
// overflow AFTER rounding (e.g. 1e308 -> Infinity).
export const roundMoney = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return NaN;
  return Math.round((x + Number.EPSILON * Math.max(1, Math.abs(x))) * 100) / 100;
};

// Accept null (withhold) or a finite nonnegative number ONLY. Reject undefined,
// empty string, strings, booleans, NaN, Infinity — no coercion at the boundary.
export const finiteNonneg = (v) =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

export const ALLOWED_SAVE_FIELDS = new Set([
  'action', 'job_id', 'rough_labor_material', 'sale_price',
]);
export const ALLOWED_LIST_FIELDS = new Set(['action']);

// Validate a save payload BEFORE any entity read. A money key that is OMITTED
// (not present) is preserved on the existing row — it never wipes. A key that
// IS present may be null (withhold) or a finite nonneg number. Rejects extra
// fields, missing/blank job_id, malformed amounts, and overflow after
// rounding. Returns { ok, job_id, hasRough, hasSale, rough_labor_material,
// sale_price } or { error }.
export function validateSavePayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'invalid_body' };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_SAVE_FIELDS.has(key)) return { error: 'unexpected_field', field: key };
  }
  const { job_id } = body;
  if (typeof job_id !== 'string' || !job_id.trim()) return { error: 'missing_job' };
  const hasRough = Object.prototype.hasOwnProperty.call(body, 'rough_labor_material');
  const hasSale = Object.prototype.hasOwnProperty.call(body, 'sale_price');
  if (!hasRough && !hasSale) return { error: 'no_fields' };
  let rlm, sp;
  if (hasRough) {
    if (!finiteNonneg(body.rough_labor_material)) return { error: 'invalid_rough_labor_material' };
    rlm = body.rough_labor_material === null ? null : roundMoney(body.rough_labor_material);
    if (!Number.isFinite(rlm)) return { error: 'invalid_rough_labor_material' };
  }
  if (hasSale) {
    if (!finiteNonneg(body.sale_price)) return { error: 'invalid_sale_price' };
    sp = body.sale_price === null ? null : roundMoney(body.sale_price);
    if (!Number.isFinite(sp)) return { error: 'invalid_sale_price' };
  }
  return { ok: true, job_id: job_id.trim(), hasRough, hasSale, rough_labor_material: rlm, sale_price: sp };
}

// List body must carry only `action`. Strict keys on every action.
export function validateListBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'invalid_body' };
  }
  for (const key of Object.keys(body)) {
    if (!ALLOWED_LIST_FIELDS.has(key)) return { error: 'unexpected_field', field: key };
  }
  return { ok: true };
}

// Return only the safe public fields of a money input row. Never leak internal
// metadata, created_by, or anything beyond what the card needs.
export function sanitizeInput(row) {
  if (!row) return null;
  return {
    id: row.id,
    job_id: row.job_id,
    rough_labor_material: row.rough_labor_material,
    sale_price: row.sale_price,
  };
}