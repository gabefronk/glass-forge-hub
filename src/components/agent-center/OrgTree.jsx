import ManagerCard from "./ManagerCard";
import AgentCard from "./AgentCard";
import { ORG_TREE } from "@/lib/agentCenterRoles";

export default function OrgTree({ manager, nodes }) {
  if (!manager) return null;
  const byId = new Map(nodes.map(n => [n.id, n]));
  return (
    <div className="space-y-4">
      <ManagerCard node={manager} />
      <div className="mx-auto h-6 w-px bg-[#B8CBE8]" />
      <div className="space-y-6">
        {ORG_TREE.map(group => {
          const members = group.members.map(m => ({ member: m, node: byId.get(m.id) })).filter(x => x.node);
          if (!members.length) return null;
          return (
            <div key={group.id} className="rounded-2xl border border-[#DDE3EC] bg-[#F6F8FC] p-4 sm:p-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#535E72]">{group.label}</p>
              <div className="space-y-4">
                {members.map(({ member, node }) => (
                  <div key={member.id}>
                    <div className="mx-auto h-4 w-px bg-[#B8CBE8]" />
                    <AgentCard node={node} crossLink={member.crossLink} nodes={nodes} />
                    {member.children?.length > 0 && (
                      <div className="mt-3 ml-4 space-y-3 border-l-2 border-[#B8CBE8] pl-4 sm:ml-8">
                        {member.childLink && (
                          <p className="text-xs font-medium text-[#24538E]">{member.childLink}</p>
                        )}
                        {member.children.map(child => {
                          const childNode = byId.get(child.id);
                          if (!childNode) return null;
                          return <AgentCard key={child.id} node={childNode} crossLink={child.crossLink} nodes={nodes} />;
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}