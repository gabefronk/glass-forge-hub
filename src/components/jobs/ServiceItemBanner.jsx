import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { TriangleAlert, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { formatShort } from "@/lib/feeUI";
import PhotoStrip from "./PhotoStrip";

// The big red "SERVICE ITEM" banner at the top of a job. Lives on the job, nowhere else.
// Shows every open item with its stage; expand one to move it along the chain.

export const SERVICE_OPEN = ["reported", "acknowledged", "working", "ordered", "shipped", "delivered", "scheduled", "on_hold"];
export const SERVICE_STATUS = [
  ["reported", "Reported"],
  ["acknowledged", "Acknowledged"],
  ["working", "Being worked on"],
  ["ordered", "Ordered"],
  ["shipped", "Shipped"],
  ["delivered", "Delivered"],
  ["scheduled", "Service scheduled"],
  ["fixed", "Fixed"],
  ["closed", "Closed"],
  ["on_hold", "On hold"],
  ["cancelled", "Cancelled"],
];
export const SERVICE_TYPE_LABEL = {
  wrong_size: "Wrong size", damaged: "Damaged / broken", missing_unit: "Missing or lost unit",
  missing_part: "Missing part / hardware", install_defect: "Install defect", other: "Action needed",
};
const CHAIN = ["reported", "acknowledged", "working", "ordered", "shipped", "delivered", "scheduled", "fixed", "closed"];
const label = (s) => (SERVICE_STATUS.find(([k]) => k === s) || [s, s])[1];
const RED = "#A43432", RED_DK = "#7d2523", RED_BG = "#FCEDEC", RED_LINE = "#F0C9C5";

const ageDays = (iso) => {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
};

export function serviceItemsSummary(items) {
  const open = (items || []).filter((i) => SERVICE_OPEN.includes(i.status));
  return { open, count: open.length, worst: open.reduce((m, i) => Math.max(m, ageDays(i.last_activity_at || i.created_date)), 0) };
}

export default function ServiceItemBanner({ jobId, currentUser, onChanged }) {
  const [items, setItems] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await base44.functions.invoke("serviceItems", { action: "list", job_id: jobId });
      setItems(res?.data?.items || []);
    } catch { setItems([]); }
  };
  useEffect(() => { setItems(null); setOpenId(null); load(); }, [jobId]);

  if (!items) return null;
  const open = items.filter((i) => SERVICE_OPEN.includes(i.status));
  if (!open.length) return null;

  const update = async (id, patch) => {
    setBusy(true); setError("");
    try {
      const res = await base44.functions.invoke("serviceItems", { action: "update", id, ...patch });
      const code = res?.data?.error;
      if (code) throw new Error({ eta_required: "Add an ETA before marking it ordered or shipped.", note_required: "Add a closing note first." }[code] || code);
      await load();
      onChanged?.();
    } catch (e) { setError(e?.message || "Update failed."); }
    finally { setBusy(false); }
  };

  return (
    <section aria-label="Service items" className="rounded-[14px] overflow-hidden" style={{ border: `2px solid ${RED}`, boxShadow: "0 14px 34px -22px rgba(164,52,50,.7)" }}>
      <div className="flex items-center gap-3 px-5 py-3 max-[699px]:px-4" style={{ background: `linear-gradient(160deg,${RED} 0%,${RED_DK} 100%)`, color: "#fff" }}>
        <TriangleAlert className="h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "#f6c9c5" }}>Service item{open.length > 1 ? `s · ${open.length}` : ""}</div>
          <div className="font-heading text-[16px] font-bold leading-tight">
            {open.length === 1
              ? `${SERVICE_TYPE_LABEL[open[0].service_type] || "Action needed"}${open[0].unit ? ` — ${open[0].unit}` : ""} · ${label(open[0].status)}`
              : `${open.length} open — this job can't be closed until they're fixed`}
          </div>
        </div>
      </div>

      <div style={{ backgroundColor: RED_BG }}>
        {open.map((it) => {
          const expanded = openId === it.id;
          const age = ageDays(it.last_activity_at || it.created_date);
          const stepIdx = CHAIN.indexOf(it.status);
          return (
            <div key={it.id} className="px-5 py-3 max-[699px]:px-4" style={{ borderTop: `1px solid ${RED_LINE}` }}>
              <button type="button" onClick={() => setOpenId(expanded ? null : it.id)} className="flex w-full items-center gap-3 text-left">
                <span className="inline-flex shrink-0 items-center rounded-[6px] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.06em]" style={{ backgroundColor: RED, color: "#fff" }}>{label(it.status)}</span>
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold" style={{ color: "#3b1f1e" }}>
                  {SERVICE_TYPE_LABEL[it.service_type] || "Action needed"}{it.unit ? ` — ${it.unit}` : ""}
                  <span className="ml-2 text-[12px] font-medium" style={{ color: age >= 5 ? RED : age >= 2 ? "#9a5a12" : "#6b5a58" }}>
                    {age === 0 ? "updated today" : `${age} day${age === 1 ? "" : "s"} since activity`}
                  </span>
                  {it.eta_date ? <span className="ml-2 text-[12px] font-medium" style={{ color: "#6b5a58" }}>· ETA {formatShort(it.eta_date)}</span> : null}
                </span>
                {expanded ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: RED }} /> : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: RED }} />}
              </button>

              {/* Stage rail */}
              <div className="mt-2 flex flex-wrap gap-1">
                {CHAIN.map((s, i) => (
                  <span key={s} className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                    style={i < stepIdx ? { backgroundColor: "#e6cfcc", color: "#7d2523" } : i === stepIdx ? { backgroundColor: RED, color: "#fff" } : { backgroundColor: "#fff", color: "#a08a88", border: `1px solid ${RED_LINE}` }}>
                    {label(s)}
                  </span>
                ))}
              </div>

              {expanded ? (
                <ServiceItemDetail item={it} busy={busy} error={error} onUpdate={(patch) => update(it.id, patch)} />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ServiceItemDetail({ item, busy, error, onUpdate }) {
  const [status, setStatus] = useState(item.status);
  const [note, setNote] = useState("");
  const [eta, setEta] = useState(item.eta_date || "");
  const [tracking, setTracking] = useState(item.tracking || "");
  const [supplier, setSupplier] = useState(item.supplier || "");
  const [orderRef, setOrderRef] = useState(item.order_ref || "");
  const [cause, setCause] = useState(item.cause || "");
  const [costOwner, setCostOwner] = useState(item.cost_owner || "");
  const [serviceDate, setServiceDate] = useState(item.service_date || "");
  const needsOrder = ["ordered", "shipped", "delivered"].includes(status);
  const field = "w-full min-h-[38px] rounded-[8px] px-2.5 text-[13px] focus:outline-none";
  const fieldStyle = { border: `1px solid ${RED_LINE}`, backgroundColor: "#fff", color: "#182422" };

  const save = () => onUpdate({
    status: status !== item.status ? status : undefined,
    note: note.trim() || undefined,
    eta_date: eta || undefined, tracking: tracking || undefined, supplier: supplier || undefined,
    order_ref: orderRef || undefined, cause: cause || undefined, cost_owner: costOwner || undefined,
    service_date: serviceDate || undefined,
  });

  return (
    <div className="mt-3 rounded-[10px] bg-white p-3" style={{ border: `1px solid ${RED_LINE}` }}>
      {item.description ? <p className="m-0 text-[13px] whitespace-pre-wrap" style={{ color: "#182422" }}>{item.description}</p> : null}
      <PhotoStrip urls={item.photos} onPhotoClick={(u) => window.open(u, "_blank")} />
      <p className="mt-2 mb-0 text-[11.5px]" style={{ color: "#6b5a58" }}>Reported by {item.created_by_email || "crew"} · {item.created_date ? formatShort(item.created_date.slice(0, 10)) : ""}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Stage
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={field} style={fieldStyle}>
            {SERVICE_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>ETA {needsOrder ? "(required)" : ""}
          <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} className={field} style={fieldStyle} />
        </label>
        {needsOrder ? (<>
          <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Supplier
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="AMSCO, Andersen, Pella…" className={field} style={fieldStyle} />
          </label>
          <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>PO / OE / order #
            <input value={orderRef} onChange={(e) => setOrderRef(e.target.value)} className={field} style={fieldStyle} />
          </label>
          <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Tracking
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} className={field} style={fieldStyle} />
          </label>
        </>) : null}
        {status === "scheduled" ? (
          <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Service date
            <input type="date" value={serviceDate} onChange={(e) => setServiceDate(e.target.value)} className={field} style={fieldStyle} />
          </label>
        ) : null}
        <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Cause
          <select value={cause} onChange={(e) => setCause(e.target.value)} className={field} style={fieldStyle}>
            <option value="">—</option><option value="measure">Measure</option><option value="supplier">Supplier fab</option><option value="site">Site / theft</option><option value="install">Install</option><option value="unknown">Unknown</option>
          </select>
        </label>
        <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Who eats it
          <select value={costOwner} onChange={(e) => setCostOwner(e.target.value)} className={field} style={fieldStyle}>
            <option value="">—</option><option value="us">Us</option><option value="supplier_claim">Supplier claim</option><option value="builder_backcharge">Builder backcharge</option>
          </select>
        </label>
      </div>
      <label className="mt-2 block text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Update note {status === "closed" ? "(required to close)" : ""}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What happened / what's next" className={field + " py-2 resize-y"} style={fieldStyle} />
      </label>
      {status === "scheduled" ? <p className="mt-1 mb-0 text-[11px]" style={{ color: "#6b5a58" }}>Put the service visit on the calendar from the Calendar page as usual; set the date here so the banner shows it.</p> : null}
      {error ? <p role="alert" className="mt-2 mb-0 text-[12px]" style={{ color: RED }}>{error}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: "#6b5a58" }}>Saving resets the daily ping.</span>
        <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: RED }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save update
        </button>
      </div>

      {item.activity_log?.length ? (
        <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${RED_LINE}` }}>
          <div className="text-[10.5px] font-bold uppercase tracking-[.1em]" style={{ color: "#6b5a58" }}>History</div>
          <ul className="m-0 mt-1 list-none p-0 space-y-0.5">
            {[...item.activity_log].reverse().map((e, i) => (
              <li key={i} className="text-[12px]" style={{ color: "#3b1f1e" }}>
                <span style={{ color: "#6b5a58" }}>{e.at ? formatShort(e.at.slice(0, 10)) : ""}</span> · {e.action}{e.note ? ` — ${e.note}` : ""} <span style={{ color: "#6b5a58" }}>({e.by})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
