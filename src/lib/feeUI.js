import { isFutureRow } from "@/lib/feeMath";
import { denverDate } from "../../base44/shared/billingCore.js";
import { visitsMissingReport, hasUpcomingVisit } from "@/lib/jobReports";

// ── Glass Forge Design Refresh palette ──────────────────────────────────
// Warm off-white canvas, opaque white surfaces, graphite nav, teal primary.
export const C = {
  pageBg: "#D9CBB0", // Sand & brass ground; cards sit white on it
  sheetBg: "#D9CBB0",
  card: "#FFFFFF",
  cardAlt: "#FAF8F3",
  text: "#101617",
  textSecondary: "#566063",
  textMuted: "#616A6D",
  textFaint: "#8A8F93",
  accent: "#0B3F3B",
  accentDark: "#FFFFFF",
  accentText: "#082F2C",
  border: "#D3CABB",
  borderStrong: "#E0DACF",
  rowBorder: "#EEE9E0",
  rowHover: "#F6F3EC",
  headerBg: "#FAF8F3",
  headerText: "#616A6D",
  tagBillable: { bg: "#E2EEEB", text: "#082F2C", border: "#C7E4D2" },
  tagCal: { bg: "#E7EDF2", text: "#34506A", border: "#C7D8EF" },
  tagReview: { bg: "#FAF0DA", text: "#6F4E10", border: "#EFDFB7" },
  tagNoCharge: { bg: "#F4F1EA", text: "#566063", border: "#E2DCD1" },
  tagSplit: { bg: "#E2EEEB", text: "#082F2C", border: "#C7E4D2" },
  tagBlocked: { bg: "#FCEDEC", text: "#A43432", border: "#F0C9C5" },
  amber: "#6F4E10",
  amberLight: "#FAF0DA",
  accent18: "#EEF5F3",
  accent12: "#EEF5F3",
  accent06: "#F4F1EA",
  mutedBg: "#F4F1EA",
  mutedText: "#566063",
  leftBarZero: "#CEC6B8",
  sidebarBg: "#0E2426",
  cardShadow: "0 1px 2px rgba(21,24,26,.04), 0 16px 40px -28px rgba(21,24,26,.25)",
  elevatedShadow: "0 1px 2px rgba(21,24,26,.04), 0 8px 20px -12px rgba(21,24,26,.16)",
  primaryBtn: "#0B3F3B",
  primaryBtnBorder: "#093431",
  primaryBtnHover: "#093431",
  successDot: "#0B3F3B",
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
  if (isFutureRow(row)) return { label: "Scheduled", bg: C.tagCal.bg, text: C.tagCal.text };
  if (row.fee_type === "profit_split") return { label: "Split", bg: C.tagSplit.bg, text: C.tagSplit.text };
  if (isZeroRow(row)) return { label: "No charge", bg: C.tagNoCharge.bg, text: C.tagNoCharge.text };
  if ((row.needs_review || row._companion_review) && !row.manually_adjusted) return { label: "Review", bg: C.tagReview.bg, text: C.tagReview.text };
  if (row.billed_to_bfs) return { label: "Billed", bg: C.tagBillable.bg, text: C.tagBillable.text };
  return { label: "Ready", bg: C.tagBillable.bg, text: C.tagBillable.text };
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

// "Added" timestamp for job list rows: time of day when the job was added
// today (Denver), otherwise a short date. Mirrors ProBuild's job list.
export function addedTimestamp(createdDate) {
  if (!createdDate) return "";
  const denverFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" });
  const todayDenver = denverFmt.format(new Date());
  const createdDenver = denverFmt.format(new Date(createdDate));
  if (createdDenver === todayDenver) {
    return new Date(createdDate).toLocaleTimeString("en-US", { timeZone: "America/Denver", hour: "numeric", minute: "2-digit" });
  }
  return formatShort(createdDenver);
}

export function jobTotals(rows) {
  const labor = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const fee = rows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  const visits = rows.length;
  return { labor, fee, visits };
}

// evidence (optional): buildReportEvidence() from jobReports.js. With it, a visit whose
// own calendar event shows the report complete/waived no longer reads "Needs report".
export function jobStatus(rows, evidence = null, today = denverDate()) {
  if (!rows.length) return { label: "Active", bg: C.tagCal.bg, text: C.tagCal.text, key: "active" };
  const labor = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  if (labor === 0) return { label: "No charge", bg: C.tagNoCharge.bg, text: C.tagNoCharge.text, key: "no_charge" };
  const probuildRows = rows.filter(r => r.source === "probuild" || r.source === "both");
  if (visitsMissingReport(rows, evidence, today).length > 0) return { label: "Needs report", bg: C.tagReview.bg, text: C.tagReview.text, key: "needs_report" };
  // A job-match review hold (same rule as isMatchBlocked) is not a missing report.
  if (rows.some(r => r.needs_review && !r.manually_adjusted)) return { label: "Needs review", bg: C.tagBlocked.bg, text: C.tagBlocked.text, key: "needs_review" };
  if (hasUpcomingVisit(rows, evidence, today)) return { label: "Active", bg: C.tagCal.bg, text: C.tagCal.text, key: "active" };
  // Past visits with nothing missing (reported, waived or not required) are done too.
  const hasPastVisit = rows.some(r => r.source === "calendar" || r.source === "both");
  if (probuildRows.length > 0 || hasPastVisit) return { label: "Complete", bg: C.tagBillable.bg, text: C.tagBillable.text, key: "complete" };
  return { label: "Active", bg: C.tagCal.bg, text: C.tagCal.text, key: "active" };
}

export function crewName(email) {
  if (!email) return "";
  if (email === "gabriel.fronk.wd@gmail.com" || email === "gabefronk@gmail.com") return "Gabe";
  if (email === "iryedra@gmail.com") return "Ragen";
  return email.split("@")[0];
}