import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { ROLE_DETAILS } from "@/lib/agentCenterRoles";

export default function RoleDetails({ id }) {
  const [open, setOpen] = useState(false);
  const details = ROLE_DETAILS[id];
  if (!details) return null;
  return (
    <div className="mt-3 border-t border-[#E9EDF4] pt-3">
      <button onClick={() => setOpen(o => !o)} className="flex min-h-11 w-full items-center justify-between text-xs font-semibold text-[#2A5EA8]" aria-expanded={open}>
        <span>Role details</span>
        <ChevronDown className={"h-4 w-4 transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <dl className="mt-2 space-y-2 text-xs leading-relaxed text-slate-700">
          <div><dt className="font-semibold text-slate-900">What it does</dt><dd className="mt-0.5">{details.does}</dd></div>
          <div><dt className="font-semibold text-slate-900">What it pulls</dt><dd className="mt-0.5">{details.pulls}</dd></div>
          <div><dt className="font-semibold text-slate-900">What it sends / updates</dt><dd className="mt-0.5">{details.sends}</dd></div>
          <div><dt className="font-semibold text-slate-900">Reports to</dt><dd className="mt-0.5">{details.reportsTo}</dd></div>
          <div><dt className="font-semibold text-slate-900">Next handoff</dt><dd className="mt-0.5">{details.nextHandoff}</dd></div>
        </dl>
      )}
    </div>
  );
}