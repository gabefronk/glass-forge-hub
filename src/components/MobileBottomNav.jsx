import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, Briefcase, Calendar, Receipt, MoreHorizontal, PanelsTopLeft, Library, X, DollarSign, Mountain, ClipboardList, Mail } from "lucide-react";
import { isAgentCenterOwner, isWindowQuotesOnly } from "@/lib/agentCenterAccess";
import { Users, CheckSquare, Bot, Network, Search, TrendingUp, MessageSquare, Unlink, FileText, Bug } from "lucide-react";
import { useTodoAccess } from '@/hooks/use-todo-access';

// Labels match the desktop sidebar (YaFeesSidebar). Primary bar keeps short
// labels because five slots share the phone width.
const PRIMARY_NAV = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "To-do", to: "/todos", icon: CheckSquare, todoOnly: true },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

const SECONDARY_NAV = [
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft },
  { label: "Job Budgets", to: "/job-budgets", icon: DollarSign, ownerOnly: true },
  { label: "Brands & Specs", to: "/brands-specs", icon: Library },
  { label: "Summit", ariaLabel: "Summit door service", to: "/summit", icon: Mountain },
  { label: "Contacts", to: "/contacts", icon: Users, ownerOnly: true },
  { label: "Purchase Orders", to: "/purchase-orders", icon: ClipboardList, ownerOnly: true },
];

const ADMIN_NAV = [
  { label: "Agent Center", to: "/admin/agents", icon: Bot },
  { label: "System Map", to: "/system-map", icon: Network },
  { label: "Research Queue", to: "/research-queue", icon: Search },
  { label: "Sales Tracker", to: "/sales-tracker", icon: TrendingUp },
  { label: "Messages", to: "/messages", icon: MessageSquare },
  { label: "Inbox Agents", to: "/inbox-agents", icon: Mail },
  { label: "Unlinked Records", to: "/admin/unlinked", icon: Unlink },
  { label: "ProBuild Daily", to: "/admin/probuild-daily", icon: FileText },
  { label: "Match Debug", to: "/match-debug", icon: Bug },
];

const ACTIVE_ICON = "var(--gf-brass-300)";
const IDLE = "var(--gf-sidebar-text)";
const ACTIVE_TEXT = "var(--gf-sidebar-text-on)";

function SheetLink({ item, active }) {
  const Icon = item.icon;
  return (
    <Link to={item.to} aria-label={item.ariaLabel || item.label} aria-current={active ? "page" : undefined}
      className="flex min-h-[44px] flex-col items-center justify-center gap-1.5 rounded-xl px-2 py-2.5"
      style={{
        backgroundColor: active ? "rgba(184,149,90,.14)" : "transparent",
        border: "1px solid " + (active ? "rgba(184,149,90,.35)" : "transparent"),
      }}>
      <Icon className="h-5 w-5" style={{ color: active ? ACTIVE_ICON : IDLE }} />
      <span className="text-center text-[12px] font-medium leading-tight" style={{ color: active ? ACTIVE_TEXT : IDLE }}>{item.label}</span>
    </Link>
  );
}

export default function MobileBottomNav({ user }) {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const todoAccess = useTodoAccess(user);

  useEffect(() => { setMoreOpen(false); }, [pathname]);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const closeOnEscape = event => { if (event.key === "Escape") setMoreOpen(false); };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

  const isPrimaryActive = (to) => pathname === to || (to === "/jobs" && pathname.startsWith("/jobs/"));
  const isSecondaryActive = (to) => pathname === to;
  const quotesOnly = isWindowQuotesOnly(user);
  const owner = isAgentCenterOwner(user);
  const visiblePrimary = quotesOnly ? [{ label: "Quotes", ariaLabel: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft }] : PRIMARY_NAV.filter(item => !item.todoOnly || todoAccess);
  const visibleSecondary = quotesOnly ? SECONDARY_NAV.filter((s) => s.to === "/brands-specs" || s.to === "/summit") : SECONDARY_NAV.filter((s) => !s.ownerOnly || owner);
  const visibleAdmin = owner && !quotesOnly ? ADMIN_NAV : [];
  const moreActive = [...visibleSecondary, ...visibleAdmin].some((s) => isSecondaryActive(s.to));
  const showMore = visibleSecondary.length + visibleAdmin.length > 0;

  return (
    <>
      {moreOpen && (
        <>
          <div onClick={() => setMoreOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40, backgroundColor: "rgba(10,29,31,.4)" }} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="More navigation"
            className="overflow-y-auto"
            style={{
              position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 41,
              maxHeight: "85dvh",
              background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))",
              borderTop: "1px solid rgba(255,255,255,.08)",
              borderRadius: "16px 16px 0 0",
              paddingBottom: "max(12px, env(safe-area-inset-bottom))",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)",
              boxShadow: "0 -8px 24px -12px rgba(10,29,31,.4)",
            }}
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span className="text-[13px] font-semibold" style={{ color: ACTIVE_TEXT }}>More</span>
              <button onClick={() => setMoreOpen(false)} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-lg" style={{ color: IDLE }}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 px-4 pb-4">
              {visibleSecondary.map((item) => <SheetLink key={item.to} item={item} active={isSecondaryActive(item.to)} />)}
            </div>
            {visibleAdmin.length > 0 && (
              <div role="group" aria-labelledby="mobile-admin-heading" className="mx-4 mb-2 pt-3" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
                <div id="mobile-admin-heading" className="px-1 pb-2 text-[10.5px] font-medium uppercase" style={{ color: "var(--gf-sidebar-muted)", letterSpacing: "0.08em" }}>Admin</div>
                <div className="grid grid-cols-3 gap-2 pb-2">
                  {visibleAdmin.map((item) => <SheetLink key={item.to} item={item} active={isSecondaryActive(item.to)} />)}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      <nav
        aria-label="Main navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around"
        style={{
          background: "linear-gradient(180deg, var(--gf-sidebar-top), var(--gf-sidebar-bottom))",
          borderTop: "1px solid rgba(255,255,255,.08)",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {visiblePrimary.map((item) => {
          const Icon = item.icon;
          const active = isPrimaryActive(item.to);
          return (
            <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} aria-label={item.ariaLabel || item.label}
              className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1" style={{ minHeight: "44px" }}>
              <Icon className="h-5 w-5" style={{ color: active ? ACTIVE_ICON : IDLE }} />
              <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: active ? ACTIVE_TEXT : IDLE }}>
                {item.label}
              </span>
            </Link>
          );
        })}
        {showMore && <button onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-label="More navigation" aria-current={moreActive ? "page" : undefined}
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1" style={{ minHeight: "44px", background: "none", border: "none", cursor: "pointer" }}>
          <MoreHorizontal className="h-5 w-5" style={{ color: moreActive ? ACTIVE_ICON : IDLE }} />
          <span className="text-[12px] font-medium whitespace-nowrap" style={{ color: moreActive ? ACTIVE_TEXT : IDLE }}>
            More
          </span>
        </button>}
      </nav>
    </>
  );
}
