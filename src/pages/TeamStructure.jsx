import { Link } from "react-router-dom";
import { ArrowRight, BriefcaseBusiness, Building2, ClipboardCheck, Code2, Hammer, Handshake, Layers3, Sparkles, Wrench } from "lucide-react";
import { PageShell, PageHero } from "@/components/PageShell";

const lanes = [
  {
    name: "Gabe",
    title: "Sales, Growth & Business Systems",
    icon: Sparkles,
    owns: ["Lead intake & sales", "Quoting support", "Purchasing & vendor relationships", "Business systems & automation"],
    initiatives: ["Glass Forge Hub development", "Amsco ordering automation", "Repeatable quoting and ordering systems"],
    handoff: "Approved jobs move into project delivery while the sales owner stays attached."
  },
  {
    name: "Milan",
    title: "Project Delivery & Commercial Development",
    icon: Building2,
    owns: ["Customer coordination", "Scheduling", "Project follow-through", "Field coordination"],
    initiatives: ["Commercial/storefront development", "Commercial estimating", "Cutting & glazing processes"],
    handoff: "Receives sold jobs, coordinates execution, and keeps customer/material/field timing aligned."
  },
  {
    name: "Jeremy",
    title: "Sales, Business Development & New Markets",
    icon: Handshake,
    owns: ["Lead generation & sales", "Measuring", "Quoting development", "New-market development"],
    initiatives: ["Glass railing systems", "St. George expansion", "New product playbooks"],
    handoff: "Stays attached as sales owner after a sold job moves into project delivery."
  },
  {
    name: "Israel & Yelian",
    title: "Install & Service Operations",
    icon: Hammer,
    owns: ["Field execution", "Crew coordination", "Skill-to-job matching", "Service & quality"],
    initiatives: ["Shower systems", "Installation standards", "Crew development", "Field quality systems"],
    handoff: "Project delivery owns when/where/customer context; field operations owns who/how/manpower."
  },
  {
    name: "Toma",
    title: "Shower Glass Estimating",
    icon: Layers3,
    owns: ["Receive measurements", "Build shower quotes", "Resolve missing details", "Return pricing to sales"],
    initiatives: ["Develop repeatable shower quoting standards"],
    handoff: "For now, Toma hands off after quoting; sold work moves into ordering and project delivery."
  },
  {
    name: "Trevor",
    title: "Systems, IT & Process Development",
    icon: Code2,
    owns: ["Hub development", "Automation", "IT troubleshooting", "Process design"],
    initiatives: ["Turn recurring bottlenecks into reliable systems and tools"],
    handoff: "All lanes feed system needs in; Trevor helps turn them into scalable tools and workflows."
  }
];

const flow = ["Lead", "Measure / Scope", "Quote", "Customer Approval", "Order & Job Setup", "Project Handoff", "Schedule & Coordinate", "Install / Service", "Complete & Bill"];

export default function TeamStructure() {
  return (
    <PageShell width="max-w-6xl">
      <PageHero
        eyebrow="WORKING VERSION 1"
        title="Team structure & operating lanes"
      >
        <div className="max-w-3xl text-sm leading-6" style={{ color: "rgba(255,255,255,.78)" }}>
          This is a living structure for clarity, not rank. Primary ownership gives each responsibility a home without limiting anyone from helping across lanes. The team should review, challenge, and improve this together as Glass Forge grows.
        </div>
      </PageHero>

      <div className="space-y-6 pb-10">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <BriefcaseBusiness className="h-5 w-5 text-emerald-800" />
            <h2 className="text-lg font-bold text-slate-900">How work moves through Glass Forge</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {flow.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">{step}</span>
                {index < flow.length - 1 && <ArrowRight className="h-4 w-4 text-slate-400" />}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Service and warranty work loops back into project coordination: issue reported → diagnose → order parts if needed → reschedule → field return → complete.
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <Layers3 className="h-5 w-5 text-emerald-800" />
            <h2 className="text-lg font-bold text-slate-900">Operating lanes</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {lanes.map((lane) => {
              const Icon = lane.icon;
              return (
                <article key={lane.name} className="rounded-2xl border bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-emerald-950 p-2.5 text-white"><Icon className="h-5 w-5" /></div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">{lane.name}</h3>
                      <p className="text-sm font-semibold text-emerald-800">{lane.title}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Primary ownership</div>
                      <ul className="space-y-1.5 text-sm text-slate-700">
                        {lane.owns.map((item) => <li key={item}>• {item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Growth initiatives</div>
                      <ul className="space-y-1.5 text-sm text-slate-700">
                        {lane.initiatives.map((item) => <li key={item}>• {item}</li>)}
                      </ul>
                    </div>
                  </div>
                  <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    <strong>Handoff:</strong> {lane.handoff}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2"><ClipboardCheck className="h-5 w-5 text-emerald-800" /><h2 className="font-bold text-slate-900">Growth initiative rhythm</h2></div>
            <p className="text-sm leading-6 text-slate-700">Each core team member can own one or two initiatives they are helping turn into a repeatable company capability. Track the objective, current milestone, next step, status, and what was learned.</p>
          </div>
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2"><Wrench className="h-5 w-5 text-emerald-800" /><h2 className="font-bold text-slate-900">Monthly build meeting</h2></div>
            <p className="text-sm leading-6 text-slate-700">Once a month, the team shares what moved, what was learned, what is stuck, the next milestone, and what support is needed. The purpose is partnership, learning, accountability, and team bonding — not employee reviews.</p>
          </div>
        </section>

        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950">
          <strong>Core principle:</strong> Everyone has a home lane. Everyone can help across lanes. Every major responsibility has an owner. Every handoff is visible. Everyone is helping build something bigger than today’s workload.
        </div>

        <div className="text-center">
          <Link to="/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-emerald-950 px-4 py-2.5 text-sm font-semibold text-white">
            Back to Today
          </Link>
        </div>
      </div>
    </PageShell>
  );
}