import { useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";
import { DAILY_PLANS } from "@/lib/agentCenterRoles";

export default function DailyPlan({ id }) {
  const [open, setOpen] = useState(false);
  const plan = DAILY_PLANS[id];
  if (!plan) return null;
  return (
    <div className="mt-3 border-t border-[#E9EDF4] pt-3">
      <button onClick={() => setOpen(o => !o)} className="flex min-h-11 w-full items-center justify-between text-xs font-semibold text-[#2A5EA8]" aria-expanded={open}>
        <span className="flex items-center gap-1.5"><ListChecks className="h-3.5 w-3.5" />Daily operating plan</span>
        <ChevronDown className={"h-4 w-4 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <ol className="mt-2 space-y-2 text-xs leading-relaxed text-slate-700">
          {plan.map((step, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-semibold text-[#2A5EA8]">{i + 1}.</span>
              <span><span className="font-semibold text-slate-900">{step.phase}:</span> {step.task}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}