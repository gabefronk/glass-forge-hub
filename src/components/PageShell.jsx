import { SheetCard, LiveMark, TILE, SHEET_BG } from "@/components/jobs/JobSheet";

export { SheetCard, LiveMark, TILE, SHEET_BG };

// Page header for every tab: dark graphite, brass accents. eyebrow (small
// caps), title, an optional line under it, and actions on the right.
// Matches the job sheet hero so the whole app reads as one system.
export const HERO_INK = "#f2eee8", HERO_MUTED = "#aeb5b7", BRASS = "#b8955a", BRASS_LT = "#e0c994";
export const heroBtn = "inline-flex h-[38px] items-center gap-[7px] rounded-[9px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap";
export const heroPrimary = { backgroundColor: BRASS, color: "#1d160a" };
export const heroSecondary = { backgroundColor: "rgba(255,255,255,.09)", color: HERO_INK, border: "1px solid rgba(255,255,255,.12)" };
export const heroField = { backgroundColor: "rgba(255,255,255,.08)", color: HERO_INK, border: "1px solid rgba(255,255,255,.16)" };

export function PageHero({ eyebrow, title, sub, chip, actions, children, className = "", compact = false }) {
  return (
    <section className={`relative rounded-[14px] ${className}`} style={{ background: "linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)", boxShadow: "0 20px 44px -26px rgba(10,29,31,.7)" }}>
      <div className={compact ? "px-6 py-4 max-[699px]:px-4" : "px-7 py-6 max-[699px]:px-4 max-[699px]:py-5"}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <div className="min-w-[220px] flex-1">
            {(eyebrow || chip) ? (
              <div className="flex flex-wrap items-center gap-2.5">
                {eyebrow ? <span className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#8f999b" }}>{String(eyebrow).toUpperCase()}</span> : null}
                {chip ? <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-semibold" style={{ backgroundColor: "rgba(224,201,148,.14)", color: BRASS_LT, border: "1px solid rgba(224,201,148,.35)" }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />{chip}</span> : null}
              </div>
            ) : null}
            <h1 className={`m-0 break-words font-bold ${compact ? "mt-0.5 text-[24px] leading-[30px]" : "mt-1.5 text-[32px] leading-[38px] max-[699px]:text-[26px] max-[699px]:leading-[31px]"}`} style={{ color: HERO_INK, letterSpacing: "-0.035em" }}>{title}</h1>
            {sub ? <div className="mt-1.5 text-[14.5px] font-medium leading-[21px]" style={{ color: "#c9d0d1" }}>{sub}</div> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children ? <div className="mt-5 max-[699px]:mt-4">{children}</div> : null}
      </div>
    </section>
  );
}

// A bar inside the hero (next-step style): translucent, rounded.
export function HeroBar({ children, className = "" }) {
  return <div className={`flex flex-wrap items-center gap-2.5 rounded-[12px] px-4 py-2.5 ${className}`} style={{ backgroundColor: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)" }}>{children}</div>;
}

// Stat tiles inside the hero.
export function HeroStat({ label, value, tone, sub }) {
  return (
    <div className="min-w-[120px] rounded-[12px] px-3.5 py-2.5" style={{ backgroundColor: "rgba(207,227,218,.08)", border: "1px solid rgba(207,227,218,.18)" }}>
      <div className="text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{String(label).toUpperCase()}</div>
      <div className="mt-0.5 text-[20px] font-bold tabular-nums [overflow-wrap:anywhere]" style={{ color: tone === "brass" ? BRASS_LT : HERO_INK, letterSpacing: "-0.02em" }}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11.5px] break-words" style={{ color: HERO_MUTED }}>{sub}</div> : null}
    </div>
  );
}

// Standard page wrapper: sand ground, centered column, 18px stack.
export function PageShell({ children, width = "max-w-[1240px]", className = "" }) {
  return (
    <div style={{ backgroundColor: SHEET_BG, minHeight: "100dvh" }}>
      <div className={`${width} mx-auto flex flex-col gap-[18px] px-5 pt-5 pb-28 max-[699px]:px-3 max-[699px]:pt-4 lg:pb-12 ${className}`}>{children}</div>
    </div>
  );
}
