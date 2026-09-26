import { relativeTime, mailboxName } from "@/lib/inboxAgents";

// Mailbox switcher inside the hero: "All" then one chip per mailbox, each with a
// connected (green) / not connected (amber) dot and when it last synced.
const chipBase = "inline-flex min-h-11 sm:min-h-9 items-center gap-2 rounded-full px-3.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors";
const on = { backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)", border: "1px solid transparent" };
const off = { backgroundColor: "rgba(255,255,255,.07)", color: "var(--gf-sidebar-text)", border: "1px solid rgba(255,255,255,.12)" };

export default function MailboxChips({ mailboxes, value, onChange }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Mailbox">
      <button type="button" role="tab" aria-selected={value === "all"} className={chipBase} style={value === "all" ? on : off} onClick={() => onChange("all")}>All</button>
      {(mailboxes || []).map((m) => {
        const active = value === m.key;
        // `connected` is undefined until the owner-only connector check answers; only a
        // definite false is "not connected".
        const down = m.connected === false;
        const dot = down ? "var(--gf-amber-500)" : m.connected ? "#3ddc97" : "#CEC6B8";
        const synced = m.last_synced_at ? `synced ${relativeTime(m.last_synced_at)}` : "never synced";
        return (
          <button key={m.key} type="button" role="tab" aria-selected={active} className={chipBase} style={active ? on : off} onClick={() => onChange(m.key)}
            title={`${m.address || ""}${down ? " · not connected" : ""}${m.last_error ? ` · ${m.last_error}` : ""}`}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot, boxShadow: `0 0 0 3px ${down ? "rgba(192,139,46,.22)" : m.connected ? "rgba(61,220,151,.18)" : "rgba(206,198,184,.25)"}` }} aria-hidden="true" />
            <span className="flex flex-col items-start leading-tight">
              <span>{mailboxName(m)}</span>
              <span className="text-[10.5px] font-medium" style={{ color: active ? "rgba(29,22,10,.7)" : "var(--gf-sidebar-muted)" }}>{down ? "not connected" : synced}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
