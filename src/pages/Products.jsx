import { useMemo, useState } from "react";
import { ExternalLink, Package } from "lucide-react";
import { C } from "@/lib/feeUI";

// Section 1 — Manufacturers & Vendors reference table.
const MANUFACTURERS = [
  { name: "Amsco", website: "https://www.amscowindows.com/", series: "Studio", tier: "$" },
  { name: "Andersen", website: "https://www.andersenwindows.com/", series: "100 Series", tier: "$$" },
  { name: "Bonelli", website: "https://www.bonelli.com/", series: "Volume Doors", tier: "$$" },
  { name: "French Steel", website: "https://frenchsteel.com/", series: "Classic Series", tier: "$$$$$" },
  { name: "Jeldwen", website: "https://www.jeld-wen.com/en-us", series: "Siteline", tier: "$$$$" },
  { name: "La Cantina", website: "https://www.lacantinadoors.com", series: "Aluminum Wood", tier: "$$$" },
  { name: "Milgard", website: "https://www.milgard.com/", series: "V150", tier: "$" },
  { name: "Nu Vista", website: "https://nuvistawindows.com/index.php/en/", series: "Aluminum", tier: "$$$" },
  { name: "Pella", website: "https://www.pellaprodealer.com/", series: "Impervia", tier: "$$" },
  { name: "Weather Shield - Coming Soon", website: "https://weathershield.com/", series: "-", tier: "?" },
  { name: "Western", website: "https://westernwindowsystems.com/", series: "Classic", tier: "$$$$$" },
  { name: "Windor", website: "https://www.windorsystems.com/", series: "2750", tier: "$$" },
  { name: "Glenview Doors", website: "https://www.glenviewdoors.com/", series: "-", tier: "-" },
  { name: "Inicio Windows and Doors", website: "https://iniciowindows.com/", series: "-", tier: "-" },
  { name: "PRL", website: "https://prlglass.com/", series: "-", tier: "-" },
  { name: "FHC", website: "https://fhc-usa.com/", series: "-", tier: "-" },
  { name: "Glazetech", website: "https://www.glaztech.com/", series: "-", tier: "-" },
];

// Section 2 — Discount vs. Gross Margin lookup.
// Cost basis is 50% of list. Given discount d (fraction), margin = 100 - 50/(1-d).
// Given target margin g (fraction), discount = 1 - 0.5/(1-g).
const MARGIN_ROWS = Array.from({ length: 51 }, (_, margin) => {
  const g = margin / 100;
  const discount = (1 - 0.5 / (1 - g)) * 100;
  return { margin, discount: Number.isFinite(discount) ? discount : 0 };
});

function tierClass(tier) {
  if (tier === "?") return { bg: "#FAF0DA", text: "#6F4E10", border: "#EFDFB7" };
  if (tier === "-") return { bg: "#F4F1EA", text: "#8A8F93", border: "#E2DCD1" };
  return { bg: "#E2EEEB", text: "#082F2C", border: "#C7E4D2" };
}

export default function Products() {
  const [discountInput, setDiscountInput] = useState("");

  const calcResult = useMemo(() => {
    const d = parseFloat(discountInput);
    if (!Number.isFinite(d) || d < 0 || d > 100) return null;
    const margin = 100 - 50 / (1 - d / 100);
    return Number.isFinite(margin) ? margin : null;
  }, [discountInput]);

  return (
    <div className="flex flex-col" style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }}>
      {/* Dark-green hero */}
      <header className="shrink-0 px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-5" style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}>
        <div className="flex items-center gap-3">
          <Package className="h-7 w-7" style={{ color: "var(--gf-brass-300)" }} strokeWidth={1.8} strokeLinecap="round" />
          <h1 className="font-heading text-[30px] font-bold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Products</h1>
        </div>
        <p className="mt-2 text-[13px] max-w-[640px]" style={{ color: "var(--gf-sidebar-muted)" }}>
          Crew reference for manufacturers, vendors, and pricing math. No edits, no admin tools — just the lookup.
        </p>
      </header>

      <div className="px-[26px] max-[699px]:px-[18px] py-6 flex flex-col gap-6 max-w-[960px]">
        {/* Section 1 — Manufacturers & Vendors */}
        <section className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
            <h2 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>Manufacturers &amp; Vendors</h2>
          </div>
          <div className="overflow-x-auto obsidian-scroll">
            <table className="w-full text-left text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: C.headerBg }}>
                  <th className="px-5 py-2.5 font-semibold whitespace-nowrap" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Manufacturer</th>
                  <th className="px-5 py-2.5 font-semibold whitespace-nowrap" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Website</th>
                  <th className="px-5 py-2.5 font-semibold whitespace-nowrap" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Product Series</th>
                  <th className="px-5 py-2.5 font-semibold whitespace-nowrap text-right" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Price Tier</th>
                </tr>
              </thead>
              <tbody>
                {MANUFACTURERS.map((m, i) => (
                  <tr key={m.name} style={{ backgroundColor: i % 2 ? C.cardAlt : C.card, borderBottom: `1px solid ${C.rowBorder}` }}>
                    <td className="px-5 py-3 font-medium whitespace-nowrap" style={{ color: C.text }}>{m.name}</td>
                    <td className="px-5 py-3" style={{ color: C.textSecondary }}>
                      <a href={m.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:underline" style={{ color: "var(--gf-teal-600)" }}>
                        <span className="break-all">{m.website}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" style={{ color: C.textFaint }} />
                      </a>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap" style={{ color: C.textSecondary }}>{m.series}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <span className="inline-block font-mono-num text-[12px] font-semibold px-2.5 py-0.5 rounded-full" style={tierClass(m.tier)}>{m.tier}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[12px]" style={{ color: C.textMuted, borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
            Price tier is a rough relative guide only, not pricing.
          </p>
        </section>

        {/* Section 2 — Discount vs. Gross Margin */}
        <section className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
          <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
            <h2 className="font-heading text-[18px] font-bold" style={{ color: C.text, letterSpacing: "-0.02em" }}>Discount vs. Gross Margin</h2>
            <p className="mt-1.5 text-[12px]" style={{ color: C.textSecondary }}>
              Cost basis is 50% of list price. For a discount <span className="font-mono-num">d</span> off list, gross margin = 100 − 50/(1−d). For a target margin <span className="font-mono-num">g</span>, discount = 1 − 0.5/(1−g).
            </p>
          </div>

          {/* Calculator */}
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-end gap-3" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="discount-calc" className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Discount off list (%)</label>
              <input
                id="discount-calc"
                type="number"
                inputMode="decimal"
                min="0"
                max="100"
                step="0.01"
                value={discountInput}
                onChange={(e) => setDiscountInput(e.target.value)}
                placeholder="e.g. 44.44"
                className="rounded-[8px] px-3 text-[13px] focus:outline-none"
                style={{ height: "38px", width: "160px", border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Resulting gross margin</span>
              <div className="flex items-center rounded-[8px] px-3" style={{ height: "38px", minWidth: "160px", border: `1px solid ${C.border}`, backgroundColor: C.card }}>
                {calcResult !== null ? (
                  <span className="font-mono-num-bold text-[15px]" style={{ color: "var(--gf-teal-700)" }}>{calcResult.toFixed(2)}%</span>
                ) : (
                  <span className="text-[12px]" style={{ color: C.textFaint }}>Enter 0–100</span>
                )}
              </div>
            </div>
          </div>

          {/* Lookup table */}
          <div className="overflow-x-auto obsidian-scroll max-h-[420px]">
            <table className="w-full text-left text-[13px]" style={{ borderCollapse: "collapse" }}>
              <thead className="sticky top-0">
                <tr style={{ backgroundColor: C.headerBg }}>
                  <th className="px-5 py-2.5 font-semibold whitespace-nowrap" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Gross Margin %</th>
                  <th className="px-5 py-2.5 font-semibold whitespace-nowrap text-right" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Discount off List %</th>
                </tr>
              </thead>
              <tbody>
                {MARGIN_ROWS.map((row) => (
                  <tr key={row.margin} style={{ backgroundColor: row.margin % 2 ? C.cardAlt : C.card, borderBottom: `1px solid ${C.rowBorder}` }}>
                    <td className="px-5 py-2 font-mono-num whitespace-nowrap" style={{ color: C.text }}>{row.margin}%</td>
                    <td className="px-5 py-2 text-right font-mono-num whitespace-nowrap" style={{ color: C.textSecondary }}>{row.discount.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-[12px]" style={{ color: C.textMuted, borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
            Source chart labels: LIST at 0% margin (maximum discount) end; COST at 50% margin (full list price) end.
          </p>
        </section>
      </div>
    </div>
  );
}