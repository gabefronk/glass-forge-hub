import Portrait from "./Portrait";
import { STATIC_NODES } from "@/lib/agentCenterRoles";
import RoleDetails from "./RoleDetails";
import DailyPlan from "./DailyPlan";

export default function LeadCard({ id, reportLabel }) {
  const node = STATIC_NODES[id];
  if (!node) return null;
  return (
    <div className="rounded-2xl border border-[#C3D4EE] bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <Portrait id={node.id} />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-[#2A5EA8]">{node.department}</p>
          <h3 className="mt-1 font-semibold">{node.name}</h3>
          <p className="mt-1 text-sm text-slate-700">{node.assignment}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#F4F8FE] px-3 py-2 text-xs text-[#1E4A85]">
        <span className="font-semibold">Reports to Glass Forge manager:</span> {reportLabel}
      </div>
      <RoleDetails id={node.id} />
      <DailyPlan id={node.id} />
    </div>
  );
}