import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, Briefcase, Calendar, Receipt, MoreHorizontal, PanelsTopLeft, Library, Package, Bot, X, DollarSign, Mountain, Search, Settings2, ChevronDown } from "lucide-react";
import { canViewAgentCenter, isAgentCenterOwner, isWindowQuotesOnly } from "@/lib/agentCenterAccess";
import { MessageSquare, Users, Network, CheckSquare, Mic } from "lucide-react";
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
  { label: "Products", ariaLabel: "Products reference", to: "/products", icon: Package },
  { label: "Summit", ariaLabel: "Summit door service", to: "/summit", icon: Mountain },
  { label: "Budgets", ariaLabel: "Job Budgets", to: "/job-budgets", icon: DollarSign, ownerOnly: true },
  { label: "Contacts", to: "/contacts", icon: Users, ownerOnly: true },
  { label: "Messages", to: "/messages", icon: MessageSquare, ownerOnly: true },
  { label: "System map", to: "/system-map", icon: Network, ownerOnly: true },
  { label: "HUD", ariaLabel: "Command HUD", to: "/command-hud", icon: Mic, ownerOnly: true },
];

export default function MobileBottomNav({ user }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const operationsActive = pathname === "/admin/agents" || pathname === "/research-queue";
  const [operationsOpen, setOperationsOpen] = useState(operationsActive);
  const todoAccess = useTodoAccess(user);

  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => { if (operationsActive) setOperationsOpen(true); }, [operationsActive]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === "Escape") setMoreOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

  const isPrimaryActive = (to) => pathname === to || (to === "/jobs" && pathname.startsWith("/jobs/"));
  const isSecondaryActive = (to) => pathname === to;
  const quotesOnly = isWindowQuotesOnly(user);
  const visiblePrimary = quotesOnly ? [{ label: "Quotes", ariaLabel: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft }] : PRIMARY_NAV.filter(item => !item.todoOnly || todoAccess);
  const visibleSecondary = quotesOnly ? SECONDARY_NAV.filter((s) => s.to === "/products" || s.to === "/summit") : SECONDARY_NAV.filter((s) => !s.ownerOnly || isAgentCenterOwner(user));
  const moreActive = operationsActive || visibleSecondary.some((s) => isSecondaryActive(s.to));
  const showMore = visibleSecondary.length > 0 || canViewAgentCenter(user);

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
              {(canViewAgentCenter(user) || isAgentCenterOwner(user)) && (
                <div className="col-span-3 rounded-xl" style={navItemStyle(operationsActive)}>
                  <button type="button" aria-expanded={operationsOpen} aria-controls="mobile-operations-navigation"
                    onClick={() => setOperationsOpen((open) => !open)}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl px-3 text-left">
                    <Settings2 className="h-5 w-5" style={{ color: operationsActive ? "#146556" : "#8A958F" }} aria-hidden="true" />
                    <span className="flex-1 text-[12px] font-medium" style={{ color: operationsActive ? "#E8EAE5" : "#8A958F" }}>Operations</span>
                    <ChevronDown className={`h-4 w-4 transition-transform ${operationsOpen ? "rotate-180" : ""}`} style={{ color: "#8A958F" }} aria-hidden="true" />
                  </button>
                  {operationsOpen && <div id="mobile-operations-navigation" className="grid grid-cols-2 gap-2 px-2 pb-2">
                    {canViewAgentCenter(user) && <MobileOperationsLink to="/admin/agents" label="Agent Center" icon={Bot} active={pathname === "/admin/agents"} />}
                    {isAgentCenterOwner(user) && <MobileOperationsLink to="/research-queue" label="Research Queue" icon={Search} active={pathname === "/research-queue"} />}
                  </div>}
                </div>
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
        {visiblePrimary.map((item) => {
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
        {showMore && <button onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="More navigation" aria-current={moreActive ? "page" : undefined}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1" style={{ minHeight: "44px", background: "none", border: "none", cursor: "pointer" }}>
          <MoreHorizontal className="h-5 w-5" style={{ color: moreActive ? "#146556" : "#8A958F" }} />
          <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: moreActive ? "#E8EAE5" : "#8A958F" }}>
            More
          </span>
        </button>}
      </nav>
    </>
  );
}

function MobileOperationsLink({ to, label, icon: Icon, active }) {
  return (
    <Link to={to} aria-current={active ? "page" : undefined}
      className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2"
      style={{ backgroundColor: active ? "#2A3A35" : "rgba(255,255,255,.03)" }}>
      <Icon className="h-4 w-4" style={{ color: active ? "#146556" : "#8A958F" }} aria-hidden="true" />
      <span className="text-[12px] font-medium" style={{ color: active ? "#E8EAE5" : "#8A958F" }}>{label}</span>
    </Link>
  );
}
