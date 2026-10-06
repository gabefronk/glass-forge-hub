// A create error only proves "nothing was written" when the server answered
// with an explicit pre-write rejection (validation / auth / conflict). Network
// failures, timeouts, 5xx and missing responses are unknown outcomes.
const REJECTED_BEFORE_WRITE = new Set([400, 401, 403, 404, 409, 422]);

export function isVerifiedRejection(e) {
  const status = Number(e?.response?.status ?? e?.status);
  return REJECTED_BEFORE_WRITE.has(status);
}

export const createErrorMessage = (e, fallback) => e?.response?.data?.error || e?.message || fallback;