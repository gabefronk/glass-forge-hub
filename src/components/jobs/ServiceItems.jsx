import { useCallback, useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { TriangleAlert, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { formatShort } from "@/lib/feeUI";
import PhotoStrip from "./PhotoStrip";

// Service items live inside the job's History, on the field report that raised them:
//   - ServiceItemPanel: the red block under that report (stage rail, update form, log)
//   - ServiceMarker:    the small red pill in the job title bar; click scrolls to the report
//   - useServiceItems:  loads a job's items (this record + its duplicate records)

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
export const serviceLabel = (s) => (SERVICE_STATUS.find(([k]) => k === s) || [s, s])[1];
export const isServiceOpen = (i) => SERVICE_OPEN.includes(i?.status);
const RED = "#A43432", RED_BG = "#FCEDEC", RED_LINE = "#F0C9C5";
const FOCUS_EVENT = "service-item-focus";

const ERRORS = {
  eta_required: "Add an ETA before marking it ordered or shipped.",
  note_required: "Add a closing note first.",
  service_date_required: "Pick the service visit date first.",
  service_report_required: "Fixed needs the service visit's field report marked Complete. Have the crew file it on the service visit first.",
};

const ageDays = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : 0);
export const serviceAnchorId = (id) => `service-item-${id}`;

export function useServiceItems(jobIds) {
  const ids = [...new Set((jobIds || []).filter(Boolean))];
  const key = ids.join(",");
  const [items, setItems] = useState([]);
  const reload = useCallback(async () => {
    if (!key) { setItems([]); return; }
    try {
      const res = await base44.functions.invoke("serviceItems", { action: "list", job_ids: key.split(",") });
      setItems(res?.data?.items || []);
    } catch { /* keep what is shown */ }
  }, [key]);
  useEffect(() => { setItems([]); reload(); }, [reload]);
  return { items, open: items.filter(isServiceOpen), reload };
}

// Red pill for the job title bar. Click → scroll to the report and open the item.
export function ServiceMarker({ open }) {
  if (!open?.length) return null;
  const first = open[0];
  const go = () => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: first.id }));
  return (
    <button type="button" onClick={go} title="Jump to the service item in History"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 py-0.5 text-[12px] font-bold hover:brightness-110"
      style={{ backgroundColor: RED, color: "#fff", border: "1px solid #d9645f" }}>
      <TriangleAlert className="h-3.5 w-3.5" />
      {open.length > 1 ? `${open.length} service items on this home` : `Service item · ${serviceLabel(first.status)}`}
    </button>
  );
}

// withReport: the item sits under its own field report, so the crew's note and photos are
// already shown above it; otherwise (logged by hand) show them here.
export function ServiceItemPanel({ item, withReport = true, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [flash, setFlash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef(null);
  const open = isServiceOpen(item);

  useEffect(() => {
    const onFocus = (e) => {
      if (e.detail !== item.id) return;
      setExpanded(true);
      setFlash(true);
      setTimeout(() => setFlash(false), 1600);
      ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [item.id]);

  const update = async (patch) => {
    setBusy(true); setError("");
    try {
      const res = await base44.functions.invoke("serviceItems", { action: "update", id: item.id, ...patch });
      const code = res?.data?.error;
      if (code) throw new Error(ERRORS[code] || code);
      onChanged?.();
    } catch (e) { setError(e?.message || "Update failed."); }
    finally { setBusy(false); }
  };

  const age = ageDays(item.last_activity_at || item.created_date);
  const stepIdx = CHAIN.indexOf(item.status);
  return (
    <div id={serviceAnchorId(item.id)} ref={ref} className="mt-3 scroll-mt-24 rounded-[10px] px-3 py-2.5 transition-shadow"
      style={{ backgroundColor: open ? RED_BG : "#f6f3ee", border: `1px solid ${open ? RED_LINE : "#e2dcd1"}`, borderLeft: `4px solid ${open ? RED : "#a59f94"}`, boxShadow: flash ? `0 0 0 3px ${RED}55` : "none" }}>
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-left">
        <TriangleAlert className="h-4 w-4 shrink-0" style={{ color: open ? RED : "#6b5a58" }} />
        <span className="text-[11px] font-bold uppercase tracking-[.08em]" style={{ color: open ? RED : "#6b5a58" }}>Service item</span>
        <span className="rounded-[6px] px-2 py-0.5 text-[11px] font-bold uppercase tracking-[.04em]" style={open ? { backgroundColor: RED, color: "#fff" } : { backgroundColor: "#e2dcd1", color: "#3b3a36" }}>{serviceLabel(item.status)}</span>
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold" style={{ color: "#3b1f1e" }}>
          {SERVICE_TYPE_LABEL[item.service_type] || "Action needed"}{item.unit ? ` — ${item.unit}` : ""}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: RED }} /> : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: RED }} />}
      </button>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[12px]" style={{ color: "#6b5a58" }}>
        {open ? <span style={{ color: age >= 5 ? RED : age >= 2 ? "#9a5a12" : "#6b5a58", fontWeight: 600 }}>{age === 0 ? "updated today" : `${age} day${age === 1 ? "" : "s"} since activity`}</span> : null}
        {item.eta_date ? <span>ETA {formatShort(item.eta_date)}</span> : null}
        {item.service_date ? <span style={{ color: item.service_event_draft ? "#9a5a12" : undefined }}>Service visit {formatShort(item.service_date)}{item.service_event_draft ? " (draft)" : ""}</span> : null}
      </div>
      {open ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {CHAIN.map((s, i) => (
            <span key={s} className="rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
              style={i < stepIdx ? { backgroundColor: "#e6cfcc", color: "#7d2523" } : i === stepIdx ? { backgroundColor: RED, color: "#fff" } : { backgroundColor: "#fff", color: "#a08a88", border: `1px solid ${RED_LINE}` }}>
              {serviceLabel(s)}
            </span>
          ))}
        </div>
      ) : null}
      {expanded ? <ServiceItemDetail item={item} withReport={withReport} busy={busy} error={error} onUpdate={update} /> : null}
    </div>
  );
}

function ServiceItemDetail({ item, withReport, busy, error, onUpdate }) {
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
  const showVisit = ["delivered", "scheduled", "fixed"].includes(status) || Boolean(item.service_event_id);
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
      {!withReport ? (
        <>
          {item.description ? <p className="m-0 text-[13px] whitespace-pre-wrap" style={{ color: "#182422" }}>{item.description}</p> : null}
          <PhotoStrip urls={item.photos} onPhotoClick={(u) => window.open(u, "_blank")} />
          <p className="mt-2 mb-3 text-[11.5px]" style={{ color: "#6b5a58" }}>Logged by {item.created_by_email || "office"}</p>
        </>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
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
        {showVisit ? (
          <label className="text-[11.5px] font-semibold" style={{ color: "#6b5a58" }}>Service visit date {status === "scheduled" ? "(required)" : ""}
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
      {status === "delivered" && !item.service_event_id ? <p className="mt-1 mb-0 text-[11px]" style={{ color: "#6b5a58" }}>Saving as Delivered drafts the service visit on both calendars for the next business day (or the date above). Confirm it with Service scheduled.</p> : null}
      {item.service_event_draft && status !== "scheduled" ? <p className="mt-1 mb-0 text-[11px]" style={{ color: "#9a5a12" }}>The service visit on {formatShort(item.service_date)} is a draft. Set the real date and pick Service scheduled to confirm it.</p> : null}
      {status === "scheduled" ? <p className="mt-1 mb-0 text-[11px]" style={{ color: "#6b5a58" }}>Saving puts the visit on the install calendar and the crew calendar (no dollar amounts on the crew one).</p> : null}
      {status === "fixed" && !item.service_report_complete_at ? <p className="mt-1 mb-0 text-[11px]" style={{ color: RED }}>Fixed needs the service visit's field report marked Complete first.</p> : null}
      {error ? <p role="alert" className="mt-2 mb-0 text-[12px]" style={{ color: RED }}>{error}</p> : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px]" style={{ color: "#6b5a58" }}>Saving resets the daily ping.</span>
        <button type="button" disabled={busy} onClick={save} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50" style={{ backgroundColor: RED }}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Save update
        </button>
      </div>

      {item.activity_log?.length ? (
        <div className="mt-3 pt-2" style={{ borderTop: `1px solid ${RED_LINE}` }}>
          <div className="text-[10.5px] font-bold uppercase tracking-[.1em]" style={{ color: "#6b5a58" }}>Service log</div>
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
