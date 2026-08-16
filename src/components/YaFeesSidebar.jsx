import { Link, useLocation } from "react-router-dom";
import { Receipt, Calendar, Diamond, Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

export default function YaFeesSidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden sm:flex fixed left-0 top-0 h-screen w-60 shrink-0 flex-col bg-white text-black border-r border-border z-30">
      <div className="h-16 flex items-center gap-2 px-6 border-b border-border">
        <Diamond className="h-5 w-5 text-black" />
        <span className="font-heading text-sm font-bold uppercase tracking-widest text-black">
          Glass Forge
        </span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors uppercase tracking-wide",
                active
                  ? "bg-black text-white"
                  : "text-black/60 hover:text-black hover:bg-black/5"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}