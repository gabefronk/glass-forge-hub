import { Link, useLocation } from "react-router-dom";
import { Receipt, Calendar, Diamond, Briefcase, BarChart3, Bug } from "lucide-react";
import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { isReady } from "@/lib/invoicingFilters";
import { formatMoney } from "@/lib/feeMath";

const NAV_ITEMS = [
  { label: "Today", to: "/dashboard", icon: BarChart3 },
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
        const readyRows = rows.filter((r) => isReady(r, rsm));
        const total = readyRows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
        setUnbilled({ total, count: readyRows.length });
      } catch {}
    })();
  }, [pathname]);

  return (
    <aside
      className="hidden min-[700px]:flex fixed left-0 top-0 h-screen shrink-0 flex-col z-30"
      style={{ width: "216px", backgroundColor: "#0B0D0D", borderRight: "1px solid rgba(255,255,255,.07)" }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-5 h-16" style={{ borderBottom: "1px solid rgba(255,255,255,.07)" }}>
        <Diamond className="h-4 w-4" style={{ color: "#6EE7C0" }} fill="#6EE7C0" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "#FFFFFF" }}>
          Glass Forge
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto obsidian-scroll">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 px-3 py-2.5 text-[13px] font-medium transition-colors whitespace-nowrap"
              style={{
                borderRadius: "11px",
                backgroundColor: active ? "rgba(110,231,192,.14)" : "transparent",
                color: active ? "#6EE7C0" : "rgba(255,255,255,.62)",
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
              borderRadius: "11px",
              backgroundColor: pathname === "/match-debug" ? "rgba(110,231,192,.14)" : "transparent",
              color: pathname === "/match-debug" ? "#6EE7C0" : "rgba(255,255,255,.62)",
            }}
          >
            <Bug className="h-4 w-4 shrink-0" />
            Match Debug
          </Link>
        )}
      </nav>

      {/* Unbilled mini card */}
      <div className="px-3 pb-3">
        <div className="rounded-[12px] px-3.5 py-3" style={{ backgroundColor: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)" }}>
          <div className="mono-label-sm mb-1.5">Unbilled · {monthLabel(currentMonthStr())}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono-num-bold text-[18px]" style={{ color: "#6EE7C0", letterSpacing: "-0.02em" }}>
              ${formatMoney(unbilled.total)}
            </span>
            <span className="font-mono text-[11px]" style={{ color: "rgba(255,255,255,.42)" }}>
              / {unbilled.count} lines
            </span>
          </div>
        </div>
      </div>

      {/* User chip */}
      <div className="px-3 pb-4">
        <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[10px]" style={{ backgroundColor: "rgba(255,255,255,.04)" }}>
          <div className="h-7 w-7 rounded-full shrink-0 flex items-center justify-center font-mono text-[11px] font-semibold" style={{ backgroundColor: "rgba(110,231,192,.14)", color: "#6EE7C0" }}>
            {(user?.email || user?.full_name || "?").charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium truncate" style={{ color: "#FFFFFF" }}>
              {user?.full_name || user?.email?.split("@")[0] || "User"}
            </div>
            <div className="text-[10px] truncate" style={{ color: "rgba(255,255,255,.42)" }}>
              {user?.email || ""}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}