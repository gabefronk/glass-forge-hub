import { C } from "@/lib/feeUI";

const OUTLOOK_COLOR = "#7042A1";

export default function SourceCoverageBar({ outlook, partialOutlook, ownership, ownershipCounts, ownershipError, loading, excludedEvents, month, user, showIsrael, setShowIsrael, showOutlook, setShowOutlook, onReload }) {
  const monthExcluded = excludedEvents.filter((e) => e.event_date?.startsWith(month));
  const outlookAgeHours = outlook ? (Date.now() - new Date(outlook.captured_at).getTime()) / 3600000 : null;
  const isStale = outlookAgeHours != null && outlookAgeHours > 26;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl border p-3" style={{ borderColor: C.border, backgroundColor: C.card }}>
      {/* Status */}
      {loading ? (
        <span className="text-[13px]" style={{ color: C.textMuted }}>Checking sources…</span>
      ) : ownershipError ? (
        <span className="text-[13px]" style={{ color: "#89511A" }}>{ownershipError} <button className="underline ml-1" onClick={onReload}>Reload</button></span>
      ) : (
        <span className="text-[13px]" style={{ color: C.textSecondary }}>
          <span style={{ color: C.accent }}>●</span> Sales Tracker verified · {ownershipCounts?.visible_events || 0} visits · {ownershipCounts?.unmatched_events || 0} unmatched (shown)
        </span>
      )}

      {/* Persistent warnings */}
      {isStale && (
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: "#FFF3DF", border: "1px solid #F0DBA8", color: "#89511A" }}>
          Outlook {Math.round(outlookAgeHours)}h old
        </span>
      )}
      {partialOutlook && (
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: "#FFF3DF", border: "1px solid #F0DBA8", color: "#89511A" }}>
          Incomplete Outlook ({partialOutlook.event_count})
        </span>
      )}
      {!outlook && (
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#53615B" }}>
          No Outlook import
        </span>
      )}

      {/* Expandable details */}
      <details className="ml-auto">
        <summary className="cursor-pointer text-[12px] font-medium hover:underline list-none" style={{ color: C.textSecondary }}>
          Sources ▾
        </summary>
        <div className="mt-2 rounded-lg p-3 text-[12px] space-y-2" style={{ backgroundColor: "#F0F1ED", border: `1px solid ${C.border}`, color: C.textSecondary, lineHeight: 1.5, minWidth: "280px" }}>
          {outlook && (
            <div>
              <strong>Outlook snapshot:</strong> {outlook.range_start}–{outlook.range_end} · captured {new Date(outlook.captured_at).toLocaleString()} · {outlook.event_count} source events. A new Outlook import is needed for dates outside this coverage.
            </div>
          )}
          {partialOutlook && (
            <div style={{ color: "#89511A" }}>
              Latest collection incomplete ({partialOutlook.event_count} events): {partialOutlook.collection_notes}
            </div>
          )}
          {ownership && (
            <div>
              <strong>Matching:</strong> OE or PO first, then exact builder, subdivision, and lot. Source calendar records remain intact. Only verified Sales Tracker matches appear below.
            </div>
          )}
          {user?.role === "admin" && (
            <div className="flex flex-wrap gap-3 pt-2 border-t" style={{ borderColor: C.border }}>
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={showIsrael} onChange={(e) => setShowIsrael(e.target.checked)} /> Israel calendar</label>
              <label className="flex items-center gap-1.5" style={{ color: OUTLOOK_COLOR }}><input type="checkbox" checked={showOutlook} onChange={(e) => setShowOutlook(e.target.checked)} /> Outlook installs</label>
              <button type="button" className="underline" onClick={onReload}>Reload imports</button>
            </div>
          )}
          {user?.role === "admin" && monthExcluded.length > 0 && (
            <div className="pt-2 border-t" style={{ borderColor: C.border }}>
              <div className="font-medium mb-1">Source events needing ownership review ({monthExcluded.length})</div>
              {monthExcluded.sort((a, b) => a.event_date.localeCompare(b.event_date)).map((e, i) => (
                <div key={e.id || i} className="text-[11px] py-0.5">{e.event_date} · {e.job_name} · {e.source}</div>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}