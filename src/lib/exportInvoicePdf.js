import { jsPDF } from "jspdf";
import { invoiceArial, invoiceArialBold } from "@/lib/invoiceFonts";

// Presentation only. The caller owns eligibility; stored monetary values are
// deliberately preserved. Reference: GlassForge GF-2026-004 June 2026 DOCX.
const NAVY = "#1F4E79", PALE = "#F2F7FB", STRIPE = "#EBF3FB";
const INK = "#404040", BORDER = "#CCCCCC";
const money = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").replace(/\uFFFD/g, "-");
const fmtDate = (d) => {
  if (!d) return "";
  const [yy, mm, dd] = d.split("-");
  return `${Number(mm)}/${Number(dd)}/${yy}`;
};

export function buildInvoicePdf(month, rows) {
  const [year, m] = month.split("-").map(Number);
  const monthName = new Date(year, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const invoiceSeq = Math.max(1, (year - 2026) * 12 + (m - 3) + 1);
  const invoiceNum = `GF-${year}-${String(invoiceSeq).padStart(3, "0")}`;
  const lastDay = new Date(year, m, 0);
  const dateFormat = { month: "long", day: "numeric", year: "numeric" };
  const invoiceDate = lastDay.toLocaleDateString("en-US", dateFormat);
  const dueDate = new Date(lastDay.getTime() + 30 * 86400000).toLocaleDateString("en-US", dateFormat);
  const sortedRows = [...rows].sort((a, b) => (a.job_date || "").localeCompare(b.job_date || ""));
  const totalJobValue = sortedRows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const totalFee = sortedRows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS("InvoiceArial.ttf", invoiceArial);
  pdf.addFont("InvoiceArial.ttf", "InvoiceArial", "normal");
  pdf.addFileToVFS("InvoiceArialBold.ttf", invoiceArialBold);
  pdf.addFont("InvoiceArialBold.ttf", "InvoiceArial", "bold");
  pdf.setProperties({ title: `Glass Forge Invoice ${invoiceNum}`, author: "Glass Forge LLC", subject: `${monthName} ${year} consulting services` });
  const left = 45, width = 468, bottom = 756;
  const cols = [205, 47.5, 68, 36, 69];
  let y = 36;
  const font = (size = 8, bold = false, color = INK) => {
    pdf.setFont("InvoiceArial", bold ? "bold" : "normal");
    pdf.setFontSize(size); pdf.setTextColor(color);
  };
  const text = (value, x, top, size = 8, bold = false, color = INK, align = "left") => {
    font(size, bold, color);
    pdf.text(Array.isArray(value) ? value.map(clean) : clean(value), x, top + size, { align, lineHeightFactor: 1.2 });
  };
  const box = (x, top, w, h, fill, border = true) => {
    pdf.setFillColor(fill); pdf.setDrawColor(BORDER); pdf.setLineWidth(.5);
    pdf.rect(x, top, w, h, border ? "FD" : "F");
  };
  const lines = (value, w, size = 8, bold = false) => {
    font(size, bold); return pdf.splitTextToSize(clean(value), w);
  };
  const newPage = () => { pdf.addPage(); y = 36; };
  const ensure = (height) => { if (y + height > bottom) newPage(); };

  // The two-color sender / recipient block from the supplied invoice.
  box(left, y, width / 2, 88, NAVY, false);
  box(left + width / 2, y, width / 2, 88, PALE, false);
  text("GLASS FORGE LLC", left + 10, y + 9, 18, true, "#FFFFFF");
  text("Consulting Services Invoice", left + 10, y + 31, 9, false, "#BDD7EE");
  ["620 N 2375 W, Lehi, Utah 84043", "gabriel.fronk.wd@gmail.com", "Owner: Gabriel Fronk"].forEach((s, i) => text(s, left + 10, y + 48 + i * 10, 8, false, "#FFFFFF"));
  const rx = left + width / 2 + 10;
  text("BILL TO", rx, y + 9, 9, true, NAVY);
  text("YA Windows and Doors", rx, y + 25, 10, true);
  ["Attention: Israel Yedra", "Salt Lake, Utah", "iryedra@gmail.com"].forEach((s, i) => text(s, rx, y + 39 + i * 11, 9));
  y += 96;

  const labels = ["INVOICE NUMBER", "INVOICE DATE", "SERVICE PERIOD", "PAYMENT TERMS", "DUE DATE"];
  const values = [invoiceNum, invoiceDate, `${monthName} 1â€“${lastDay.getDate()}, ${year}`, "Net 30", dueDate];
  const mw = width / 5;
  labels.forEach((label, i) => {
    const x = left + i * mw;
    box(x, y, mw, 15, NAVY); text(label, x + mw / 2, y + 3, 7, true, "#FFFFFF", "center");
    box(x, y + 15, mw, 19, PALE); text(values[i], x + mw / 2, y + 20, 8, i === 0, INK, "center");
  });
  y += 42;
  const description = `Consulting fee for window installation and service work performed by YA Windows and Doors during ${monthName} ${year}. Glass Forge LLC receives a consulting fee on all installation labor, service, and product sale values per consulting agreement.`;
  const descriptionLines = lines(description, width - 12, 8.5);
  const dh = 20 + descriptionLines.length * 10.2;
  box(left, y, width, dh, PALE);
  text("DESCRIPTION OF SERVICES", left + 6, y + 4, 9, true, NAVY);
  text(descriptionLines, left + 6, y + 17, 8.5);
  y += dh + 9;
  text(`ITEMIZED JOB LOG â€“ ${monthName.toUpperCase()} ${year}`, left, y, 9, true, NAVY);
  y += 17;
  const header = () => {
    let x = left;
    ["JOB / DESCRIPTION", "DATE", "JOB VALUE", "RATE", "GLASS FORGE FEE"].forEach((label, i) => {
      box(x, y, cols[i], 24, NAVY);
      const wrapped = lines(label, cols[i] - 8, 8, true);
      text(wrapped, x + cols[i] / 2, y + (24 - wrapped.length * 9.6) / 2, 8, true, "#FFFFFF", "center");
      x += cols[i];
    });
    y += 24;
  };
  header();
  sortedRows.forEach((r, index) => {
    // Show the job name, as in the reference, rather than a paragraph of crew notes.
    const name = r.job_name_raw || r.job_name_norm || r.line_description || "";
    // Var. is the reference's display convention for non-labor-based fees.
    const rate = r.fee_type === "profit_split" ? "Var." : `${Math.round((r.fee_pct || 0) * 100)}%`;
    const cells = [name, fmtDate(r.job_date), money(r.labor_amt), rate, money(r.fee_amt)].map((v, i) => lines(v, cols[i] - 10, 7.5));
    let remaining = Math.max(...cells.map(c => c.length)), offset = 0;
    // Usually one intact row; exceptionally tall text continues without clipping.
    while (remaining > 0) {
      const fullHeight = Math.max(16, remaining * 9 + 5.5);
      if (y + fullHeight > bottom && fullHeight <= bottom - 60) { newPage(); header(); }
      let capacity = Math.floor((bottom - y - 5.5) / 9);
      if (capacity < 1) { newPage(); header(); capacity = Math.floor((bottom - y - 5.5) / 9); }
      const count = Math.min(remaining, capacity), height = Math.max(16, count * 9 + 5.5);
      let x = left;
      cells.forEach((cell, i) => {
        box(x, y, cols[i], height, index % 2 ? STRIPE : "#FFFFFF");
        const part = cell.slice(offset, offset + count);
        if (part.length) {
          const align = i === 0 ? "left" : i === 2 || i === 4 ? "right" : "center";
          text(part, align === "left" ? x + 5 : align === "right" ? x + cols[i] - 5 : x + cols[i] / 2, y + 2.75, 7.5, false, INK, align);
        }
        x += cols[i];
      });
      y += height; remaining -= count; offset += count;
      if (remaining) { newPage(); header(); }
    }
  });

  ensure(44);
  const totalRow = (label, amount, fill, color) => {
    const labelWidth = cols[0] + cols[1] + cols[2];
    box(left, y, labelWidth, 22, fill);
    box(left + labelWidth, y, cols[3], 22, fill);
    box(left + labelWidth + cols[3], y, cols[4], 22, fill);
    text(label, left + labelWidth - 5, y + 6, 8, true, color, "right");
    text(money(amount), left + cols.reduce((a, b) => a + b, 0) - 5, y + 5, 9, true, color, "right");
    y += 22;
  };
  totalRow(`TOTAL YA WINDOWS JOB VALUE (${monthName.toUpperCase()} ${year})`, totalJobValue, "#BDD7EE", INK);
  totalRow("TOTAL GLASS FORGE CONSULTING FEE DUE:", totalFee, NAVY, "#FFFFFF");
  y += 10;
  const panels = [
    ["PAYMENT INFORMATION", `Please remit payment of ${money(totalFee)} by ${dueDate}.`, "Payable to: Glass Forge LLC", "gabriel.fronk.wd@gmail.com"],
    ["NOTES", "Fee structure varies by job type per consulting agreement.", `Invoice #${invoiceSeq} under Glass Forge / YA Windows consulting agreement.`, `Invoice ${invoiceNum}  |  Tax Year ${year}`],
  ];
  const panelLines = panels.map(panel => panel.slice(1).map(s => lines(s, width / 2 - 16, 8)));
  const ph = 25 + Math.max(...panelLines.map(arr => arr.reduce((sum, s) => sum + s.length * 9.6 + 2, 0)));
  ensure(ph + 36);
  panels.forEach((panel, i) => {
    const x = left + i * width / 2;
    box(x, y, width / 2, ph, PALE, false);
    pdf.setDrawColor(NAVY); pdf.setLineWidth(1.5); pdf.line(x, y, x, y + ph);
    text(panel[0], x + 8, y + 6, 9, true, NAVY);
    let py = y + 23;
    panelLines[i].forEach(s => { text(s, x + 8, py, 8); py += s.length * 9.6 + 2; });
  });
  y += ph + 14;
  pdf.setDrawColor(NAVY); pdf.setLineWidth(.75); pdf.line(left, y, left + width, y);
  text(`Glass Forge LLC  |  620 N 2375 W, Lehi, Utah 84043  |  gabriel.fronk.wd@gmail.com  |  Invoice ${invoiceNum}`, left + width / 2, y + 7, 7, false, "#888888", "center");
  return { pdf, filename: `GlassForge_Invoice_${invoiceNum}_${monthName}_${year}.pdf` };
}

export async function exportInvoicePdf(month, rows) {
  const { pdf, filename } = buildInvoicePdf(month, rows);
  pdf.save(filename);
}