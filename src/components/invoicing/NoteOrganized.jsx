import { parseEventNote } from "@/lib/eventNoteParse";
import { formatMoney } from "@/lib/feeMath";

const label = { color: "var(--gf-ink-3)" };
const val = { color: "var(--gf-ink)" };

function Row({ k, children }) {
  return (
    <div className="flex items-baseline gap-2 py-0.5 text-[12.5px]">
      <span className="w-[72px] shrink-0" style={label}>{k}</span>
      <span className="min-w-0" style={val}>{children}</span>
    </div>
  );
}

// Structured read of the raw note below: each delivery/PO block gets its own
// tidy card. Anything the parser cannot read confidently is listed under
// Review instead of guessed. Render-time only; the raw note is untouched.
export default function NoteOrganized({ text }) {
  const parsed = parseEventNote(text);
  if (parsed.blocks.length === 0 && parsed.review.length === 0) return null;
  return (
    <div>
      <div className="mb-2 text-[11px] font-semibold uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>Organized</div>
      <div className="flex flex-col gap-2">
        {parsed.blocks.map((b, i) => (
          <div key={i} className="rounded-[10px] px-3.5 py-2.5" style={{ backgroundColor: "var(--gf-field)", border: b.needsReview ? "1px dashed var(--gf-amber-700)" : "1px solid var(--gf-border)" }}>
            {b.route && <div className="text-[12.5px] font-bold" style={{ color: "var(--gf-teal-800)" }}>{b.route}{b.floor ? ` · ${b.floor}` : ""}</div>}
            {!b.route && b.floor && <div className="text-[12.5px] font-bold" style={val}>{b.floor}</div>}
            {b.deliveries.length > 0 && (
              <Row k={b.deliveries.length > 1 ? "Deliveries" : "Delivery"}>
                {b.deliveries.map((d, j) => (
                  <span key={j} className="mr-3 inline-block tabular-nums">{d.qty} units{d.date ? ` · here ${d.date}` : " · no date"}</span>
                ))}
              </Row>
            )}
            {(b.oe || b.po) && (
              <Row k="Order refs">
                <span className="font-ref">{[b.oe && `OE ${b.oe}`, b.po && `PO ${b.po}`].filter(Boolean).join(" · ")}</span>
              </Row>
            )}
            {b.labor && (
              <Row k="Labor">${formatMoney(b.labor.amount)}{b.labor.unit ? `/${b.labor.unit}` : ""}</Row>
            )}
            {b.contacts.length > 0 && <Row k="Contact">{b.contacts.join(" · ")}</Row>}
            {b.other.length > 0 && <Row k="Also noted">{b.other.join(" · ")}</Row>}
            {b.needsReview && <div className="mt-1 text-[11px] font-semibold" style={{ color: "var(--gf-amber-700)" }}>Incomplete parse - check against the raw note</div>}
          </div>
        ))}
        {parsed.phones.length > 0 && (
          <div className="text-[12.5px]" style={label}>Phone: <span className="font-ref" style={val}>{parsed.phones.join(" · ")}</span></div>
        )}
        {parsed.review.length > 0 && (
          <div className="rounded-[10px] px-3.5 py-2.5" style={{ backgroundColor: "var(--gf-field)", border: "1px dashed var(--gf-amber-700)" }}>
            <div className="text-[11px] font-semibold uppercase" style={{ color: "var(--gf-amber-700)", letterSpacing: "0.08em" }}>Review - not parsed</div>
            {parsed.review.map((l, i) => <div key={i} className="mt-0.5 text-[12.5px]" style={val}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
