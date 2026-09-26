import { useState } from "react";
import { ChevronDown, LockKeyhole } from "lucide-react";
import { C } from "@/lib/feeUI";

// Owner-only panels on the job page (quotes & orders, money, private messages) live
// behind one collapsed "Owner" bar so the page the crew works from stays short.
// The panels mount only when opened, so nothing owner-only loads until it's asked for.
const KEY = "gf.job.owner.open";
const readOpen = () => { try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; } };
const writeOpen = (v) => { try { sessionStorage.setItem(KEY, v ? "1" : "0"); } catch { /* per-viewer convenience only */ } };

export default function OwnerSection({ children }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => setOpen((v) => { writeOpen(!v); return !v; });
  return (
    <section aria-label="Owner" className="overflow-hidden rounded-[14px] card-shadow" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="job-owner-panels"
        className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left"
        style={{ background: C.headerBg, borderBottom: open ? `1px solid ${C.border}` : "none" }}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]" style={{ backgroundColor: "var(--gf-teal-600)", color: "#f2eee8" }}>
          <LockKeyhole className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-heading text-[16px] font-bold" style={{ color: C.text }}>Owner</span>
          <span className="block text-[11px]" style={{ color: C.textMuted }}>{open ? "Quotes & orders, money and private messages" : "Tap to show quotes & orders, money and private messages"}</span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 transition-transform" style={{ color: C.textMuted, transform: open ? "rotate(180deg)" : "none" }} />
      </button>
      {open ? <div id="job-owner-panels" className="job-owner-panels px-3 pb-3 max-[699px]:px-2">{children}</div> : null}
    </section>
  );
}
