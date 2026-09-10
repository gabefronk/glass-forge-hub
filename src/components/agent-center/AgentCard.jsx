import { Link } from "react-router-dom";
import { ArrowUpRight, ArrowRight } from "lucide-react";
import Portrait from "./Portrait";
import { Pill } from "./shared";
import RoleDetails from "./RoleDetails";
import DailyPlan from "./DailyPlan";

export default function AgentCard({ node, crossLink, nodes }) {
  const target = crossLink ? nodes.find(n => n.id === crossLink.to) : null;
  return (
    <article className="rounded-2xl border border-[#DDE3EC] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Portrait id={node.id} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#2A5EA8]">{node.department}</p>
            <h3 className="mt-1 font-semibold">{node.name}</h3>
            <p className="mt-1 text-xs text-slate-500">{node.provider} · {node.host}</p>
          </div>
        </div>
        <Pill value={node.connection} />
      </div>
      <p className="mt-3 text-sm text-slate-700">{node.assignment}</p>
      {node.latest_update && <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">{node.latest_update}</p>}
      {node.handoffs?.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">{node.handoffs.map(x => <span key={x} className="rounded-lg bg-[#EEF3FB] px-2 py-1 text-xs text-[#24538E]">↔ {x}</span>)}</div>
      )}
      {crossLink && target && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#C3D4EE] bg-[#F4F8FE] px-3 py-2 text-xs text-[#1E4A85]">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span><span className="font-semibold">→ {target.name}:</span> {crossLink.label}</span>
        </div>
      )}
      <RoleDetails id={node.id} />
      <DailyPlan id={node.id} />
      <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs text-slate-500">
        <span>{node.status}</span>
        {node.url && <Link to={node.url} className="flex items-center gap-1 text-[#2A5EA8]">Open <ArrowUpRight className="h-3.5 w-3.5" /></Link>}
      </div>
    </article>
  );
}