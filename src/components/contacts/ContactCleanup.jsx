import { useCallback, useRef, useState } from "react";
import { Sparkles, RefreshCw, GitMerge, Building2, UserCheck } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { invokeErrorOf, ROLE_LABELS } from "@/lib/jobContacts";

const call = async (body) => {
  const r = await base44.functions.invoke("contacts-directory", body);
  if (r?.data?.error) throw Object.assign(new Error(r.data.error), { response: { data: r.data } });
  return r.data;
};
const TYPES = [
  { type: "merge", title: "Duplicate contacts", icon: GitMerge, empty: "No duplicates found." },
  { type: "builder", title: "Missing builder / company", icon: Building2, empty: "Every contact with evidence already has a builder." },
  { type: "role", title: "Missing role", icon: UserCheck, empty: "No role proposals right now." },
];
const btn = "min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50";

function Person({ c, strong }) {
  return (
    <div className="min-w-0">
      <p className={"break-words text-sm " + (strong ? "font-semibold" : "")}>{c.name}</p>
      <p className="break-words text-xs text-slate-500">{[c.company || c.builder, c.phone, c.email].filter(Boolean).join(" · ") || "No details"}</p>
    </div>
  );
}

function Item({ item, busy, onApply }) {
  const review = item.confidence !== "high";
  return (
    <li className="rounded-xl border border-slate-200 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          {item.type === "merge" ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Keep</p>
              <Person c={item.survivor} strong />
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Merge into it</p>
              {item.merge.map((m) => <Person key={m.key} c={m} />)}
              {(item.result.phones.length > 0 || item.result.emails.length > 0 || item.result.aliases.length > 0 || item.result.links > 0) && (
                <p className="text-xs text-slate-600">Kept on the surviving contact: {[
                  item.result.phones.length ? `${item.result.phones.length} extra phone${item.result.phones.length === 1 ? "" : "s"}` : "",
                  item.result.emails.length ? `${item.result.emails.length} extra email${item.result.emails.length === 1 ? "" : "s"}` : "",
                  item.result.aliases.length ? `also known as ${item.result.aliases.join(", ")}` : "",
                  item.result.links ? `${item.result.links} job link${item.result.links === 1 ? "" : "s"} moved` : "",
                ].filter(Boolean).join(" · ")}</p>
              )}
            </>
          ) : (
            <>
              <Person c={item.contact} strong />
              <p className="text-sm text-[var(--gf-teal-800)]">
                {item.type === "builder" ? <>Set builder to <strong>{item.builder}</strong>{item.company && item.company !== item.builder ? <> (company “{item.company}”)</> : null}</> : <>Set role to <strong>{ROLE_LABELS[item.role] || item.role}</strong></>}
              </p>
            </>
          )}
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">{item.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide " + (review ? "bg-amber-50 text-amber-800" : "bg-[var(--gf-teal-050)] text-[var(--gf-teal-700)]")}>{review ? "Check first" : "Confident"}</span>
          <button type="button" disabled={busy} onClick={() => onApply([item.id])} className={btn + " border border-[var(--gf-border)] bg-white text-[var(--gf-teal-600)]"}>
            {item.type === "merge" ? "Merge" : item.type === "builder" ? "Set builder" : "Set role"}
          </button>
        </div>
      </div>
    </li>
  );
}

// Owner-only cleanup: proposals are computed on the server and nothing changes until you click.
// Merges keep every phone, email and name on the surviving contact, move its job links, and
// mark the other record as merged (it is never deleted). The workbook itself is not edited.
export default function ContactCleanup({ onApplied }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const [result, setResult] = useState(null);
  const request = useRef(0);
  const load = useCallback(async () => {
    const n = ++request.current;
    setLoading(true); setError("");
    try { const r = await call({ action: "cleanup_plan" }); if (n === request.current) setData(r); }
    catch (e) { if (n === request.current) { const { message } = invokeErrorOf(e); setError(/unsupported action/i.test(message) ? "Cleanup appears once the updated contacts function is published." : message || "Cleanup could not be loaded."); } }
    finally { if (n === request.current) setLoading(false); }
  }, []);
  const apply = async (ids) => {
    setBusy(true); setError(""); setResult(null);
    try {
      const r = await call({ action: "cleanup_apply", ids });
      setResult(r); setConfirmAll(false);
      await load();
      if (r.applied?.length) onApplied?.();
    } catch (e) { setError(invokeErrorOf(e).message || "Cleanup could not be applied."); }
    finally { setBusy(false); }
  };
  const items = data?.items || [];
  const confident = items.filter((i) => i.confidence === "high");
  const s = data?.summary;
  return (
    <details className="card-shadow rounded-[14px] border border-[#d3cabb] bg-white p-4" onToggle={(e) => { if (e.currentTarget.open && !data && !loading) load(); }}>
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4" />Clean up contacts{s ? ` (${items.length} to review)` : ""}</summary>
      <div className="mt-3 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="max-w-3xl text-sm text-slate-600">Duplicates (same phone, same email, or the same name at the same builder), contacts missing a builder, and contacts missing a role. Nothing changes until you click. Merging keeps every phone, email and name on the contact you keep and moves its job links; the other record is marked merged, not deleted.</p>
          <button type="button" disabled={loading || busy} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm" onClick={load}><RefreshCw className="h-4 w-4" />{loading ? "Checking…" : "Re-check"}</button>
        </div>
        {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        {result && <p role="status" className="rounded-xl border bg-slate-50 p-3 text-sm">Applied {result.applied?.length || 0}.{result.skipped?.length ? ` ${result.skipped.length} skipped (already changed; re-checked below).` : ""}{result.failed?.length ? ` ${result.failed.length} failed: ${result.failed.map((f) => f.error).join("; ")}` : ""}</p>}
        {s && (
          <div className="grid gap-2 sm:grid-cols-4">
            <p className="rounded-xl bg-slate-50 p-3 text-sm"><strong className="block text-2xl">{s.contacts}</strong>active contacts{s.merged ? ` · ${s.merged} merged` : ""}</p>
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong className="block text-2xl">{s.duplicate_groups}</strong>possible duplicates</p>
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong className="block text-2xl">{s.missing_builder}</strong>missing a builder</p>
            <p className="rounded-xl bg-slate-50 p-3 text-sm"><strong className="block text-2xl">{s.unlinked}</strong>not linked to any job</p>
          </div>
        )}
        {data?.builder_variants?.length > 0 && (
          <details className="rounded-xl border p-3 text-sm">
            <summary className="min-h-9 cursor-pointer">Builder names grouped automatically ({data.builder_variants.length})</summary>
            <p className="mt-2 text-xs text-slate-500">These spellings are treated as one builder everywhere (contacts, job pages, filters). Your workbook is unchanged.</p>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">{data.builder_variants.map((b) => <li key={b.name}><strong>{b.name}</strong><span className="text-slate-500"> ← {b.variants.filter((v) => v !== b.name).join(", ")}</span></li>)}</ul>
          </details>
        )}
        {confident.length > 0 && (
          <div className="rounded-xl border border-[var(--gf-border)] bg-[var(--gf-teal-050)] p-3 text-sm text-[var(--gf-teal-800)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><strong>{confident.length} confident fix{confident.length === 1 ? "" : "es"}</strong><p className="text-xs text-[var(--gf-teal-600)]">Items marked “Check first” are never included.</p></div>
              <button type="button" disabled={busy} className={btn + " border border-[var(--gf-border)] bg-white"} onClick={() => setConfirmAll((v) => !v)}>Apply all confident</button>
            </div>
            {confirmAll && (
              <div className="mt-3">
                <ul className="list-disc space-y-1 pl-5">{confident.map((i) => <li key={i.id}>{i.type === "merge" ? `Merge ${i.merge.map((m) => m.name).join(", ")} into ${i.survivor.name}` : i.type === "builder" ? `${i.contact.name}: builder ${i.builder}` : `${i.contact.name}: ${ROLE_LABELS[i.role] || i.role}`}</li>)}</ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => apply(confident.map((i) => i.id))} className={btn + " bg-[var(--gf-teal-600)] text-white hover:bg-[var(--gf-teal-700)]"}>{busy ? "Applying…" : `Apply ${confident.length}`}</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmAll(false)} className="min-h-11 px-3 underline">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}
        {data && TYPES.map(({ type, title, icon: Icon, empty }) => {
          const list = items.filter((i) => i.type === type);
          return (
            <section key={type} aria-label={title}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4" />{title} ({list.length})</h3>
              {list.length ? <ul className="space-y-2">{list.map((i) => <Item key={i.id} item={i} busy={busy} onApply={apply} />)}</ul> : <p className="text-sm text-slate-500">{empty}</p>}
            </section>
          );
        })}
      </div>
    </details>
  );
}
