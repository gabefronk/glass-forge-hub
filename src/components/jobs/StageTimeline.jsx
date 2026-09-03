import { C } from "@/lib/feeUI";

const STAGES = [
  { label: "Scheduled", desc: "Job created and calendar events set" },
  { label: "Measured", desc: "Field measurements confirmed" },
  { label: "Fabricated", desc: "Materials ordered and in production" },
  { label: "Installed", desc: "Installation complete on site" },
  { label: "Billed", desc: "Invoice sent to BFS" },
];

export const STAGE_TOTAL = STAGES.length;

export default function StageTimeline({ currentStage }) {
  return (
    <div className="rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <h3 className="font-heading text-[13px] font-semibold mb-4" style={{ color: C.text }}>Stage timeline</h3>
      <div className="relative">
        {STAGES.map((stage, i) => {
          const isComplete = i < currentStage;
          const isCurrent = i === currentStage;
          const isFuture = i > currentStage;
          return (
            <div key={i} className="relative flex items-start gap-3" style={{ paddingBottom: i < STAGES.length - 1 ? "20px" : "0" }}>
              {i < STAGES.length - 1 && (
                <div
                  className="absolute left-[8px] top-[22px] w-[1.5px]"
                  style={{ height: "20px", backgroundColor: isComplete ? C.accent : C.border }}
                />
              )}
              <div
                className="h-[18px] w-[18px] rounded-full shrink-0 mt-0.5"
                style={
                  isComplete || isCurrent
                    ? { backgroundColor: C.accent, boxShadow: isCurrent ? "0 0 0 4px rgba(110,231,192,.18)" : "none" }
                    : { backgroundColor: "transparent", border: `1.5px solid #CBD4E1` }
                }
              />
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="text-[13px] font-semibold" style={{ color: isFuture ? C.textMuted : C.text }}>{stage.label}</div>
                <div className="text-[11px]" style={{ color: C.textMuted }}>{stage.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}