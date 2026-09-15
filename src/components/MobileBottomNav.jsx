import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, Briefcase, Calendar, Receipt, MoreHorizontal, PanelsTopLeft, Library, Bot, X } from "lucide-react";
import { canViewAgentCenter, isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { MessageSquare, Users, Network, CheckSquare } from "lucide-react";
import { useTodoAccess } from '@/hooks/use-todo-access';

const PRIMARY_NAV = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "To-do", to: "/todos", icon: CheckSquare, todoOnly: true },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

const SECONDARY_NAV = [
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Quotes", ariaLabel: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft },
  { label: "Tracker", ariaLabel: "Sales Tracker", to: "/sales-tracker", icon: PanelsTopLeft },
  { label: "Brands", ariaLabel: "Product Brands & Specifications", to: "/brands-specs", icon: Library },
  { label: "Contacts", to: "/contacts", icon: Users, ownerOnly: true },
  { label: "Messages", to: "/messages", icon: MessageSquare, ownerOnly: true },
  { label: "System map", to: "/system-map", icon: Network, ownerOnly: true },
];

export default function MobileBottomNav({ user }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const todoAccess = useTodoAccess(user);

  useEffect(() => { setMoreOpen(false); }, [pathname]);

  const isPrimaryActive = (to) => pathname === to || (to === "/jobs" && pathname.startsWith("/jobs/"));
  const isSecondaryActive = (to) => pathname === to;
  const visibleSecondary = SECONDARY_NAV.filter((s) => !s.ownerOnly || isAgentCenterOwner(user));
  const moreActive = pathname === "/admin/agents" || visibleSecondary.some((s) => isSecondaryActive(s.to));

  const navItemStyle = (active) => ({
    backgroundColor: active ? "#2A3A35" : "transparent",
    border: "1px solid " + (active ? "#3A4A44" : "transparent"),
  });

  return (
    <>
      {moreOpen && (
        <>
          <div onClick={() => setMoreOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, backgroundColor: "rgba(24,36,34,.32)" }} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 41,
              backgroundColor: "#1B2925", borderTop: "1px solid #2A3A35",
              borderRadius: "16px 16px 0 0",
              paddingBottom: "max(12px, env(safe-area-inset-bottom))",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxShadow: "0 -8px 24px -12px rgba(24,36,34,.30)",
            }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span className="text-[13px] font-semibold" style={{ color: "#E8EAE5" }}>More</span>
              <button onClick={() => setMoreOpen(false)} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ color: "#8A958F" }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {visibleSecondary.map((item) => {
                const Icon = item.icon;
                const active = isSecondaryActive(item.to);
                return (
                  <Link key={item.to} to={item.to} aria-label={item.ariaLabel || item.label} aria-current={active ? "page" : undefined}
                    className="flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-2.5"
                    style={navItemStyle(active)}>
                    <Icon className="h-5 w-5" style={{ color: active ? "#146556" : "#8A958F" }} />
                    <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: active ? "#E8EAE5" : "#8A958F" }}>{item.label}</span>
                  </Link>
                );
              })}
              {canViewAgentCenter(user) && (
                <Link to="/admin/agents" aria-label="Agent Center" aria-current={pathname === "/admin/agents" ? "page" : undefined}
                  className="flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-2.5"
                  style={navItemStyle(pathname === "/admin/agents")}>
                  <Bot className="h-5 w-5" style={{ color: pathname === "/admin/agents" ? "#146556" : "#8A958F" }} />
                  <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: pathname === "/admin/agents" ? "#E8EAE5" : "#8A958F" }}>Agents</span>
                </Link>
              )}
            </div>
          </div>
        </>
      )}

      <nav
        aria-label="Main navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around"
        style={{
          backgroundColor: "#1B2925",
          borderTop: "1px solid #2A3A35",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {PRIMARY_NAV.filter(item => !item.todoOnly || todoAccess).map((item) => {
          const Icon = item.icon;
          const active = isPrimaryActive(item.to);
          return (
            <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} aria-label={item.label}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1" style={{ minHeight: "44px" }}>
              <Icon className="h-5 w-5" style={{ color: active ? "#146556" : "#8A958F" }} />
              <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: active ? "#E8EAE5" : "#8A958F" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
        <button onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="More navigation" aria-current={moreActive ? "page" : undefined}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1" style={{ minHeight: "44px", background: "none", border: "none", cursor: "pointer" }}>
          <MoreHorizontal className="h-5 w-5" style={{ color: moreActive ? "#146556" : "#8A958F" }} />
          <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: moreActive ? "#E8EAE5" : "#8A958F" }}>
            More
          </span>
        </button>
      </nav>
    </>
  );
}