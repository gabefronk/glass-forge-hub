import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ExternalLink, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";

// Crew-facing "Needs your confirmation" list on the Invoicing page.
// Shows only lines Gabriel sent for review. Crew sees job, description, notes and
// a labor field — never fee %, fee amounts, margins or owner-only pricing. Confirm
// sends the entered labor back through the feeLineReview backend function, which
// clears the flag and returns the line to Gabriel as Needs review.

export default function NeedsConfirmationList() {
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [laborBy, setLaborBy] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [confirmError, setConfirmError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await base44.functions.invoke("feeLineReview", { action: "list" });
      const data = res?.data || {};
      if (data.error) { setError(data.error); return; }
      const list = Array.isArray(data.items) ? data.items : [];
      setItems(list);
      const init = {};
      for (const it of list) init[it.id] = it.labor_amt ?? "";
      setLaborBy(init);
    } catch (e) { setError(e?.response?.data?.error || e?.message || "Could not load lines."); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const confirm = async (id) => {
    const labor = Number(laborBy[id]);
    if (!Number.isFinite(labor) || labor < 0) { setConfirmError("Enter a valid labor amount."); return; }
    setBusyId(id); setConfirmError("");
    try {
      const res = await base44.functions.invoke("feeLineReview", { action: "confirm", id, labor_amt: labor });
      const data = res?.data || {};
      if (data.error) { setConfirmError(data.error); return; }
      setItems((prev) => (prev || []).filter((it) => it.id !== id));
    } catch (e) { setConfirmError(e?.response?.data?.error || e?.message || "Could not confirm."); }
    finally { setBusyId(null); }
  };

  return (
    <div className="mx-auto min-w-0 max-w-[860px] px-5 sm:px-6 lg:px-8" style={{ paddingBottom: "60px" }}>
      <div className="mt-5 rounded-[14px] px-6 py-5" style={{ background: "linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)", boxShadow: "0 20px 44px -26px rgba(10,29,31,.7)" }}>
        <h1 className="m-0 text-[26px] font-bold" style={{ color: "#f2eee8", letterSpacing: "-0.03em" }}>Needs your confirmation</h1>
        <p className="mt-1 text-[14px]" style={{ color: "#c9d0d1" }}>Gabriel sent these lines for you to confirm the labor. Enter the labor and confirm — it goes back to him for review.</p>
      </div>

      {error && <p className="mt-4 text-[14px] font-medium" style={{ color: "#A43432" }}>{error}</p>}

      {loading ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-[14px]" style={{ color: "var(--gf-ink-3)" }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !items || items.length === 0 ? (
        <div className="mt-10 text-center text-[15px]" style={{ color: "var(--gf-ink-3)" }}>Nothing waiting for you right now.</div>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {items.map((it) => (
            <div key={it.id} className="rounded-[12px] p-4" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)", boxShadow: "var(--shadow-row)" }}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold truncate" style={{ color: "var(--gf-ink)" }}>{it.job_name || "Job"}</div>
                  <div className="text-[12px] mt-0.5" style={{ color: "var(--gf-ink-3)" }}>
                    {it.job_date || ""}
                    {it.sent_for_review_by ? ` · sent by ${it.sent_for_review_by}` : ""}
                  </div>
                </div>
                {it.job_id && (
                  <button onClick={() => navigate(`/jobs/${it.job_id}`)} className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--gf-teal-600)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                    <ExternalLink className="h-3.5 w-3.5" /> Job
                  </button>
                )}
              </div>
              {it.line_description && <div className="mt-2 text-[13.5px]" style={{ color: "var(--gf-ink)" }}>{it.line_description}</div>}
              <div className="mt-2 rounded-lg p-2.5" style={{ border: "1px solid var(--gf-hairline)", backgroundColor: "var(--gf-card-band)" }}>
                <div className="text-[11px] font-semibold uppercase mb-1" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>Notes</div>
                <div className="text-[13px]" style={{ color: "var(--gf-ink)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {it.calendar_note_text || it.note_text || <span style={{ color: "var(--gf-ink-3)" }}>None on file</span>}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-[12px] font-medium" style={{ color: "var(--gf-ink-2)" }}>
                  Labor $
                  <input
                    type="number"
                    inputMode="decimal"
                    value={laborBy[it.id] ?? ""}
                    onChange={(e) => setLaborBy((p) => ({ ...p, [it.id]: e.target.value }))}
                    className="min-h-10 rounded-lg px-3 text-[14px]"
                    style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)", color: "var(--gf-ink)", outline: "none", width: "160px" }}
                  />
                </label>
                <button
                  onClick={() => confirm(it.id)}
                  disabled={busyId === it.id}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-4 text-[13px] font-semibold disabled:opacity-50"
                  style={{ border: "1px solid var(--gf-teal-700)", backgroundColor: "var(--gf-teal-600)", color: "#FFFFFF", cursor: busyId === it.id ? "wait" : "pointer" }}
                >
                  {busyId === it.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Confirm
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmError && <p className="mt-3 text-[13px] font-medium" style={{ color: "#A43432" }}>{confirmError}</p>}
    </div>
  );
}