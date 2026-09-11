import { ExternalLink, Smartphone, Globe, Library, Info } from "lucide-react";

const PELLA_LINKS = [
  {
    label: "Pella ADM — App Store",
    href: "https://apps.apple.com/us/app/pella-adm/id937901511",
    icon: Smartphone,
    note: "Opens the App Store listing. Install or open Pella ADM from there when supported on your device.",
  },
  {
    label: "Pella ADM — Web resources",
    href: "https://www.pella.com/professionals/downloads/",
    icon: Globe,
    note: "Official manufacturer-maintained fallback for technical specifications, sizing, and drawings.",
  },
];

const AMSCO_LINKS = [
  {
    label: "AMSCO SpecFinder",
    href: "https://apps.amscowindows.com/",
    icon: Globe,
    note: "Official AMSCO specification finder tool.",
  },
  {
    label: "AMSCO Architects & professionals",
    href: "https://www.amscowindows.com/architects/",
    icon: Library,
    note: "Professional resources, specifications, and drawings.",
  },
];

function LinkCard({ link }) {
  const Icon = link.icon;
  return (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex min-w-0 items-start gap-3 rounded-xl border border-[#DDE3EC] bg-white p-4 transition-colors hover:border-[#2A5EA8]/40 hover:bg-[#F6F8FC]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: "#E7EEFA", color: "#1E4A85" }}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "#131A26" }}>
          {link.label}
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#616D81]" />
        </span>
        <span className="mt-1 block text-xs leading-relaxed" style={{ color: "#616D81" }}>
          {link.note}
        </span>
      </span>
    </a>
  );
}

function BrandSection({ name, tagline, links, notice }) {
  return (
    <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6 card-shadow">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold" style={{ color: "#131A26" }}>{name}</h2>
        <span className="text-xs" style={{ color: "#616D81" }}>{tagline}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {links.map((l) => <LinkCard key={l.href} link={l} />)}
      </div>
      {notice && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-3 text-xs leading-relaxed" style={{ color: "#535E72" }}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2A5EA8]" />
          <span>{notice}</span>
        </p>
      )}
    </section>
  );
}

export default function BrandsSpecs() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 pb-32 sm:px-6 lg:pb-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold sm:text-3xl" style={{ color: "#131A26" }}>Product Brands & Specifications</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed" style={{ color: "#535E72" }}>
          Shortcuts to each manufacturer's official specification tools and professional resources. Documents stay with the
          manufacturer — Glass Forge does not copy, store, or re-host spec sheets, drawings, or PDFs.
        </p>
      </header>

      <div className="space-y-5">
        <BrandSection
          name="Pella"
          tagline="Architectural Design Manual (ADM)"
          links={PELLA_LINKS}
          notice="The App Store link opens the Pella ADM listing. Install or open the app there when supported by your device, or use Web resources to browse Pella's technical documents."
        />
        <BrandSection
          name="AMSCO"
          tagline="SpecFinder · Architects & professionals"
          links={AMSCO_LINKS}
        />
      </div>

      <p className="mt-6 text-xs leading-relaxed" style={{ color: "#616D81" }}>
        External destinations are maintained by their respective manufacturers. Glass Forge links to them for convenience and
        does not control their content or availability.
      </p>
    </div>
  );
}