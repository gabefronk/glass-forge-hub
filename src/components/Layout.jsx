import { Outlet, Link, useLocation } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";
import { Receipt, Calendar, Briefcase, BarChart3 } from "lucide-react";

const NAV_ITEMS = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

export default function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen" style={{ backgroundColor: "#050606" }}>
      <YaFeesSidebar />
      <main className="min-[700px]:ml-[216px] min-w-0 pb-[80px] min-[700px]:pb-0">
        <Outlet />
      </main>
      {/* Mobile bottom nav */}
      <nav
        className="min-[700px]:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch justify-around"
        style={{
          backgroundColor: "rgba(10,12,12,.96)",
          borderTop: "1px solid rgba(255,255,255,.07)",
          paddingBottom: "22px",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link key={item.to} to={item.to} className="flex flex-col items-center gap-1 py-2.5 px-3 flex-1">
              <Icon className="h-5 w-5" style={{ color: active ? "#6EE7C0" : "rgba(255,255,255,.4)" }} />
              <span className="font-mono text-[9px] font-medium uppercase tracking-[0.13em] whitespace-nowrap" style={{ color: active ? "#6EE7C0" : "rgba(255,255,255,.4)" }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}