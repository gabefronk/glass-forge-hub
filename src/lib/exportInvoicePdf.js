import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";

const money = (n) =>
  `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (d) => {
  if (!d) return "";
  const [yy, mm, dd] = d.split("-");
  return `${Number(mm)}/${Number(dd)}/${yy}`;
};

function buildInvoiceHtml({ invoiceNum, invoiceSeq, monthName, year, invoiceDateStr, servicePeriod, dueDateStr, rows, totalJobValue, totalFee }) {
  const rowHtml = rows
    .map(
      (r) => `
    <tr>
      <td style="padding:5px 8px;border:1px solid #bbb;font-size:9px;">${r.line_description || r.job_name_raw || r.job_name_norm || ""}</td>
      <td style="padding:5px 8px;border:1px solid #bbb;font-size:9px;white-space:nowrap;">${fmtDate(r.job_date)}</td>
      <td style="padding:5px 8px;border:1px solid #bbb;font-size:9px;text-align:right;white-space:nowrap;">${money(r.labor_amt)}</td>
      <td style="padding:5px 8px;border:1px solid #bbb;font-size:9px;text-align:center;white-space:nowrap;">${Math.round((r.fee_pct || 0) * 100)}%</td>
      <td style="padding:5px 8px;border:1px solid #bbb;font-size:9px;text-align:right;white-space:nowrap;">${money(r.fee_amt)}</td>
    </tr>`
    )
    .join("");

  return `
    <div style="color:#000;font-family:Arial,Helvetica,sans-serif;">
      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
        <tr>
          <td style="padding:12px;border:1px solid #bbb;vertical-align:top;width:50%;">
            <div style="font-weight:bold;font-size:15px;letter-spacing:-0.01em;">GLASS FORGE LLC</div>
            <div style="font-size:10px;margin-top:2px;">Consulting Services Invoice</div>
            <div style="font-size:10px;">620 N 2375 W, Lehi, Utah 84043</div>
            <div style="font-size:10px;">gabriel.fronk.wd@gmail.com</div>
            <div style="font-size:10px;">Owner: Gabriel Fronk</div>
          </td>
          <td style="padding:12px;border:1px solid #bbb;vertical-align:top;width:50%;">
            <div style="font-weight:bold;font-size:10px;">BILL TO</div>
            <div style="font-weight:bold;font-size:11px;margin-top:2px;">YA Windows and Doors</div>
            <div style="font-size:10px;">Attention: Israel Yedra</div>
            <div style="font-size:10px;">Salt Lake, Utah</div>
            <div style="font-size:10px;">iryedra@gmail.com</div>
          </td>
        </tr>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-bottom:10px;">
        <tr>
          <td style="padding:8px;border:1px solid #bbb;width:20%;">
            <div style="font-weight:bold;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;color:#666;">Invoice Number</div>
            <div style="font-size:10px;margin-top:2px;">${invoiceNum}</div>
          </td>
          <td style="padding:8px;border:1px solid #bbb;width:18%;">
            <div style="font-weight:bold;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;color:#666;">Invoice Date</div>
            <div style="font-size:10px;margin-top:2px;">${invoiceDateStr}</div>
          </td>
          <td style="padding:8px;border:1px solid #bbb;width:24%;">
            <div style="font-weight:bold;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;color:#666;">Service Period</div>
            <div style="font-size:10px;margin-top:2px;">${servicePeriod}</div>
          </td>
          <td style="padding:8px;border:1px solid #bbb;width:14%;">
            <div style="font-weight:bold;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;color:#666;">Payment Terms</div>
            <div style="font-size:10px;margin-top:2px;">Net 30</div>
          </td>
          <td style="padding:8px;border:1px solid #bbb;width:24%;">
            <div style="font-weight:bold;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;color:#666;">Due Date</div>
            <div style="font-size:10px;margin-top:2px;">${dueDateStr}</div>
          </td>
        </tr>
      </table>

      <div style="margin-bottom:12px;font-size:10px;">
        <span style="font-weight:bold;">DESCRIPTION OF SERVICES</span>
        <span> Consulting fee for window installation and service work performed by YA Windows and Doors during ${monthName} ${year}. Glass Forge LLC receives 10% of all installation labor and service job values per consulting agreement.</span>
      </div>

      <div style="font-weight:bold;font-size:12px;margin-bottom:6px;">ITEMIZED JOB LOG — ${monthName.toUpperCase()} ${year}</div>

      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background-color:#f0f0f0;">
            <th style="padding:6px 8px;border:1px solid #bbb;text-align:left;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;width:44%;">Job / Description</th>
            <th style="padding:6px 8px;border:1px solid #bbb;text-align:left;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;width:11%;">Date</th>
            <th style="padding:6px 8px;border:1px solid #bbb;text-align:right;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;width:15%;">Job Value</th>
            <th style="padding:6px 8px;border:1px solid #bbb;text-align:center;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;width:8%;">Rate</th>
            <th style="padding:6px 8px;border:1px solid #bbb;text-align:right;font-size:7px;text-transform:uppercase;letter-spacing:0.05em;width:22%;">Glass Forge Fee</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml}
          <tr>
            <td colspan="4" style="padding:6px 8px;border:1px solid #bbb;font-weight:bold;font-size:9px;text-align:right;">TOTAL YA WINDOWS JOB VALUE (${monthName.toUpperCase()} ${year})</td>
            <td style="padding:6px 8px;border:1px solid #bbb;font-weight:bold;font-size:9px;text-align:right;white-space:nowrap;">${money(totalJobValue)}</td>
          </tr>
          <tr>
            <td colspan="4" style="padding:6px 8px;border:1px solid #bbb;font-weight:bold;font-size:9px;text-align:right;">TOTAL GLASS FORGE CONSULTING FEE DUE:</td>
            <td style="padding:6px 8px;border:1px solid #bbb;font-weight:bold;font-size:10px;text-align:right;white-space:nowrap;">${money(totalFee)}</td>
          </tr>
        </tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <tr>
          <td style="padding:12px;border:1px solid #bbb;vertical-align:top;width:50%;">
            <div style="font-weight:bold;font-size:10px;">PAYMENT INFORMATION</div>
            <div style="font-size:10px;margin-top:4px;">Please remit payment of ${money(totalFee)} by ${dueDateStr}.</div>
            <div style="font-size:10px;">Payable to: Glass Forge LLC</div>
            <div style="font-size:10px;">gabriel.fronk.wd@gmail.com</div>
          </td>
          <td style="padding:12px;border:1px solid #bbb;vertical-align:top;width:50%;">
            <div style="font-weight:bold;font-size:10px;">NOTES</div>
            <div style="font-size:10px;margin-top:4px;">Rate Structure: 10% of install labor and service job values.</div>
            <div style="font-size:10px;">Invoice #${invoiceSeq} under Glass Forge / YA Windows consulting agreement.</div>
            <div style="font-size:10px;">Invoice ${invoiceNum} &nbsp;|&nbsp; Tax Year ${year}</div>
          </td>
        </tr>
      </table>

      <div style="margin-top:14px;text-align:center;font-size:8px;color:#888;">
        Glass Forge LLC &nbsp;|&nbsp; 620 N 2375 W, Lehi, Utah 84043 &nbsp;|&nbsp; gabriel.fronk.wd@gmail.com &nbsp;|&nbsp; Invoice ${invoiceNum}
      </div>
    </div>
  `;
}

export async function exportInvoicePdf(month, rows) {
  const [y, m] = month.split("-").map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" });
  const invoiceSeq = Math.max(1, (y - 2026) * 12 + (m - 3) + 1);
  const invoiceNum = `GF-${y}-${String(invoiceSeq).padStart(3, "0")}`;
  const lastDay = new Date(y, m, 0);
  const invoiceDateStr = lastDay.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const servicePeriod = `${monthName} 1\u2013${lastDay.getDate()}, ${y}`;
  const dueDateObj = new Date(lastDay.getTime() + 30 * 86400000);
  const dueDateStr = dueDateObj.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const sortedRows = [...rows].sort((a, b) => (a.job_date || "").localeCompare(b.job_date || ""));
  const totalJobValue = sortedRows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const totalFee = sortedRows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);

  const html = buildInvoiceHtml({
    invoiceNum, invoiceSeq, monthName, year: y, invoiceDateStr, servicePeriod, dueDateStr,
    rows: sortedRows, totalJobValue, totalFee,
  });

  const container = document.createElement("div");
  container.style.cssText =
    "position:fixed;left:-9999px;top:0;width:800px;padding:24px;background:#fff;font-family:Arial,Helvetica,sans-serif;color:#000;";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
      logging: false,
    });

    const pdf = new jsPDF({ unit: "in", format: "letter" });
    const margin = 0.5;
    const imgWidth = 7.5;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const pageHeight = 11;
    const usableHeight = pageHeight - 2 * margin;
    const imgData = canvas.toDataURL("image/png");

    let heightLeft = imgHeight;
    let position = margin;

    pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
    heightLeft -= usableHeight;

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft);
      pdf.addPage();
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= usableHeight;
    }

    pdf.save(`GlassForge_Invoice_${invoiceNum}_${monthName}_${y}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}