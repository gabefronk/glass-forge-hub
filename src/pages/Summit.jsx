import { useState } from "react";
import { Wrench, ToggleLeft, Gauge, FileText } from "lucide-react";
import { PageShell, PageHero } from "@/components/PageShell";
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
    <PageShell width="max-w-[1080px]">
      <PageHero eyebrow="Summit · Peak / Everest automated door service" title="Summit" sub="Field service reference for installers. Troubleshooter v1.1, DIP switch map, potentiometer baselines, and the cert library.">
        {/* Tab bar: large touch targets, horizontally scrollable on phones */}
        <div className="flex gap-2 overflow-x-auto obsidian-scroll -mx-1 px-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? "page" : undefined}
                className="inline-flex items-center gap-2 rounded-[9px] px-4 min-h-[40px] text-[13.5px] font-semibold whitespace-nowrap shrink-0 transition-colors"
                style={active ? { backgroundColor: "#cfe3da", color: "#082f2c" } : { backgroundColor: "rgba(255,255,255,.09)", color: "#f2eee8", border: "1px solid rgba(255,255,255,.12)" }}
              >
                <Icon className="h-4 w-4" style={{ color: active ? "#082f2c" : "#e0c994" }} /> {t.label}
              </button>
            );
          })}
        </div>
      </PageHero>

      {/* Active tab content */}
      <div className="max-w-[760px]">
        {tab === "troubleshoot" && <Troubleshooter />}
        {tab === "dip" && <DipSwitchMap />}
        {tab === "pots" && <PotentiometerRef />}
        {tab === "docs" && <SummitDocs />}
      </div>
    </PageShell>
  );
}