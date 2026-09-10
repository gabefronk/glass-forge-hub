import DirectorCard from "./DirectorCard";
import ManagerCard from "./ManagerCard";
import LeadCard from "./LeadCard";
import AgentCard from "./AgentCard";
import { ORG_TREE } from "@/lib/agentCenterRoles";

export default function OrgTree({ manager, nodes }) {
  if (!manager) return null;
  const byId = new Map(nodes.map(n => [n.id, n]));
  return (
    <div className="space-y-3">
      <DirectorCard />
      <div className="mx-auto h-5 w-px bg-[#B8CBE8]" />
      <p className="text-center text-xs font-medium text-[#24538E]">{ORG_TREE.directorToManagerLabel}</p>
      <div className="mx-auto h-5 w-px bg-[#B8CBE8]" />
      <ManagerCard node={manager} />
      <div className="mx-auto h-5 w-px bg-[#B8CBE8]" />
      <p className="text-center text-xs font-medium text-[#24538E]">Daily section summary from each lead</p>
      <div className="space-y-5">
        {ORG_TREE.sections.map(section => {
          const members = section.members.map(m => ({ member: m, node: byId.get(m.id) })).filter(x => x.node);
          return (
            <div key={section.leadId} className="rounded-2xl border border-[#DDE3EC] bg-[#F6F8FC] p-4 sm:p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#535E72]">{section.label}</p>
              <div className="space-y-4">
                <div className="mx-auto h-4 w-px bg-[#B8CBE8]" />
                <LeadCard id={section.leadId} reportLabel={section.leadToManagerLabel} />
                {members.length > 0 && (
                  <div className="ml-4 space-y-3 border-l-2 border-[#B8CBE8] pl-4 sm:ml-8">
                    {members.map(({ member, node }) => (
                      <AgentCard key={member.id} node={node} crossLink={member.crossLink} nodes={nodes} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {ORG_TREE.directSupport.map(item => {
          const node = byId.get(item.id);
          if (!node) return null;
          return (
            <div key={item.id} className="rounded-2xl border border-[#DDE3EC] bg-[#F6F8FC] p-4 sm:p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#535E72]">Support</p>
              <div className="mx-auto h-4 w-px bg-[#B8CBE8]" />
              <AgentCard node={node} nodes={nodes} />
            </div>
          );
        })}
      </div>
    </div>
  );
}