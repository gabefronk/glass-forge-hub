import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Portrait from "./Portrait";
import { Pill } from "./shared";
import { ROLE_DETAILS } from "@/lib/agentCenterRoles";

export default function ManagerCard({ node }) {
  const [open, setOpen] = useState(false);
  const details = ROLE_DETAILS[node.id];
  return (
    <div className="rounded-2xl border border-[#B8CBE8] bg-[#F4F8FE] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Portrait id={node.id} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#2A5EA8]">{node.department}</p>
            <h3 className="font-semibold">{node.name}</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-700">{node.assignment}</p>
          </div>
        </div>
        <Pill value={node.status} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">{node.capabilities?.map(x => <span key={x} className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-700">{x}</span>)}</div>
      {details && (
        <div className="mt-4 border-t border-[#C3D4EE] pt-3">
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
      )}
    </div>
  );
}