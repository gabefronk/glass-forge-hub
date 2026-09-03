import { isFutureRow } from "@/lib/feeMath";

// ── Blueprint (Light) Palette ───────────────────────────────────────────
export const C = {
  pageBg: "#EEF1F6",
  card: "#FFFFFF",
  cardAlt: "#F6F8FC",
  text: "#131A26",
  textSecondary: "#535E72",
  textMuted: "#616D81",
  textFaint: "#77839A",
  accent: "#2A5EA8",
  accentDark: "#FFFFFF",
  accentText: "#1E4A85",
  border: "#DDE3EC",
  borderStrong: "#CBD4E1",
  rowBorder: "#E9EDF4",
  rowHover: "#F8FAFD",
  headerBg: "#F6F8FC",
  headerText: "#616D81",
  tagBillable: { bg: "#E7EEFA", text: "#1E4A85", border: "#C3D4EE" },
  tagCal: { bg: "#F6F8FC", text: "#535E72", border: "#DDE3EC" },
  tagReview: { bg: "#FCF5E9", text: "#8A5A10", border: "#EEDAB4" },
  tagNoCharge: { bg: "#F6F8FC", text: "#657185", border: "#DDE3EC" },
  tagSplit: { bg: "#E7EEFA", text: "#1E4A85", border: "#C3D4EE" },
  tagBlocked: { bg: "#FBEDEA", text: "#8A4038", border: "#EFD2CA" },
  amber: "#8A5A10",
  amberLight: "#FCF5E9",
  accent18: "#E7EEFA",
  accent12: "#E7EEFA",
  accent06: "#F6F8FC",
  mutedBg: "#F6F8FC",
  mutedText: "#616D81",
  leftBarZero: "#DDE3EC",
  sidebarBg: "#FFFFFF",
  cardShadow: "0 1px 2px rgba(19,26,38,.05), 0 6px 16px -10px rgba(19,26,38,.14)",
  elevatedShadow: "0 1px 2px rgba(19,26,38,.05), 0 10px 24px -18px rgba(19,26,38,.22)",
  primaryBtn: "#2A5EA8",
  primaryBtnBorder: "#1E4A85",
  primaryBtnHover: "#234F8E",
  successDot: "#3B82F6",
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