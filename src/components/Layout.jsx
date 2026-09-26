import { useEffect, useState } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import MobileBottomNav from "@/components/MobileBottomNav";
import { base44 } from "@/api/base44Client";
import { Diamond, LogOut } from "lucide-react";

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
    <div className="min-h-dvh" style={{ backgroundColor: "var(--gf-canvas)" }}>
      <YaFeesSidebar />
      <header className="app-mobile-header lg:hidden flex min-w-0 items-center justify-between gap-3 border-b" style={{ backgroundColor: "var(--gf-sidebar-top)", borderColor: "rgba(255,255,255,.06)", padding: "10px 16px" }}>
        <Link to="/dashboard" className="flex min-h-11 items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--gf-sidebar-text-on)" }}>
          <Diamond className="h-4 w-4 shrink-0" style={{ color: "var(--gf-brass-400)" }} fill="var(--gf-brass-400)" /> Glass Forge
        </Link>
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleSignOut} disabled={signingOut} aria-label="Sign out" title="Sign out" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ color: "var(--gf-sidebar-muted)" }}>
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>
      <main className="app-main lg:ml-[232px] min-w-0">
        <RouteErrorBoundary key={pathname}>
          <Outlet />
        </RouteErrorBoundary>
      </main>
      <MobileBottomNav user={user} />
    </div>
  );
}