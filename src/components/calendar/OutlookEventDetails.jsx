import { C } from "@/lib/feeUI";
export default function OutlookEventDetails({event,onClose}) {
 return <section role="dialog" aria-label="Outlook event details" className="mb-4 rounded-xl border p-5" style={{backgroundColor:C.card,borderColor:"#C7B9EC"}}>
 <div className="flex justify-between gap-3"><h2 className="font-semibold">{event.job_name}</h2><button type="button" onClick={onClose}>Close</button></div>
 <p className="text-sm mt-2">{event.event_date} · {event.start_time || "All day"}{event.end_time ? " – "+event.end_time : ""}</p>
 <p className="text-sm">{event.address}</p>
 <p className="text-sm">OE: {event.oe_number || "—"} · PO: {event.po_number || "—"}</p>
 <p className="text-sm whitespace-pre-wrap mt-3">{event.scope_notes}</p>
 <p className="text-xs mt-3">Outlook · {event.calendar_name} · Read only</p>
 <p className="text-xs">Captured {new Date(event.captured_at).toLocaleString()}</p>
 </section>;
}