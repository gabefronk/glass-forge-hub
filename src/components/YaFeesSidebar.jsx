import { Link, useLocation } from "react-router-dom";
import { Receipt, Calendar, Diamond, Briefcase, BarChart3, LogOut, PanelsTopLeft, Library, DollarSign, Mountain, ClipboardList } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { isAgentCenterOwner, isWindowQuotesOnly } from "@/lib/agentCenterAccess";
import { Users, CheckSquare, Bot, Network, Search, TrendingUp, MessageSquare, Unlink, FileText, Bug } from "lucide-react";
import { useTodoAccess } from '@/hooks/use-todo-access';
import { isReady, buildSupersededSet, withCompanions } from "@/lib/invoicingFilters";
import { formatMoney, computeFeeAmt, currentMonthStr, withComputedAmounts } from "@/lib/feeMath";

// Owner-only admin/background routes are grouped under ADMIN_ITEMS below.
export const NAV_ITEMS = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "To-do", to: "/todos", icon: CheckSquare, todoOnly: true },
  { label: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Job Budgets", to: "/job-budgets", icon: DollarSign, ownerOnly: true },
  { label: "Calendar", to: "/calendar", icon: Calendar },
  { label: "Brands & Specs", to: "/brands-specs", icon: Library },
  { label: "Summit", to: "/summit", icon: Mountain },
  { label: "Contacts", to: "/contacts", icon: Users, ownerOnly: true },
  { label: "Purchase Orders", to: "/purchase-orders", icon: ClipboardList, ownerOnly: true },
];

// Owner-only admin tools (shared with the mobile More sheet).
export const ADMIN_ITEMS = [
  { label: "Agent Center", to: "/admin/agents", icon: Bot },
  { label: "System Map", to: "/system-map", icon: Network },
  { label: "Research Queue", to: "/research-queue", icon: Search },
  { label: "Sales Tracker", to: "/sales-tracker", icon: TrendingUp },
  { label: "Messages", to: "/messages", icon: MessageSquare },
  { label: "Unlinked Records", to: "/admin/unlinked", icon: Unlink },
  { label: "ProBuild Daily", to: "/admin/probuild-daily", icon: FileText },
  { label: "Match Debug", to: "/match-debug", icon: Bug },
];

function SidebarLink({ item, active }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className="flex items-center gap-3 px-3 text-[13.5px] font-medium transition-colors whitespace-nowrap rounded-lg"
      style={{
        minHeight: "36px",
        backgroundColor: active ? "rgba(184,149,90,.14)" : "transparent",
        color: active ? "var(--gf-sidebar-text-on)" : "var(--gf-sidebar-text)",
        boxShadow: active ? "inset 2px 0 0 var(--gf-brass-400)" : "none",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.backgroundColor = "rgba(255,255,255,.05)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.backgroundColor = "transparent"; }}
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color: active ? "var(--gf-brass-300)" : "var(--gf-sidebar-text)" }} strokeWidth={1.8} strokeLinecap="round" />
      {item.label}
    </Link>
  );
}

function monthLabel(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

export default function YaFeesSidebar() {
  const { pathname } = useLocation();
  const [unbilled, setUnbilled] = useState({ total: 0, count: 0 });
  const [user, setUser] = useState(null);
  const todoAccess = useTodoAccess(user);
  const [billingRevision, setBillingRevision] = useState(0);
  useEffect(() => { const update = () => setBillingRevision(n => n + 1); window.addEventListener("billing-updated", update); return () => window.removeEventListener("billing-updated", update); }, []);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await base44.auth.logout("/login");
    } catch {
      window.location.href = "/login";
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await base44.auth.me();
        if (me) setUser(me);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await base44.auth.me();
        if (isWindowQuotesOnly(me)) { setUnbilled({ total: 0, count: 0 }); return; }
        const month = currentMonthStr();
        const [rawRows, calEvents] = await Promise.all([
          base44.entities.FeeLines.filter({ invoice_month: month }, "-job_date", 5000),
          base44.entities.CalendarEvents.list("-event_date", 5000),
        ]);
        const events = Array.isArray(calEvents) ? calEvents : [];
        const rows = withCompanions(withComputedAmounts(rawRows), events);
        const rsm = new Map();
        for (const e of events) {
          if (e.google_event_id) rsm.set(e.google_event_id, e.report_status);
        }
        const ss = buildSupersededSet(rows, events);
        const readyRows = rows.filter((r) => isReady(r, rsm, ss));
        const total = readyRows.reduce((s, r) => s + computeFeeAmt(r), 0);
        setUnbilled({ total, count: readyRows.length });
      } catch {}
    })();
  }, [pathname, billingRevision]);

  const owner = isAgentCenterOwner(user);
  return (
    <aside
      className="hidden lg:flex fixed left-0 top-0 h-dvh shrink-0 flex-col z-30"
      style={{ width: "232px", background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))", borderRight: "1px solid rgba(255,255,255,.06)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-3" style={{ height: "64px", borderBottom: "1px solid rgba(255,255,255,.06)" }}>
        <div className="flex items-center justify-center shrink-0" style={{ width: "26px", height: "26px", borderRadius: "8px", background: "linear-gradient(135deg, var(--gf-brass-400), var(--gf-teal-600))" }}>
          <Diamond className="h-3.5 w-3.5" style={{ color: "#FFFFFF" }} strokeWidth={1.8} strokeLinecap="round" />
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[13px] font-semibold" style={{ color: "var(--gf-sidebar-text-on)", letterSpacing: "-0.01em" }}>Glass Forge</span>
          <span className="text-[10.5px] font-medium uppercase" style={{ color: "var(--gf-sidebar-muted)", letterSpacing: "0.08em" }}>HUB</span>
        </div>
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" className="min-h-0 flex-1 px-3 py-3 space-y-0.5 overflow-y-auto obsidian-scroll">
        {NAV_ITEMS.filter(item => (!item.ownerOnly || owner) && (!item.todoOnly || todoAccess) && (!isWindowQuotesOnly(user) || item.to === "/window-quotes" || item.to === "/brands-specs" || item.to === "/summit")).map((item) => (
          <SidebarLink key={item.to} item={item} active={pathname === item.to || (item.to === "/jobs" && pathname.startsWith("/jobs/"))} />
        ))}
        {owner && (
          <div role="group" aria-labelledby="sidebar-admin-heading" className="mt-3 space-y-0.5 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,.06)" }}>
            <div id="sidebar-admin-heading" className="px-3 pb-1 text-[10.5px] font-medium uppercase" style={{ color: "var(--gf-sidebar-muted)", letterSpacing: "0.08em" }}>Admin</div>
            {ADMIN_ITEMS.map((item) => (
              <SidebarLink key={item.to} item={item} active={pathname === item.to} />
            ))}
          </div>
        )}
      </nav>

      {/* Unbilled mini card */}
      {!isWindowQuotesOnly(user) && <div className="px-3 pb-3">
        <div className="rounded-xl px-3.5 py-3" style={{ backgroundColor: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)" }}>
          <div className="text-[11px] font-medium mb-1.5" style={{ color: "var(--gf-sidebar-muted)", letterSpacing: "0.01em" }}>Ready to bill · {monthLabel(currentMonthStr())}</div>
          <div className="flex flex-wrap items-baseline gap-1.5 break-all">
            <span className="font-mono-num-bold text-[18px]" style={{ color: "var(--gf-brass-300)", letterSpacing: "-0.02em" }}>
              ${formatMoney(unbilled.total)}
            </span>
            <span className="text-[11px]" style={{ color: "var(--gf-sidebar-muted)" }}>
              / {unbilled.count} lines
            </span>
          </div>
        </div>
      </div>}

      {/* User chip */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl" style={{ backgroundColor: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)" }}>
          <div className="flex items-center justify-center shrink-0" style={{ width: "28px", height: "28px", borderRadius: "99px", background: "linear-gradient(135deg, var(--gf-brass-400), var(--gf-teal-600))" }}>
            <span className="text-[11px] font-semibold" style={{ color: "#FFFFFF" }}>
              {(user?.email || user?.full_name || "?").charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium truncate" style={{ color: "var(--gf-sidebar-text-on)" }}>
              {user?.full_name || user?.email?.split("@")[0] || "User"}
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--gf-sidebar-muted)" }}>
              {user?.email || ""}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 flex items-center justify-center rounded-full transition-colors"
            style={{ color: "var(--gf-sidebar-muted)", width: "28px", height: "28px" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#A43432")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--gf-sidebar-muted)")}
          >
            <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} strokeLinecap="round" />
          </button>
        </div>
      </div>
    </aside>
  );
}
