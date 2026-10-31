import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { jsPDF } from "jspdf";
import { invoiceArial, invoiceArialBold } from "@/lib/invoiceFonts";
import { yaLogoPng, YA_LOGO_RATIO } from "@/lib/yaLogo";
import { rebrandPlan, money } from "@/lib/quoteRebrand";

// Builds the YA copy of a supplier quote in the browser (Gabe, Oct 31). Each page is drawn
// from the original, the supplier details are painted over and YA's written in (the plan is
// quoteRebrand.js), and the page is saved as an image: nothing of the supplier's text
// survives underneath to be copied out. Then a YA summary / approval page, then the chosen
// install type guide.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const SCALE = 2.2;

async function pagesOf(doc) {
  const out = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => {
      const [, , c, d, e, f] = i.transform;
      const h = Math.hypot(c, d) || i.height || 8;
      const [x, base] = vp.convertToViewportPoint(e, f);
      return { str: i.str, x, y: base - h * 0.82, w: i.width, h: h * 1.02 };
    });
    out.push({ page, width: vp.width, height: vp.height, items });
  }
  return out;
}

const loadImage = (src) => new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
const canvasJpeg = (canvas) => new Promise((resolve) => canvas.toBlob((b) => resolve(b.arrayBuffer()), "image/jpeg", 0.9));

async function drawPage(p, plan, logo) {
  const vp = p.page.getViewport({ scale: SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
  ctx.fillStyle = "#FFFFFF";
  for (const r of plan.erase) ctx.fillRect(r.x * SCALE, r.y * SCALE, r.w * SCALE, r.h * SCALE);
  for (const l of plan.logos) {
    const w = Math.min(l.w, l.h * YA_LOGO_RATIO), h = w / YA_LOGO_RATIO;
    ctx.drawImage(logo, l.x * SCALE, l.y * SCALE, w * SCALE, h * SCALE);
  }
  ctx.fillStyle = "#1A1A1A"; ctx.textBaseline = "top";
  for (const t of plan.write) {
    ctx.font = `${t.bold ? "bold " : ""}${(t.size * SCALE).toFixed(1)}px Helvetica, Arial, sans-serif`;
    ctx.textAlign = t.align === "right" ? "right" : "left";
    ctx.fillText(t.text, t.x * SCALE, t.y * SCALE);
  }
  const jpg = await canvasJpeg(canvas);
  canvas.width = 0; canvas.height = 0;
  return { jpg, width: p.width, height: p.height };
}

// The YA page after the quote: what the customer pays (this quote at sell, installation,
// total), the flashing / install method, and an approval line.
function summaryPage({ company, job, quoteLabel, split, guideName }) {
  const pdf = new jsPDF({ unit: "pt", format: "letter", compress: true });
  pdf.addFileToVFS("InvoiceArial.ttf", invoiceArial); pdf.addFont("InvoiceArial.ttf", "InvoiceArial", "normal");
  pdf.addFileToVFS("InvoiceArialBold.ttf", invoiceArialBold); pdf.addFont("InvoiceArialBold.ttf", "InvoiceArial", "bold");
  const left = 48, right = 564, ink = "#1D2526", soft = "#4A5557", head = "#22302F";
  const t = (s, x, y, size = 10, bold = false, color = ink, align = "left") => { pdf.setFont("InvoiceArial", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(color); pdf.text(String(s), x, y, { align }); };
  pdf.addImage(yaLogoPng, "PNG", left, 36, 62 * YA_LOGO_RATIO, 62);
  t("QUOTE SUMMARY", right, 60, 20, true, head, "right");
  [company.invoice_company_name, company.invoice_company_address, [company.invoice_phone, company.invoice_email].filter(Boolean).join(" · ")].filter(Boolean)
    .forEach((s, i) => t(s, left, 116 + i * 12, 9, false, soft));
  t(job.canonical_name || "", right, 84, 11, true, ink, "right");
  if (job.address) t(job.address, right, 98, 9, false, soft, "right");
  let y = 168;
  pdf.setDrawColor(head); pdf.setLineWidth(1.2); pdf.line(left, y, right, y); y += 24;
  const row = (label, amount, bold = false) => { t(label, left, y, 10.5, bold); t(money(amount), right, y, 10.5, bold, ink, "right"); pdf.setDrawColor("#CDD2D0"); pdf.setLineWidth(0.6); pdf.line(left, y + 7, right, y + 7); y += 24; };
  row(`Windows and doors (${quoteLabel})`, split.product);
  if (split.install > 0) row("Installation, install material and equipment", split.install);
  row("Project total", split.sell, true);
  t("Prices include Utah sales tax on materials.", left, y, 8.5, false, soft); y += 32;
  t("FLASHING / INSTALL METHOD", left, y, 10, true, head); y += 16;
  t(guideName || "Not chosen yet", left, y, 11, true); y += 14;
  if (guideName) { t("The install guide for this method is attached on the following pages.", left, y, 9, false, soft); y += 14; }
  y += 40;
  pdf.setDrawColor(head); pdf.setLineWidth(0.8); pdf.line(left, y, 300, y); pdf.line(330, y, right, y);
  t("Customer approval · signature / date", left, y + 12, 8.5, false, soft);
  t("Printed name", 330, y + 12, 8.5, false, soft);
  y += 40;
  t("Approving this quote approves the products above and the flashing / install method shown.", left, y, 9, false, soft);
  return pdf.output("arraybuffer");
}

// Page images of the finished file for the panel's preview (Chrome may be set to download PDFs
// rather than show them, so the preview never relies on the browser's PDF viewer).
export async function previewImages(bytes, width = 900) {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const out = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    out.push(canvas.toDataURL("image/jpeg", 0.8));
    canvas.width = 0; canvas.height = 0;
  }
  await doc.destroy();
  return out;
}

// Everything: the rebranded quote pages, the YA summary page, the install guide.
export async function buildYaQuote({ sourceBytes, factor, company, job, quoteLabel, split, guideName = "", guideBytes = null }) {
  const doc = await pdfjs.getDocument({ data: sourceBytes }).promise;
  const pages = await pagesOf(doc);
  const plan = rebrandPlan(pages, { factor, company, job });
  const logo = await loadImage(yaLogoPng);
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  out.setTitle(`${company.invoice_company_name} quote · ${job.canonical_name || ""}`);
  out.setAuthor(company.invoice_company_name); out.setCreator("Glass Forge Hub"); out.setProducer("Glass Forge Hub");
  for (let i = 0; i < pages.length; i += 1) {
    const { jpg, width, height } = await drawPage(pages[i], plan.pages[i], logo);
    const img = await out.embedJpg(jpg);
    out.addPage([width, height]).drawImage(img, { x: 0, y: 0, width, height });
  }
  await doc.destroy();
  const summary = await PDFDocument.load(summaryPage({ company, job, quoteLabel, split, guideName }));
  (await out.copyPages(summary, summary.getPageIndices())).forEach((p) => out.addPage(p));
  if (guideBytes) {
    const guide = await PDFDocument.load(guideBytes, { ignoreEncryption: true });
    (await out.copyPages(guide, guide.getPageIndices())).forEach((p) => out.addPage(p));
  }
  return { bytes: await out.save(), supplier: plan.supplier, pages: pages.length };
}
