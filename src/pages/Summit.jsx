import { useState } from "react";
import { Mountain, Wrench, ToggleLeft, Gauge, FileText } from "lucide-react";
import { C } from "@/lib/feeUI";
import Troubleshooter from "@/components/summit/Troubleshooter";
import DipSwitchMap from "@/components/summit/DipSwitchMap";
import PotentiometerRef from "@/components/summit/PotentiometerRef";
import SummitDocs from "@/components/summit/SummitDocs";

const TABS = [
  { id: "troubleshoot", label: "Troubleshooter", icon: Wrench },
  { id: "dip", label: "DIP Switches", icon: ToggleLeft },
  { id: "pots", label: "Pots", icon: Gauge },
  { id: "docs", label: "Docs", icon: FileText },
];

export default function Summit() {
  const [tab, setTab] = useState("troubleshoot");

  return (
    <div className="flex flex-col" style={{ backgroundColor: C.pageBg, minHeight: "100dvh" }}>
      {/* Dark-green hero */}
      <header
        className="shrink-0 px-5 max-[699px]:px-4 pt-5 max-[699px]:pt-4 pb-5"
        style={{ background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", color: "var(--gf-sidebar-text-on)" }}
      >
        <div className="flex items-center gap-3">
          <Mountain className="h-7 w-7" style={{ color: "var(--gf-brass-300)" }} strokeWidth={1.8} strokeLinecap="round" />
          <div>
            <h1 className="font-heading text-[28px] font-bold leading-none" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.03em" }}>Summit</h1>
            <div className="text-[11px] font-mono uppercase tracking-[0.12em] mt-1" style={{ color: "var(--gf-sidebar-muted)" }}>
              Peak / Everest automated door service
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[13px] max-w-[640px]" style={{ color: "var(--gf-sidebar-muted)" }}>
          Field service reference for installers. Troubleshooter v1.1, DIP switch map, potentiometer baselines, and the cert library.
        </p>
      </header>

      {/* Tab bar — large touch targets, horizontally scrollable on phones */}
      <div className="px-5 max-[699px]:px-4 pb-3 sticky top-0 z-20" style={{ backgroundColor: C.pageBg }}>
        <div className="flex gap-2 overflow-x-auto obsidian-scroll -mx-1 px-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className="inline-flex items-center gap-2 rounded-full px-4 min-h-[44px] text-[14px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                style={{
                  border: `1px solid ${active ? C.accent : C.border}`,
                  backgroundColor: active ? C.accent : C.card,
                  color: active ? C.accentDark : C.textSecondary,
                }}
              >
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab content */}
      <div className="px-5 max-[699px]:px-4 pb-10 max-w-[760px]">
        {tab === "troubleshoot" && <Troubleshooter />}
        {tab === "dip" && <DipSwitchMap />}
        {tab === "pots" && <PotentiometerRef />}
        {tab === "docs" && <SummitDocs />}
      </div>
    </div>
  );
}