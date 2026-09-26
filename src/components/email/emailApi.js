import { base44 } from "@/api/base44Client";

// One door to the emailAgent backend. Errors arrive as {error, detail} (sometimes with
// HTTP 200), so r.data.error is treated as a failure everywhere.
export async function emailCall(payload) {
  const r = await base44.functions.invoke("emailAgent", payload);
  const data = r?.data;
  if (data && typeof data === "object" && data.error) {
    const e = new Error(data.detail || String(data.error).replace(/_/g, " "));
    e.code = data.error;
    throw e;
  }
  return data || {};
}

// Shared button classes for the Email tab (44px tap targets on phones).
export const btnBase = "inline-flex min-h-11 sm:min-h-9 items-center justify-center gap-1.5 rounded-[9px] px-3 text-[12.5px] font-semibold whitespace-nowrap transition-colors disabled:opacity-50";
export const btnNeutral = { backgroundColor: "#FFFFFF", color: "var(--gf-ink)", border: "1px solid var(--gf-border)" };
export const btnPrimary = { backgroundColor: "var(--gf-teal-600)", color: "#f2eee8", border: "1px solid var(--gf-teal-700)" };
export const btnDanger = { backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)", border: "1px solid var(--gf-error-border)" };
