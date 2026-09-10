import Portrait from "./Portrait";
import { STATIC_NODES } from "@/lib/agentCenterRoles";
import RoleDetails from "./RoleDetails";
import DailyPlan from "./DailyPlan";

export default function DirectorCard() {
  const node = STATIC_NODES.operations_director;
  return (
    <div className="rounded-2xl border border-[#1E4A85] bg-[#E7EEFA] p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Portrait id={node.id} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#1E4A85]">{node.department}</p>
            <h3 className="font-semibold">{node.name}</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-700">{node.assignment}</p>
          </div>
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-[#1E4A85]">Documentation role</span>
      </div>
      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-white px-3 py-2 text-xs text-[#1E4A85]">
        <span className="font-semibold">Reports to:</span> Owner · creates an owner escalation when a decision is needed.
      </div>
      <RoleDetails id={node.id} />
      <DailyPlan id={node.id} />
    </div>
  );
}