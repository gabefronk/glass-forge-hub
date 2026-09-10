import { CalendarCheck } from "lucide-react";
import { DAILY_PLANS, ORG_TREE, STATIC_NODES } from "@/lib/agentCenterRoles";

export default function RunPlanSection() {
  return (
    <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold"><CalendarCheck className="h-5 w-5 text-[#2A5EA8]" />Today's run plan</h2>
      <p className="mt-1 text-sm text-slate-600">Documented daily prompts and checklists only. No background schedules, provider calls, or outside actions run from this page.</p>
      <div className="mt-5 space-y-4">
        {ORG_TREE.sections.map(section => {
          const lead = STATIC_NODES[section.leadId];
          const plan = DAILY_PLANS[section.leadId];
          if (!lead || !plan) return null;
          return (
            <div key={section.leadId} className="rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{lead.name}</h3>
                <span className="rounded-lg bg-[#E7EEFA] px-2.5 py-1 text-xs font-medium text-[#1E4A85]">Reports to Glass Forge manager · {section.leadToManagerLabel}</span>
              </div>
              <ol className="mt-3 space-y-2 text-xs leading-relaxed text-slate-700">
                {plan.map((step, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-semibold text-[#2A5EA8]">{i + 1}.</span>
                    <span><span className="font-semibold text-slate-900">{step.phase}:</span> {step.task}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}