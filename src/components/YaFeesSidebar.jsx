import { Link, useLocation } from "react-router-dom";
import { Receipt, Calendar, Diamond } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "YA Fees", to: "/", icon: Receipt },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

export default function YaFeesSidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden sm:flex w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border">
        <Diamond className="h-5 w-5 text-sidebar-foreground" />
        <span className="font-heading text-sm font-bold uppercase tracking-widest text-sidebar-foreground">
          Glass Forge
        </span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
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
                  ? "bg-sidebar-foreground text-sidebar-background"
                  : "text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-foreground/10"
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