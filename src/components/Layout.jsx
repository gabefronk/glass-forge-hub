import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";
import { base44 } from "@/api/base44Client";
import { Receipt, Calendar, Briefcase, BarChart3, Bug, PanelsTopLeft, Diamond, LogOut } from "lucide-react";

const NAV_ITEMS = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "Quotes", ariaLabel: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Tracker", to: "/sales-tracker", icon: PanelsTopLeft },
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

export default function Layout() {
  const { pathname } = useLocation();
  const [user, setUser] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    setSigningOut(true);
    try { await base44.auth.logout("/login"); }
    catch { window.location.href = "/login"; }
  };
  useEffect(() => { base44.auth.me().then((me) => { if (me) setUser(me); }).catch(() => {}); }, []);
  return (
    <div className="min-h-dvh" style={{ backgroundColor: "#EEF1F6" }}>
      <YaFeesSidebar />
      <header className="app-mobile-header lg:hidden flex min-w-0 items-center justify-between gap-3 border-b bg-white px-4 py-2">
        <Link to="/dashboard" className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wider">
          <Diamond className="h-4 w-4 shrink-0 text-[#2A5EA8]" /> Glass Forge
        </Link>
        <button type="button" onClick={handleSignOut} disabled={signingOut} aria-label="Sign out" title="Sign out" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#616D81] hover:bg-[#F6F8FC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#2A5EA8]">
          <LogOut className="h-5 w-5" />
        </button>
      </header>
      <main className="app-main lg:ml-[216px] min-w-0">
        <Outlet />
      </main>
      {/* Mobile bottom nav */}
      <nav
        aria-label="Main navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around"
        style={{
          backgroundColor: "rgba(255,255,255,.96)",
          borderTop: "1px solid #DDE3EC",
          paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || (item.to === "/jobs" && pathname.startsWith("/jobs/"));
          return (
            <Link key={item.to} to={item.to} aria-current={active ? "page" : undefined} aria-label={item.ariaLabel || item.label} className="flex min-w-0 flex-col items-center gap-1 py-2.5 px-1 flex-1">
              <Icon className="h-5 w-5" style={{ color: active ? "#2A5EA8" : "#77839A" }} />
              <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: active ? "#2A5EA8" : "#77839A", letterSpacing: ".01em" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
        {user?.role === "admin" && (
          <Link to="/match-debug" aria-current={pathname === "/match-debug" ? "page" : undefined} className="flex min-w-0 flex-col items-center gap-1 py-2.5 px-1 flex-1">
            <Bug className="h-5 w-5" style={{ color: pathname === "/match-debug" ? "#2A5EA8" : "#77839A" }} />
            <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: pathname === "/match-debug" ? "#2A5EA8" : "#77839A", letterSpacing: ".01em" }}>
              Debug
            </span>
          </Link>
        )}
      </nav>
    </div>
  );
}
