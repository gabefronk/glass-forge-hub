const PELLA_ICON_URL =
  "https://is1-ssl.mzstatic.com/image/thumb/Purple211/v4/86/15/56/86155612-1b79-cc68-7749-624710f1fd57/AppIcon-0-0-1x_U007emarketing-0-7-0-85-220.png/512x512bb.jpg";
const PELLA_APP_STORE_URL = "https://apps.apple.com/us/app/pella-adm/id937901511";
const AMSCO_LOGO_URL =
  "https://www.amscowindows.com/wp-content/uploads/2024/11/cropped-AMSCO-Logomark-Vertical-Alternate-Standard-PMS-7684-1-270x270.png";
const AMSCO_URL = "https://apps.amscowindows.com/";

const NAVY = "#131A26";
const HAIRLINE = "#DDE3EC";
const PELLA_BG = "#242021";

const BRANDS = [
  {
    href: PELLA_APP_STORE_URL,
    title: "Pella ADM — App Store listing (opens in a new tab)",
    iconUrl: PELLA_ICON_URL,
    iconAlt: "Pella ADM app icon",
    label: "Pella ADM",
    bg: PELLA_BG,
    textColor: "#FFFFFF",
  },
  {
    href: AMSCO_URL,
    title: "AMSCO SpecFinder (opens in a new tab)",
    iconUrl: AMSCO_LOGO_URL,
    iconAlt: "AMSCO logo",
    label: "Amsco specs",
    bg: "#FFFFFF",
    textColor: NAVY,
  },
];

function BrandSquare({ href, title, iconUrl, iconAlt, label, bg, textColor }) {
  return (
    <li role="listitem" className="flex justify-center">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label={`${label} — opens in a new tab`}
        className="group flex h-52 w-52 flex-col items-center rounded-2xl motion-safe:transition-transform motion-safe:duration-150 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5EA8] focus-visible:outline-offset-8 sm:h-56 sm:w-56"
        style={{ backgroundColor: bg }}
      >
        <img
          src={iconUrl}
          alt={iconAlt}
          width={160}
          height={160}
          className="mt-3 h-36 w-36 shrink-0 object-contain sm:h-40 sm:w-40 sm:mt-3"
          loading="lazy"
        />
        <span
          className="mt-2.5 text-base font-semibold"
          style={{ color: textColor }}
        >
          {label}
        </span>
      </a>
    </li>
  );
}

export default function BrandsSpecs() {
  return (
    <>
      <style>{`@media (min-width:640px){.brands-specs-shell{padding-left:40px!important;padding-right:40px!important;padding-top:40px!important}}@media (prefers-reduced-motion:reduce){.brands-specs-shell *{transition:none!important}}`}</style>
      <div
        className="brands-specs-shell mx-auto w-full"
        style={{ maxWidth: 640, paddingLeft: 24, paddingRight: 24, paddingTop: 24, paddingBottom: 104 }}
      >
        <h1
          className="font-semibold"
          style={{ color: NAVY, fontSize: 22, letterSpacing: "-0.01em", marginBottom: 32, lineHeight: 1.2 }}
        >
          <span className="sm:text-[28px]">Product Brands &amp; Specifications</span>
        </h1>

        <ul role="list" className="flex flex-col items-center">
          {BRANDS.map((b, i) => (
            <div key={b.href} className="flex flex-col items-center">
              {i > 0 && (
                <div
                  aria-hidden="true"
                  style={{ width: 160, height: 1, backgroundColor: HAIRLINE, marginBottom: 40, marginTop: 40 }}
                />
              )}
              <BrandSquare {...b} />
            </div>
          ))}
        </ul>
      </div>
    </>
  );
}