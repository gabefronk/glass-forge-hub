import { Link, useLocation } from "react-router-dom";
import { Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

// Single nav item. To add a second nav item later, append one object to NAV_ITEMS.
const NAV_ITEMS = [
  { label: "YA Fees", to: "/", icon: Receipt },
];

export default function YaFeesSidebar() {
  const { pathname } = useLocation();
  return (
    <aside className="hidden sm:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <span className="font-heading text-lg font-semibold tracking-tight text-sidebar-foreground">
          YA Fees
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
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
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