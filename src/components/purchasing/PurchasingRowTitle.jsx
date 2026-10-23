import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { renameJob } from "@/lib/jobRename";

const INK = "#101617", SUB = "#566063", LINE = "#E2E8F0";

// Row title: the builder first, then the job name ("Perry - Perry Res").
// Jobs with no builder on file keep the plain job name.
export function rowTitle(job) {
  const name = job?.canonical_name || "Unnamed job";
  const builder = String(job?.builder || "").trim();
  return builder ? `${builder} - ${name}` : name;
}

const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// Click the job name (or right-click it) to correct the builder or the job name
// in place. Enter saves, Escape cancels. A renamed job keeps its old name as an alias (renameJob), so
// past visits and files still match it - which is why the full record is read
// before saving instead of patching the trimmed card record.
export default function PurchasingRowTitle({ job, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [builder, setBuilder] = useState("");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setEditing(false); setError(""); }, [job?.id]);

  const start = () => {
    setBuilder(String(job.builder || ""));
    setName(job.canonical_name || "");
    setError("");
    setEditing(true);
  };

  const save = async () => {
    if (saving) return;
    const nextName = clean(name);
    const nextBuilder = clean(builder);
    if (!nextName) { setError("Give the job a name."); return; }
    setSaving(true); setError("");
    try {
      const full = await base44.entities.Jobs.get(job.id);
      if (nextName !== clean(full.canonical_name)) await renameJob(full, nextName);
      if (nextBuilder !== clean(full.builder)) await base44.entities.Jobs.update(job.id, { builder: nextBuilder });
      setEditing(false);
      await onSaved?.();
    } catch (e) {
      setError(e?.message || "Could not save the title.");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button type="button" onClick={start} onContextMenu={(e) => { e.preventDefault(); start(); }}
        aria-label={`Edit builder and job name: ${rowTitle(job)}`} title="Click to edit the builder and job name"
        className="-ml-1 inline-flex max-w-full rounded-[8px] border px-2 py-1 text-left hover:border-[#8FB3AB] hover:bg-[#E9F2EF]"
        style={{ borderColor: '#BFD3CD', backgroundColor: '#F1F6F4' }}>
        <span className="break-words text-[14px] font-extrabold leading-tight" style={{ color: INK }}>{rowTitle(job)}</span>
      </button>
    );
  }

  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") setEditing(false);
  };
  const input = "min-w-0 rounded-[7px] border px-2 py-1 text-[12.5px] font-semibold outline-none";
  const inputStyle = { borderColor: LINE, color: INK, backgroundColor: "#FFFFFF" };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input autoFocus aria-label="Builder" value={builder} placeholder="Builder"
        onChange={(e) => setBuilder(e.target.value)} onKeyDown={onKey}
        className={input} style={{ ...inputStyle, maxWidth: 200 }} />
      <span className="text-[12px] font-bold" style={{ color: SUB }}>-</span>
      <input aria-label="Job name" value={name} placeholder="Job name"
        onChange={(e) => setName(e.target.value)} onKeyDown={onKey}
        className={input} style={{ ...inputStyle, maxWidth: 320 }} />
      <button type="button" onClick={save} disabled={saving}
        className="inline-flex h-7 items-center rounded-[7px] px-2.5 text-[12px] font-semibold disabled:opacity-60"
        style={{ backgroundColor: "#0b3f3b", color: "#FFFFFF" }}>{saving ? "Saving…" : "Save"}</button>
      <button type="button" onClick={() => setEditing(false)}
        className="inline-flex h-7 items-center rounded-[7px] px-2.5 text-[12px] font-semibold"
        style={{ backgroundColor: "#F0F1ED", color: INK }}>Cancel</button>
      {error ? <span role="alert" className="text-[11.5px] font-semibold" style={{ color: "#A43432" }}>{error}</span> : null}
    </div>
  );
}