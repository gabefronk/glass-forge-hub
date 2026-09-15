import { Link, useLocation } from "react-router-dom";
import { Receipt, Calendar, Diamond, Briefcase, BarChart3, LogOut, PanelsTopLeft, Library } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { canViewAgentCenter, isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { Bot, MessageSquare, Users, Network, Search, CheckSquare, FileText } from "lucide-react";
import { useTodoAccess } from '@/hooks/use-todo-access';
import { isReady, buildSupersededSet } from "@/lib/invoicingFilters";
import { formatMoney, computeFeeAmt, currentMonthStr } from "@/lib/feeMath";

const NAV_ITEMS = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "To-do", to: "/todos", icon: CheckSquare, todoOnly: true },
  { label: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Reports", to: "/reports", icon: FileText, ownerOnly: true },
  { label: "Tracker", to: "/sales-tracker", icon: PanelsTopLeft },
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Calendar", to: "/calendar", icon: Calendar },
  { label: "Brands & Specs", to: "/brands-specs", icon: Library },
  { label: "System map", to: "/system-map", icon: Network, ownerOnly: true },
  { label: "Research Queue", to: "/research-queue", icon: Search, ownerOnly: true },
];

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
        const month = currentMonthStr();
        const [rows, calEvents] = await Promise.all([
          base44.entities.FeeLines.filter({ invoice_month: month }, "-job_date", 5000),
          base44.entities.CalendarEvents.list("-event_date", 5000),
        ]);
        const rsm = new Map();
        for (const e of (Array.isArray(calEvents) ? calEvents : [])) {
          if (e.google_event_id) rsm.set(e.google_event_id, e.report_status);
        }
        const ss = buildSupersededSet(rows);
        const readyRows = rows.filter((r) => isReady(r, rsm, ss));
        const total = readyRows.reduce((s, r) => s + computeFeeAmt(r), 0);
        setUnbilled({ total, count: readyRows.length });
      } catch {}
    })();
  }, [pathname, billingRevision]);

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
        {NAV_ITEMS.filter(item => (!item.ownerOnly || isAgentCenterOwner(user)) && (!item.todoOnly || todoAccess)).map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || (item.to === "/jobs" && pathname.startsWith("/jobs/"));
          return (
            <Link
              key={item.to}
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
        })}
        {isAgentCenterOwner(user) && (
          <Link
            to="/contacts"
            aria-current={pathname === "/contacts" ? "page" : undefined}
            className="flex items-center gap-3 px-3 text-[13.5px] font-medium transition-colors whitespace-nowrap rounded-lg"
            style={{
              minHeight: "36px",
              backgroundColor: pathname === "/contacts" ? "rgba(184,149,90,.14)" : "transparent",
              color: pathname === "/contacts" ? "var(--gf-sidebar-text-on)" : "var(--gf-sidebar-text)",
              boxShadow: pathname === "/contacts" ? "inset 2px 0 0 var(--gf-brass-400)" : "none",
            }}
            onMouseEnter={(e) => { if (pathname !== "/contacts") e.currentTarget.style.backgroundColor = "rgba(255,255,255,.05)"; }}
            onMouseLeave={(e) => { if (pathname !== "/contacts") e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Users className="h-4 w-4 shrink-0" style={{ color: pathname === "/contacts" ? "var(--gf-brass-300)" : "var(--gf-sidebar-text)" }} strokeWidth={1.8} strokeLinecap="round" />
            Contacts
          </Link>
        )}
        {isAgentCenterOwner(user) && (
          <Link
            to="/messages"
            aria-current={pathname === "/messages" ? "page" : undefined}
            className="flex items-center gap-3 px-3 text-[13.5px] font-medium transition-colors whitespace-nowrap rounded-lg"
            style={{
              minHeight: "36px",
              backgroundColor: pathname === "/messages" ? "rgba(184,149,90,.14)" : "transparent",
              color: pathname === "/messages" ? "var(--gf-sidebar-text-on)" : "var(--gf-sidebar-text)",
              boxShadow: pathname === "/messages" ? "inset 2px 0 0 var(--gf-brass-400)" : "none",
            }}
            onMouseEnter={(e) => { if (pathname !== "/messages") e.currentTarget.style.backgroundColor = "rgba(255,255,255,.05)"; }}
            onMouseLeave={(e) => { if (pathname !== "/messages") e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <MessageSquare className="h-4 w-4 shrink-0" style={{ color: pathname === "/messages" ? "var(--gf-brass-300)" : "var(--gf-sidebar-text)" }} strokeWidth={1.8} strokeLinecap="round" />
            Messages
          </Link>
        )}
        {canViewAgentCenter(user) && (
          <Link
            to="/admin/agents"
            aria-current={pathname === "/admin/agents" ? "page" : undefined}
            className="flex items-center gap-3 px-3 text-[13.5px] font-medium transition-colors whitespace-nowrap rounded-lg"
            style={{
              minHeight: "36px",
              backgroundColor: pathname === "/admin/agents" ? "rgba(184,149,90,.14)" : "transparent",
              color: pathname === "/admin/agents" ? "var(--gf-sidebar-text-on)" : "var(--gf-sidebar-text)",
              boxShadow: pathname === "/admin/agents" ? "inset 2px 0 0 var(--gf-brass-400)" : "none",
            }}
            onMouseEnter={(e) => { if (pathname !== "/admin/agents") e.currentTarget.style.backgroundColor = "rgba(255,255,255,.05)"; }}
            onMouseLeave={(e) => { if (pathname !== "/admin/agents") e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            <Bot className="h-4 w-4 shrink-0" style={{ color: pathname === "/admin/agents" ? "var(--gf-brass-300)" : "var(--gf-sidebar-text)" }} strokeWidth={1.8} strokeLinecap="round" />
            Agent Center
          </Link>
        )}
      </nav>

      {/* Unbilled mini card */}
      <div className="px-3 pb-3">
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
      </div>

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