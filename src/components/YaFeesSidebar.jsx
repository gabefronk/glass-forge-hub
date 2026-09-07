import { Link, useLocation } from "react-router-dom";
import { Receipt, Calendar, Diamond, Briefcase, BarChart3, Bug, LogOut, PanelsTopLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { isReady, buildSupersededSet } from "@/lib/invoicingFilters";
import { formatMoney } from "@/lib/feeMath";

const NAV_ITEMS = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
  { label: "Window Quotes", to: "/window-quotes", icon: PanelsTopLeft },
  { label: "Jobs", to: "/jobs", icon: Briefcase },
  { label: "Invoicing", to: "/", icon: Receipt },
  { label: "Calendar", to: "/calendar", icon: Calendar },
];

function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

function monthLabel(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString("en-US", { month: "short" });
}

export default function YaFeesSidebar() {
  const { pathname } = useLocation();
  const [unbilled, setUnbilled] = useState({ total: 0, count: 0 });
  const [user, setUser] = useState(null);
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await base44.auth.logout("/login");
    } catch {
      window.location.href = "/login";
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const me = await base44.auth.me();
        if (me) setUser(me);
      } catch {}
    })();
  }, []);

  // Recompute unbilled whenever the route changes (user navigates back to
  // Invoicing after edits, or new ingest runs) — not just on first mount.
  useEffect(() => {
    (async () => {
      try {
        const month = currentMonthStr();
        const [rows, calEvents] = await Promise.all([
          base44.entities.FeeLines.filter({ invoice_month: month }, "-job_date", 5000),
          base44.entities.CalendarEvents.list("-event_date", 5000),
        ]);
        const rsm = new Map();
        for (const e of (Array.isArray(calEvents) ? calEvents : [])) {
          if (e.google_event_id && (e.event_date || "").startsWith(month)) rsm.set(e.google_event_id, e.report_status);
        }
        const ss = buildSupersededSet(rows);
        const readyRows = rows.filter((r) => isReady(r, rsm, ss));
        const total = readyRows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
        setUnbilled({ total, count: readyRows.length });
      } catch {}
    })();
  }, [pathname]);

  return (
    <aside
      className="hidden lg:flex fixed left-0 top-0 h-dvh shrink-0 flex-col z-30"
      style={{ width: "216px", backgroundColor: "#FFFFFF", borderRight: "1px solid #DDE3EC" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 h-16" style={{ borderBottom: "1px solid #DDE3EC" }}>
        <Diamond className="h-4 w-4" style={{ color: "#2A5EA8" }} fill="#2A5EA8" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "#131A26" }}>
          Glass Forge
        </span>
      </div>

      {/* Nav */}
      <nav aria-label="Main navigation" className="min-h-0 flex-1 px-3 py-4 space-y-1 overflow-y-auto obsidian-scroll">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to || (item.to === "/jobs" && pathname.startsWith("/jobs/"));
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className="flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap"
              style={{
                borderRadius: "10px",
                backgroundColor: active ? "#E7EEFA" : "transparent",
                color: active ? "#1E4A85" : "#535E72",
              }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
        {user?.role === "admin" && (
          <Link
            to="/match-debug"
            className="flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap"
            style={{
              borderRadius: "10px",
              backgroundColor: pathname === "/match-debug" ? "#E7EEFA" : "transparent",
              color: pathname === "/match-debug" ? "#1E4A85" : "#535E72",
            }}
          >
            <Bug className="h-4 w-4 shrink-0" />
            Match Debug
          </Link>
        )}
      </nav>

      {/* Unbilled mini card */}
      <div className="px-3 pb-3">
        <div className="rounded-[10px] px-3.5 py-3 card-shadow" style={{ backgroundColor: "#F6F8FC", border: "1px solid #DDE3EC" }}>
          <div className="mono-label-sm mb-1.5">Unbilled · {monthLabel(currentMonthStr())}</div>
          <div className="flex flex-wrap items-baseline gap-1.5 break-all">
            <span className="font-mono-num-bold text-[18px]" style={{ color: "#1E4A85", letterSpacing: "-0.02em" }}>
              ${formatMoney(unbilled.total)}
            </span>
            <span className="text-[11px]" style={{ color: "#616D81" }}>
              / {unbilled.count} lines
            </span>
          </div>
        </div>
      </div>

      {/* User chip */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]" style={{ backgroundColor: "#F6F8FC", border: "1px solid #DDE3EC" }}>
          <div className="h-7 w-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold" style={{ backgroundColor: "#E7EEFA", color: "#1E4A85" }}>
            {(user?.email || user?.full_name || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium truncate" style={{ color: "#131A26" }}>
              {user?.full_name || user?.email?.split("@")[0] || "User"}
            </div>
            <div className="text-[10px] truncate" style={{ color: "#616D81" }}>
              {user?.email || ""}
            </div>
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            title="Sign out"
            aria-label="Sign out"
            className="shrink-0 flex items-center justify-center h-7 w-7 rounded-full transition-colors"
            style={{ color: "#77839A" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#8A4038")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#77839A")}
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
