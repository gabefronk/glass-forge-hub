import { useMemo, useState } from "react";
import { ExternalLink, Library, LockKeyhole, Wrench } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { C } from "@/lib/feeUI";
import { PageShell, PageHero, SheetCard, TILE } from "@/components/PageShell";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";

const PELLA_ICON_URL =
  "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/86/15/56/86155612-1b79-cc68-7749-624710f1fd57/AppIcon-0-0-1x_U007emarketing-0-7-0-85-220.png/512x512bb.jpg";
const PELLA_TECHNICAL_DOCUMENTS_URL = "https://www.pella.com/professionals/downloads/service/perl/";
const AMSCO_LOGO_URL =
  "https://www.amscowindows.com/wp-content/uploads/2024/11/cropped-AMSCO-Logomark-Vertical-Alternate-Standard-PMS-7684-1-270x270.png";
const AMSCO_SPECS_URL = "https://apps.amscowindows.com/";

const SPECIALIZED_LINKS = [
  {
    href: PELLA_TECHNICAL_DOCUMENTS_URL,
    title: "Pella ADM — Technical documents (opens in a new tab)",
    iconUrl: PELLA_ICON_URL,
    iconAlt: "Pella ADM app icon",
    label: "Pella ADM",
    detail: "Technical documents",
    bg: "#242021",
    textColor: "#FFFFFF",
  },
  {
    href: AMSCO_SPECS_URL,
    title: "AMSCO SpecFinder (opens in a new tab)",
    iconUrl: AMSCO_LOGO_URL,
    iconAlt: "AMSCO logo",
    label: "Amsco specs",
    detail: "SpecFinder",
    bg: "#FFFFFF",
    textColor: "var(--gf-ink)",
  },
];

const BRANDS = [
  { name: "Amsco", website: "https://www.amscowindows.com/", series: "Studio", tier: "$" },
  { name: "Andersen", website: "https://www.andersenwindows.com/", series: "100 Series", tier: "$$" },
  { name: "Bonelli", website: "https://www.bonelli.com/", series: "Volume Doors", tier: "$$" },
  { name: "French Steel", website: "https://frenchsteel.com/", series: "Classic Series", tier: "$$$$$" },
  { name: "Jeldwen", website: "https://www.jeld-wen.com/en-us", series: "Siteline", tier: "$$$$" },
  { name: "La Cantina", website: "https://www.lacantinadoors.com", series: "Aluminum Wood", tier: "$$$" },
  { name: "Milgard", website: "https://www.milgard.com/", series: "V150", tier: "$" },
  { name: "Nu Vista", website: "https://nuvistawindows.com/index.php/en/", series: "Aluminum", tier: "$$$" },
  { name: "Pella", website: "https://www.pellaprodealer.com/", series: "Impervia", tier: "$$" },
  { name: "Weather Shield — Coming Soon", website: "https://weathershield.com/", series: null, tier: "?" },
  { name: "Western", website: "https://westernwindowsystems.com/", series: "Classic", tier: "$$$$$" },
  { name: "Windor", website: "https://www.windorsystems.com/", series: "2750", tier: "$$" },
  { name: "Glenview Doors", website: "https://www.glenviewdoors.com/", series: null, tier: "-" },
  { name: "Inicio Windows and Doors", website: "https://iniciowindows.com/", series: null, tier: "-" },
  { name: "PRL", website: "https://prlglass.com/", series: null, tier: "-" },
  { name: "FHC", website: "https://fhc-usa.com/", series: null, tier: "-" },
  { name: "Glazetech", website: "https://www.glaztech.com/", series: null, tier: "-" },
];

function SpecializedLink({ link }) {
  return (
    <a href={link.href} target="_blank" rel="noopener noreferrer" title={link.title}
      aria-label={`${link.label} — opens in a new tab`}
      className="group flex min-h-40 flex-col items-center justify-center rounded-[28px] p-4 text-center motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
      style={{ backgroundColor: link.bg, color: link.textColor, border: `1px solid ${C.border}` }}>
      <img src={link.iconUrl} alt={link.iconAlt} width={104} height={104} className="h-24 w-24 object-contain" loading="lazy" />
      <span className="mt-2 text-base font-semibold">{link.label}</span>
      <span className="mt-0.5 text-[12px] opacity-75">{link.detail}</span>
    </a>
  );
}

function BrandTile({ brand, showPricing }) {
  return (
    <li className="flex min-h-48 flex-col rounded-[18px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-[18px] font-bold leading-tight" style={{ color: C.text }}>{brand.name}</h3>
        <a href={brand.website} target="_blank" rel="noopener noreferrer" aria-label={`${brand.name} official website — opens in a new tab`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ color: "var(--gf-teal-600)", backgroundColor: C.headerBg }}>
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
      <div className="mt-auto pt-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>Known series</p>
        <p className="mt-1 text-[14px] font-medium" style={{ color: brand.series ? C.textSecondary : C.textFaint }}>
          {brand.series || "Not specified in the current reference"}
        </p>
        {showPricing && (
          <p className="mt-3 text-[12px]" style={{ color: C.textMuted }}>
            Relative price tier: <span className="font-mono-num font-semibold" style={{ color: C.text }}>{brand.tier}</span>
          </p>
        )}
      </div>
    </li>
  );
}

function MarginLookup() {
  const [discountInput, setDiscountInput] = useState("");
  const marginRows = useMemo(() => Array.from({ length: 51 }, (_, margin) => {
    const g = margin / 100;
    const discount = (1 - 0.5 / (1 - g)) * 100;
    return { margin, discount: Number.isFinite(discount) ? discount : 0 };
  }), []);
  const calcResult = useMemo(() => {
    const d = parseFloat(discountInput);
    if (!Number.isFinite(d) || d < 0 || d > 100) return null;
    const margin = 100 - 50 / (1 - d / 100);
    return Number.isFinite(margin) ? margin : null;
  }, [discountInput]);

  return (
    <SheetCard icon={LockKeyhole} tile={TILE.green} title="Owner pricing reference" sub="cost basis is 50% of list" bodyClassName="">
      <p className="m-0 px-5 py-3 text-[12.5px]" style={{ color: C.textSecondary, borderBottom: `1px solid ${C.rowBorder}` }}>
        For a discount <span className="font-mono-num">d</span> off list, gross margin = 100 − 50/(1−d). For a target margin <span className="font-mono-num">g</span>, discount = 1 − 0.5/(1−g).
      </p>
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-end" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="discount-calc" className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Discount off list (%)</label>
          <input id="discount-calc" type="number" inputMode="decimal" min="0" max="100" step="0.01" value={discountInput}
            onChange={(event) => setDiscountInput(event.target.value)} placeholder="e.g. 44.44"
            className="rounded-[8px] px-3 text-[13px] focus:outline-none"
            style={{ height: 38, width: 160, border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.text }} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: C.textSecondary }}>Resulting gross margin</span>
          <div className="flex items-center rounded-[8px] px-3" style={{ height: 38, minWidth: 160, border: `1px solid ${C.border}`, backgroundColor: C.card }}>
            {calcResult !== null
              ? <span className="font-mono-num-bold text-[15px]" style={{ color: "var(--gf-teal-700)" }}>{calcResult.toFixed(2)}%</span>
              : <span className="text-[12px]" style={{ color: C.textFaint }}>Enter 0–100</span>}
          </div>
        </div>
      </div>
      <div className="max-h-[420px] overflow-x-auto obsidian-scroll">
        <table className="w-full text-left text-[13px]" style={{ borderCollapse: "collapse" }}>
          <thead className="sticky top-0"><tr style={{ backgroundColor: C.headerBg }}>
            <th className="px-5 py-2.5 font-semibold" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Gross Margin %</th>
            <th className="px-5 py-2.5 text-right font-semibold" style={{ color: C.headerText, borderBottom: `1px solid ${C.border}` }}>Discount off List %</th>
          </tr></thead>
          <tbody>{marginRows.map((row) => (
            <tr key={row.margin} style={{ backgroundColor: row.margin % 2 ? C.cardAlt : C.card, borderBottom: `1px solid ${C.rowBorder}` }}>
              <td className="px-5 py-2 font-mono-num" style={{ color: C.text }}>{row.margin}%</td>
              <td className="px-5 py-2 text-right font-mono-num" style={{ color: C.textSecondary }}>{row.discount.toFixed(2)}%</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="px-5 py-3 text-[12px]" style={{ color: C.textMuted, borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
        Source chart labels: LIST at 0% margin (maximum discount) end; COST at 50% margin (full list price) end.
      </p>
    </SheetCard>
  );
}

export default function BrandsSpecs() {
  const { user } = useAuth();
  const owner = isPurchaseOrderOwner(user);

  return (
    <PageShell width="max-w-[1120px]" className="!mx-0">
      <PageHero eyebrow="Reference" title="Brands & Specs" sub="Manufacturer websites, known product series, and specialized specification tools." />

      <SheetCard icon={Wrench} tile={TILE.teal} title="Specification tools" sub="Pella and Amsco resources" bodyClassName="p-5 max-[699px]:p-4">
        <div className="grid max-w-[520px] grid-cols-1 gap-4 min-[480px]:grid-cols-2">
          {SPECIALIZED_LINKS.map((link) => <SpecializedLink key={link.href} link={link} />)}
        </div>
      </SheetCard>

      <SheetCard icon={Library} tile={TILE.bronze} title="Manufacturers & vendors" sub="official sites and the series in the crew reference" bodyClassName="p-5 max-[699px]:p-4">
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {BRANDS.map((brand) => <BrandTile key={brand.name} brand={brand} showPricing={owner} />)}
        </ul>
        {owner && <p className="mt-3 text-[12px]" style={{ color: C.textMuted }}>Relative price tiers are rough internal guides only, not pricing.</p>}
      </SheetCard>

      {owner && <MarginLookup />}
    </PageShell>
  );
}
