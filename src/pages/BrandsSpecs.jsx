import { ExternalLink } from "lucide-react";

const PELLA_LOGO_URL =
  "https://images.contentstack.io/v3/assets/bltf589e66bcaecd79c/blt5d51af0d3a33260d/63615b77ff7b405f6b3f58e9/pella-logo-black-spot.png";
const PELLA_APP_STORE_URL = "https://apps.apple.com/us/app/pella-adm/id937901511";
const AMSCO_URL = "https://apps.amscowindows.com/";

export default function BrandsSpecs() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 pb-32 sm:px-6 lg:pb-12">
      <h1 className="mb-8 text-xl font-semibold sm:text-2xl" style={{ color: "#131A26" }}>
        Product Brands & Specifications
      </h1>

      <ul role="list" className="divide-y" style={{ borderColor: "#DDE3EC" }}>
        <li role="listitem">
          <a
            href={PELLA_APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Pella ADM — App Store listing (opens in a new tab)"
            className="flex w-full items-center gap-5 py-6 pr-2 text-left transition-colors hover:bg-[#F6F8FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5EA8]"
          >
            <img
              src={PELLA_LOGO_URL}
              alt="Pella logo"
              width={144}
              style={{ width: 144, height: "auto", objectFit: "contain" }}
              className="shrink-0"
              loading="lazy"
            />
            <span className="flex items-center gap-1.5 text-base font-semibold" style={{ color: "#131A26" }}>
              Pella ADM
              <ExternalLink className="h-4 w-4 shrink-0" style={{ color: "#616D81" }} aria-hidden="true" />
            </span>
          </a>
        </li>

        <li role="listitem">
          <a
            href={AMSCO_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="AMSCO SpecFinder (opens in a new tab)"
            className="flex w-full items-center gap-5 py-6 pr-2 text-left transition-colors hover:bg-[#F6F8FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5EA8]"
          >
            <span className="text-base font-semibold" style={{ color: "#131A26" }}>
              AMSCO
            </span>
            <ExternalLink className="h-4 w-4 shrink-0" style={{ color: "#616D81" }} aria-hidden="true" />
          </a>
        </li>
      </ul>
    </div>
  );
}