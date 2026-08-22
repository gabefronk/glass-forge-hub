import { isFutureRow } from "@/lib/feeMath";

// ── Obsidian Palette ────────────────────────────────────────────────────
export const C = {
  pageBg: "#050606",
  card: "#121514",
  cardAlt: "#101312",
  text: "#FFFFFF",
  textSecondary: "rgba(255,255,255,.62)",
  textMuted: "rgba(255,255,255,.42)",
  textFaint: "rgba(255,255,255,.40)",
  accent: "#6EE7C0",
  accentDark: "#0A0C0C",
  accentText: "#6EE7C0",
  border: "rgba(255,255,255,.07)",
  borderStrong: "rgba(255,255,255,.10)",
  rowBorder: "rgba(255,255,255,.07)",
  headerBg: "rgba(255,255,255,.03)",
  headerText: "rgba(255,255,255,.40)",
  tagBillable: { bg: "rgba(110,231,192,.14)", text: "#6EE7C0" },
  tagCal: { bg: "rgba(255,255,255,.06)", text: "rgba(255,255,255,.62)" },
  tagReview: { bg: "rgba(255,138,122,.14)", text: "#FF8A7A" },
  tagNoCharge: { bg: "rgba(255,255,255,.05)", text: "rgba(255,255,255,.42)" },
  tagSplit: { bg: "rgba(110,231,192,.14)", text: "#6EE7C0" },
  amber: "#FF8A7A",
  amberLight: "rgba(255,138,122,.14)",
  accent18: "rgba(110,231,192,.14)",
  accent12: "rgba(110,231,192,.10)",
  accent06: "rgba(110,231,192,.06)",
  mutedBg: "rgba(255,255,255,.05)",
  mutedText: "rgba(255,255,255,.42)",
  leftBarZero: "rgba(255,255,255,.2)",
  sidebarBg: "#0B0D0D",
};

const GABE_EMAIL = "gabriel.fronk.wd@gmail.com";
const ISRAEL_EMAIL = "iryedra@gmail.com";

export function billingTier(row) {
  if (row.calendar_creator === GABE_EMAIL) return "gabe";
  if (row.calendar_creator === ISRAEL_EMAIL && row.calendar_organizer === ISRAEL_EMAIL) return "mine";
  return null;
}

const SERVICE_RE = /service|warranty|wty|warr|per report/i;
const INSTALL_RE = /install/i;

export function workType(row) {
  const labor = Number(row.labor_amt) || 0;
  const text = `${row.job_name_raw || ""} ${row.note_text || ""}`;
  const isService = SERVICE_RE.test(text);
  const isInstall = INSTALL_RE.test(text);
  if (isInstall && !isService) return "install";
  if (isService) return "service";
  if (labor > 0) return "service";
  return "zero";
}

export function noteTokens(noteText) {
  if (!noteText) return "";
  return noteText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^labor\s*\$/i.test(l))
    .join(" · ");
}

export function isZeroRow(row) {
  return Number(row.labor_amt) === 0;
}

export function statusTag(row) {
  if (isFutureRow(row)) return { label: "Scheduled", bg: C.amberLight, text: C.amber };
  if (row.fee_type === "profit_split") return { label: "Split", bg: C.tagSplit.bg, text: C.tagSplit.text };
  if (isZeroRow(row)) return { label: "No charge", bg: C.tagNoCharge.bg, text: C.tagNoCharge.text };
  if (row.needs_review && !row.manually_adjusted) return { label: "Review", bg: C.tagReview.bg, text: C.tagReview.text };
  if (row.billed_to_bfs) return { label: "Billed", bg: C.tagCal.bg, text: C.tagCal.text };
  return { label: "Billable", bg: C.tagBillable.bg, text: C.tagBillable.text };
}

export const UNBILLED_GRID = "grid grid-cols-[26px_minmax(130px,1fr)_90px_48px_82px_108px] gap-3";
export const JOB_GRID = "grid grid-cols-[26px_minmax(190px,1.6fr)_68px_minmax(130px,1.4fr)_96px_52px_82px_minmax(108px,116px)] gap-3";

export const CARD_SHADOW = "none";
export const ROW_SHADOW = "none";

export function formatDateGroup(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

// ── Job-level helpers ──────────────────────────────────────────────────────
export const JOBS_GRID = "grid grid-cols-[minmax(180px,1fr)_64px_96px_92px_78px_104px_18px] gap-3 items-center";

export function formatShort(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function jobTotals(rows) {
  const labor = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const fee = rows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  const visits = rows.length;
  return { labor, fee, visits };
}

export function jobStatus(rows) {
  if (!rows.length) return { label: "Active", bg: C.tagCal.bg, text: C.tagCal.text, key: "active" };
  const today = new Date().toISOString().slice(0, 10);
  const labor = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  if (labor === 0) return { label: "No charge", bg: C.tagNoCharge.bg, text: C.tagNoCharge.text, key: "no_charge" };
  const calendarRows = rows.filter(r => r.source === "calendar" || r.source === "both");
  const probuildRows = rows.filter(r => r.source === "probuild" || r.source === "both");
  const futureEvents = calendarRows.filter(r => (r.job_date || "") > today);
  const pastEvents = calendarRows.filter(r => (r.job_date || "") <= today);
  const hasNeedsReview = rows.some(r => r.needs_review);
  const pastWithNoReport = pastEvents.filter(r => !probuildRows.some(p => (p.job_date || "") === (r.job_date || "")));
  if (hasNeedsReview || pastWithNoReport.length > 0) return { label: "Needs report", bg: C.tagReview.bg, text: C.tagReview.text, key: "needs_report" };
  if (futureEvents.length > 0) return { label: "Active", bg: C.tagCal.bg, text: C.tagCal.text, key: "active" };
  if (probuildRows.length > 0) return { label: "Complete", bg: C.tagBillable.bg, text: C.tagBillable.text, key: "complete" };
  return { label: "Active", bg: C.tagCal.bg, text: C.tagCal.text, key: "active" };
}

export function crewName(email) {
  if (!email) return "";
  if (email === "gabriel.fronk.wd@gmail.com") return "Gabe";
  if (email === "iryedra@gmail.com") return "Ragen";
  return email.split("@")[0];
}