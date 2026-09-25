import { C } from "@/lib/feeUI";
import { DIP_SWITCHES } from "./summitData";

// Renders the DIP switches, blink codes, and pot settings relevant to a fault node.
// Shown on every node so the tech has the board context at hand.
export default function NodeMetaPanel({ node }) {
  if (!node) return null;
  const dips = (node.meta_dip_switches || []).map((n) => Number(n)).filter((n) => Number.isFinite(n));
  const dipsResolved = dips.map((n) => DIP_SWITCHES.find((d) => d.number === n)).filter(Boolean);
  const blinks = node.meta_blink_codes || [];
  const pots = node.meta_pot_settings || [];

  if (!dipsResolved.length && !blinks.length && !pots.length) return null;

  return (
    <div
      className="rounded-[12px] p-4 mt-4"
      style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}
    >
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.13em] mb-3" style={{ color: C.textMuted }}>
        Board context
      </div>

      {dipsResolved.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.textSecondary }}>DIP switches</div>
          <div className="flex flex-wrap gap-2">
            {dipsResolved.map((d) => (
              <div
                key={d.number}
                className="flex items-start gap-2 rounded-[8px] px-2.5 py-2"
                style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, minWidth: "0" }}
              >
                <span
                  className="flex items-center justify-center rounded-full font-mono-num text-[12px] font-bold shrink-0"
                  style={{ width: "26px", height: "26px", backgroundColor: C.accent, color: C.accentDark }}
                >
                  {d.number}
                </span>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold leading-tight" style={{ color: C.text }}>{d.name}</div>
                  <div className="text-[11px] mt-0.5 leading-snug" style={{ color: C.textMuted }}>{d.warning}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {blinks.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.textSecondary }}>Blink codes</div>
          <ul className="space-y-1">
            {blinks.map((b, i) => (
              <li key={i} className="text-[12.5px] leading-snug" style={{ color: C.textSecondary }}>
                <span className="font-mono-num font-semibold" style={{ color: C.text }}>•</span> {b}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pots.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold mb-1.5" style={{ color: C.textSecondary }}>Pot settings</div>
          <ul className="space-y-1">
            {pots.map((p, i) => (
              <li key={i} className="text-[12.5px] leading-snug" style={{ color: C.textSecondary }}>
                <span className="font-mono-num font-semibold" style={{ color: C.text }}>•</span> {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}