import { ExternalLink } from "lucide-react";

const PELLA_ICON_URL =
  "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/86/15/56/86155612-1b79-cc68-7749-624710f1fd57/AppIcon-0-0-1x_U007emarketing-0-7-0-85-220.png/512x512bb.jpg";
const PELLA_APP_STORE_URL = "https://apps.apple.com/us/app/pella-adm/id937901511";
const AMSCO_LOGO_URL =
  "https://www.amscowindows.com/wp-content/uploads/2024/11/cropped-AMSCO-Logomark-Vertical-Alternate-Standard-PMS-7684-1-270x270.png";
const AMSCO_URL = "https://apps.amscowindows.com/";

function BrandRow({ href, title, iconUrl, iconAlt, label }) {
  return (
    <li role="listitem">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className="flex w-full flex-col items-center gap-3 py-8 text-center transition-colors hover:bg-[#F6F8FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5EA8]"
      >
        <img
          src={iconUrl}
          alt={iconAlt}
          width={144}
          height={144}
          style={{ width: 144, height: 144, objectFit: "contain" }}
          className="shrink-0"
          loading="lazy"
        />
        <span className="flex items-center gap-1.5 text-base font-semibold" style={{ color: "#131A26" }}>
          {label}
          <ExternalLink className="h-4 w-4 shrink-0" style={{ color: "#616D81" }} aria-hidden="true" />
        </span>
      </a>
    </li>
  );
}

export default function BrandsSpecs() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-32 sm:px-6 lg:pb-12">
      <h1 className="mb-6 text-xl font-semibold sm:text-2xl" style={{ color: "#131A26" }}>
        Product Brands & Specifications
      </h1>

      <ul role="list" className="divide-y" style={{ borderColor: "#DDE3EC" }}>
        <BrandRow
          href={PELLA_APP_STORE_URL}
          title="Pella ADM — App Store listing (opens in a new tab)"
          iconUrl={PELLA_ICON_URL}
          iconAlt="Pella ADM app icon"
          label="Pella ADM"
        />
        <BrandRow
          href={AMSCO_URL}
          title="AMSCO SpecFinder (opens in a new tab)"
          iconUrl={AMSCO_LOGO_URL}
          iconAlt="AMSCO logo"
          label="Amsco specs"
        />
      </ul>
    </div>
  );
}