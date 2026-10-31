import { jsPDF } from "jspdf";
import { invoiceArial, invoiceArialBold } from "@/lib/invoiceFonts";
import { invoiceTotals, invoiceType, lineAmount, paymentSchedule, hasBankDetails } from "@/lib/yaInvoice";

// The YA Windows & Doors customer invoice PDF (Gabe, Oct 31), laid out like his Arena invoice
// YA-260916-01 in neutral colors. Built only from the saved invoice document, so a reprint is
// the same invoice. Attachments (W-9, certificate of insurance) are appended with pdf-lib.
const HEAD = "#22302F", TINT = "#F3F4F3", DUE = "#E3EEEB", DUE_INK = "#0B3F3B", RULE = "#CDD2D0", INK = "#1D2526", SOFT = "#4A5557";
const money = (n) => `${Number(n) < 0 ? "-" : ""}$${Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (v) => String(v ?? "").replace(/\r\n?/g, "\n").replace(/�/g, "-");
export const longDate = (d) => {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
};

export function buildYaInvoicePdf(doc) {
  const c = doc.company || {};
  const type = invoiceType(doc.type);
  const totals = invoiceTotals(doc.lines || []);
  const schedule = paymentSchedule(doc.type, totals.total, doc.received || 0);
  const opt = doc.options || {};
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS("InvoiceArial.ttf", invoiceArial);
  pdf.addFont("InvoiceArial.ttf", "InvoiceArial", "normal");
  pdf.addFileToVFS("InvoiceArialBold.ttf", invoiceArialBold);
  pdf.addFont("InvoiceArialBold.ttf", "InvoiceArial", "bold");
  pdf.setProperties({ title: `${c.invoice_company_name || "YA Windows & Doors"} Invoice ${doc.number}`, author: c.invoice_company_name || "", subject: doc.project?.title || "" });
  const left = 48, width = 516, right = left + width, bottom = 740;
  let y = 44;
  const font = (size = 9, bold = false, color = INK) => { pdf.setFont("InvoiceArial", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(color); };
  const text = (value, x, top, size = 9, bold = false, color = INK, align = "left") => {
    font(size, bold, color);
    pdf.text(Array.isArray(value) ? value.map(clean) : clean(value), x, top + size * 0.85, { align, lineHeightFactor: 1.25 });
  };
  const wrap = (value, w, size = 9, bold = false) => { font(size, bold); return pdf.splitTextToSize(clean(value), w); };
  const box = (x, top, w, h, fill, stroke = true) => { pdf.setFillColor(fill); pdf.setDrawColor(RULE); pdf.setLineWidth(0.6); pdf.rect(x, top, w, h, stroke ? "FD" : "F"); };
  const hline = (x1, x2, top, color = RULE, w = 0.6) => { pdf.setDrawColor(color); pdf.setLineWidth(w); pdf.line(x1, top, x2, top); };
  const ensure = (h) => { if (y + h > bottom) { pdf.addPage(); y = 44; } };

  // Header: company left, INVOICE and its facts right.
  text("YA WINDOWS & DOORS", left, y, 19, true, HEAD);
  text("INVOICE", right, y - 2, 26, true, HEAD, "right");
  const coLines = [c.invoice_company_name, c.invoice_company_address, [c.invoice_phone, c.invoice_email].filter(Boolean).join(" · ")].filter(Boolean);
  text(coLines, left, y + 28, 9, false, SOFT);
  const facts = [["Invoice #:", doc.number], ["Date:", longDate(doc.date)], ["Terms:", doc.type === "half" ? "Deposit due upon acceptance" : "Due on receipt"], ...(doc.ref_quote ? [["Ref. quote:", doc.ref_quote]] : [])];
  facts.forEach(([k, v], i) => {
    font(9, false); const vw = pdf.getTextWidth(clean(v));
    text(v, right, y + 34 + i * 12, 9, false, INK, "right");
    text(k, right - vw - 4, y + 34 + i * 12, 9, true, INK, "right");
  });
  y += 40 + Math.max(coLines.length * 11.5, facts.length * 12);
  hline(left, right, y, HEAD, 1.4);
  y += 14;

  // Bill to / Project.
  const half = width / 2;
  const billLines = [...wrap(doc.bill_to?.attn ? `Attn: ${doc.bill_to.attn}` : "", half - 16), ...wrap(doc.bill_to?.address || "", half - 16)].filter(Boolean);
  const projLines = [...wrap(doc.project?.detail || "", half - 16), ...wrap(doc.project?.address ? `Job site: ${doc.project.address}` : "", half - 16)].filter(Boolean);
  const billName = wrap(doc.bill_to?.name || "", half - 16, 9.5, true);
  const projName = wrap(doc.project?.title || "", half - 16, 9.5, true);
  const bh = 26 + Math.max(billName.length + billLines.length, projName.length + projLines.length) * 11.5;
  [["BILL TO", billName, billLines], ["PROJECT", projName, projLines]].forEach(([label, name, rest], i) => {
    const x = left + i * half;
    box(x, y, half, 18, HEAD); text(label, x + 8, y + 5, 8.5, true, "#FFFFFF");
    box(x, y + 18, half, bh - 18, "#FFFFFF");
    text(name, x + 8, y + 25, 9.5, true);
    text(rest, x + 8, y + 25 + name.length * 11.5, 9, false, SOFT);
  });
  y += bh + 14;

  // Payment schedule (half down / final), else the amount due.
  if (schedule.rows.length) {
    box(left, y, width, 18, HEAD); text("PAYMENT SCHEDULE", left + 8, y + 5, 8.5, true, "#FFFFFF"); text("AMOUNT", right - 8, y + 5, 8.5, true, "#FFFFFF", "right");
    y += 18;
    schedule.rows.forEach((r, i) => {
      const note = r.note ? wrap(r.note, width - 150, 8) : [];
      const h = 22 + note.length * 10;
      box(left, y, width, h, r.status === "due" ? DUE : "#FFFFFF");
      text(`${i + 1}. ${r.label}${r.status === "received" ? " · thank you" : ""}`, left + 8, y + 6, 9.5, true, r.status === "due" ? DUE_INK : INK);
      if (note.length) text(note, left + 8, y + 19, 8, false, SOFT);
      text(money(r.amount), right - 8, y + (h - 14) / 2, r.status === "due" ? 13 : 11, true, r.status === "due" ? DUE_INK : INK, "right");
      y += h;
    });
    box(left, y, width, 22, TINT); text("PROJECT TOTAL", left + 8, y + 7, 9, true); text(money(totals.total), right - 8, y + 5, 12, true, INK, "right");
    y += 22 + 14;
  } else {
    box(left, y, width, 30, DUE); text("AMOUNT DUE", left + 10, y + 10, 10, true, DUE_INK); text(money(schedule.due), right - 10, y + 7, 15, true, DUE_INK, "right");
    y += 30 + 14;
  }

  // Lines: numbered windows / doors with size, qty and unit price; then labor and other charges.
  const items = (doc.lines || []).filter((l) => l.kind === "item");
  const charges = (doc.lines || []).filter((l) => l.kind !== "item");
  const cols = items.length ? [22, 230, 82, 34, 72, 76] : [width - 96, 96];
  const heads = items.length ? ["#", "Description", "Size (W × H)", "Qty", "Unit price", "Amount"] : ["Description", "Amount"];
  const aligns = items.length ? ["left", "left", "left", "right", "right", "right"] : ["left", "right"];
  const header = () => {
    let x = left; box(left, y, width, 18, HEAD, false);
    heads.forEach((h, i) => { text(h, aligns[i] === "right" ? x + cols[i] - 6 : x + 6, y + 5, 8.5, true, "#FFFFFF", aligns[i]); x += cols[i]; });
    y += 18;
  };
  const row = (cells, { fill = "#FFFFFF", bold = false, rule = RULE } = {}) => {
    const wrapped = cells.map((v, i) => wrap(v, cols[i] - 12, 9, bold));
    const h = Math.max(18, Math.max(...wrapped.map((w) => w.length)) * 11 + 7);
    if (y + h > bottom) { pdf.addPage(); y = 44; header(); }
    box(left, y, width, h, fill, false); hline(left, right, y + h, rule);
    let x = left;
    wrapped.forEach((w, i) => { if (w.length && w[0] !== "") text(w, aligns[i] === "right" ? x + cols[i] - 6 : x + 6, y + 4.5, 9, bold, INK, aligns[i]); x += cols[i]; });
    y += h;
  };
  const spanRow = (label, amount, opts = {}) => row(items.length ? ["", label, "", "", "", money(amount)] : [label, money(amount)], opts);
  ensure(60); header();
  items.forEach((l, i) => row([String(i + 1), l.description, l.size || "", String(l.qty ?? ""), money(l.unit), money(lineAmount(l))], { fill: i % 2 ? TINT : "#FFFFFF" }));
  if (items.length && charges.length) spanRow(`Materials subtotal (${totals.units} unit${totals.units === 1 ? "" : "s"})`, totals.items, { bold: true, rule: HEAD });
  charges.forEach((l) => spanRow(l.description, lineAmount(l)));
  spanRow("TOTAL", totals.total, { fill: TINT, bold: true, rule: HEAD });
  y += 4;
  text(items.length ? "Unit prices include Utah sales tax on materials. No other tax or fees." : "Prices include Utah sales tax on materials. No other tax or fees.", left, y, 8, false, SOFT);
  y += 18;

  // How to pay / Terms.
  const pay = [];
  if (opt.wire && hasBankDetails(c)) {
    pay.push(["Wire / ACH transfer", [`Bank: ${c.invoice_bank_name}`, c.invoice_bank_address, `Account name: ${c.invoice_account_name}`, `ABA routing: ${c.invoice_routing_number}`, `Account #: ${c.invoice_account_number}`, `Reference: Invoice ${doc.number}`].filter(Boolean)]);
  }
  if (opt.ach_link) {
    const reach = [c.invoice_email && `email ${c.invoice_email}`, c.invoice_phone && `call or text ${c.invoice_phone}`].filter(Boolean).join(" or ");
    pay.push(["ACH payment link", [`To pay online by bank transfer, ${reach || "reply to this invoice"} and ask for an ACH payment link for invoice ${doc.number}. We'll send a secure link. No card fees.`]]);
  }
  if (opt.check) pay.push(["Check", [`Make checks payable to ${c.invoice_checks_payable_to}. Write invoice ${doc.number} on the memo line and mail to ${c.invoice_company_address}.`]]);
  const terms = [doc.type === "half" ? `Deposit of ${money(schedule.due)} is due upon acceptance.` : `Amount due ${money(schedule.due)}, due on receipt.`];
  if (opt.terms) {
    terms.push("Deposit is non-refundable once materials are ordered (custom product).", "Final balance due at completion of installation.", "Changes after order placement may incur added cost and lead time.");
  }
  const colW = half - 16;
  const payLines = pay.map(([h, lines]) => [h, lines.flatMap((s) => wrap(s, colW, 8.5))]);
  const termLines = terms.map((s) => wrap(`• ${s}`, colW, 8.5));
  const payH = payLines.reduce((n, [, l]) => n + 14 + l.length * 10.6 + 4, 0);
  const termH = termLines.reduce((n, l) => n + l.length * 10.6 + 3, 0);
  const ph = 26 + Math.max(payH, termH);
  ensure(ph + 10);
  [[pay.length ? `PAYMENT INSTRUCTIONS${opt.wire && hasBankDetails(c) ? " · WIRE / ACH" : ""}` : "PAYMENT", 0], ["TERMS", 1]].forEach(([label, i]) => {
    const x = left + i * half;
    box(x, y, half, 18, HEAD); text(label, x + 8, y + 5, 8.5, true, "#FFFFFF");
    box(x, y + 18, half, ph - 18, "#FFFFFF");
  });
  let py = y + 26;
  payLines.forEach(([h, lines]) => { text(h, left + 8, py, 8.5, true); py += 13; text(lines, left + 8, py, 8.5, false, INK); py += lines.length * 10.6 + 5; });
  py = y + 26;
  termLines.forEach((l) => { text(l, left + half + 8, py, 8.5, false, INK); py += l.length * 10.6 + 3; });
  y += ph + 22;

  if (opt.signature) {
    ensure(50);
    y += 18;
    hline(left, left + half - 20, y, HEAD, 0.8); hline(left + half + 10, right, y, HEAD, 0.8);
    text("Customer acceptance · signature / date", left, y + 4, 8, false, SOFT);
    text("Printed name / title", left + half + 10, y + 4, 8, false, SOFT);
    y += 28;
  }
  const attached = [opt.w9 && doc.attachments?.w9 && "Form W-9", opt.coi && doc.attachments?.coi && "Certificate of insurance"].filter(Boolean);
  ensure(34);
  if (attached.length) { text(`Attached: ${attached.join(" · ")}`, left + width / 2, y, 9, false, SOFT, "center"); y += 14; }
  text("Thank you for your business!", left + width / 2, y, 10, true, INK, "center");

  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    pdf.setPage(p);
    hline(left, right, 758, RULE);
    text(`${c.invoice_company_name || ""} · Invoice ${doc.number}`, left, 763, 7.5, false, SOFT);
    text(`Page ${p} of ${pages}`, right, 763, 7.5, false, SOFT, "right");
  }
  const safe = String(doc.project?.title || "Job").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return { pdf, filename: `YA_Windows_Invoice_${safe}_${doc.number}.pdf`, type };
}

// Invoice pages plus attachments (PDF pages copied, images placed on a letter page).
export async function yaInvoiceBytes(doc, attachmentFiles = []) {
  const { pdf, filename } = buildYaInvoicePdf(doc);
  const base = pdf.output("arraybuffer");
  if (!attachmentFiles.length) return { bytes: new Uint8Array(base), filename };
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.load(base);
  for (const f of attachmentFiles) {
    if (f.type === "application/pdf") {
      const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
    } else {
      const img = f.type === "image/png" ? await out.embedPng(f.bytes) : await out.embedJpg(f.bytes);
      const page = out.addPage([612, 792]);
      const scale = Math.min(540 / img.width, 720 / img.height);
      page.drawImage(img, { x: (612 - img.width * scale) / 2, y: (792 - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
    }
  }
  return { bytes: await out.save(), filename };
}

export function saveBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
