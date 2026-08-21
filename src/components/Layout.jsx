import { Outlet, Link, useLocation } from "react-router-dom";
import YaFeesSidebar from "@/components/YaFeesSidebar";
import { Receipt, Calendar, Briefcase, BarChart3 } from "lucide-react";
import { C } from "@/lib/feeUI";

const NAV_ITEMS = [
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Dashboard", to: "/dashboard", icon: BarChart3 },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

export default function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-background">
      <YaFeesSidebar />
      <main className="sm:ml-60 min-w-0 pb-14 sm:pb-0">
        <Outlet />
      </main>
      {/* Mobile bottom nav */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t"
        style={{ backgroundColor: C.card, borderColor: C.border, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link key={item.to} to={item.to} className="flex flex-col items-center gap-0.5 py-2 px-3">
              <Icon className="h-5 w-5" style={{ color: active ? C.accent : C.text, opacity: active ? 1 : 0.5 }} />
              <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: active ? C.accent : C.text, opacity: active ? 1 : 0.5 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}