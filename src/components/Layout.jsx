import { useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";
import RouteErrorBoundary from "@/components/RouteErrorBoundary";
import MobileBottomNav from "@/components/MobileBottomNav";
import { base44 } from "@/api/base44Client";

export default function Layout() {
  const { pathname } = useLocation();
  const [user, setUser] = useState(null);
  useEffect(() => { base44.auth.me().then((me) => { if (me) setUser(me); }).catch(() => {}); }, []);
  return (
    <div className="min-h-dvh" style={{ backgroundColor: "var(--gf-canvas)" }}>
      <YaFeesSidebar />
      <main className="app-main lg:ml-[232px] min-w-0">
        <RouteErrorBoundary key={pathname}>
          <Outlet />
        </RouteErrorBoundary>
      </main>
      <MobileBottomNav user={user} />
    </div>
  );
}