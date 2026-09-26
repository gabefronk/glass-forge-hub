import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, RefreshCw, Search, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { PageShell, PageHero, HeroBar, heroBtn, heroPrimary, heroSecondary } from "@/components/PageShell";
import { C } from "@/lib/feeUI";
import { CATEGORY_KEYS, STATUS_CHIPS, canViewInboxAgents, categoryLabel, chipCounts, errorText, filterEntries, mailboxName, sortEntries, syncSummary } from "@/lib/inboxAgents";
import { inboxCall, btnBase, btnPrimary } from "@/components/inbox/inboxApi";
import MailboxChips from "@/components/inbox/MailboxChips";
import RelayRow from "@/components/inbox/RelayRow";

const LIST_LIMIT = 200;
const chip = "inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors";
const chipOn = { backgroundColor: C.accent, color: "#fff", border: "1px solid transparent" };
const chipOff = { backgroundColor: C.cardAlt, color: C.textSecondary, border: `1px solid ${C.border}` };
const field = { border: `1px solid ${C.border}`, color: C.text };

// Owner page under Admin: what the inbox agents did. Each row is a ledger entry (EmailRelay):
// the agent's read of one mail thread, the job it linked, and the notes / to-dos / job facts
// it pushed into the Hub. Nothing here shows or stores the mail itself — "Open in Gmail /
// Outlook" is how you read it.
export default function InboxAgents() {
  const { user } = useAuth();
  const canView = canViewInboxAgents(user);
  const [mailboxes, setMailboxes] = useState(null);
  const [mailbox, setMailbox] = useState("all");
  const [chipKey, setChipKey] = useState("open");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState([]);
  const [jobNames, setJobNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const seq = useRef(0);
  const boxesLoaded = useRef(false);

  useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(timer); }, [q]);

  // `mailboxes` (owner only) carries the live connector check; `list` (everyone) carries the
  // visible mailboxes without it. Merge by key so a list refresh never wipes `connected`.
  const loadMailboxes = async () => {
    try { const r = await inboxCall({ action: "mailboxes" }); setMailboxes((prev) => mergeMailboxes(prev, r.mailboxes)); }
    catch { /* managers cannot call it — the list response supplies their mailboxes */ }
    finally { boxesLoaded.current = true; }
  };

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!canView) { setLoading(false); return; }
    const mine = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const payload = { action: "list", limit: LIST_LIMIT };
      if (mailbox !== "all") payload.mailbox_key = mailbox;
      if (query) payload.q = query;
      const [list] = await Promise.all([inboxCall(payload), boxesLoaded.current ? Promise.resolve() : loadMailboxes()]);
      if (mine !== seq.current) return;
      setEntries(Array.isArray(list.entries) ? list.entries : []);
      if (Array.isArray(list.mailboxes)) setMailboxes((prev) => mergeMailboxes(prev, list.mailboxes));
      setError("");
    } catch (e) {
      if (mine === seq.current) { setError(errorText(e, "The ledger could not load. Reload to try again.")); if (!boxesLoaded.current) { boxesLoaded.current = true; setMailboxes([]); } }
    } finally { if (mine === seq.current) setLoading(false); }
  }, [mailbox, query, canView]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh({ quiet: true }); }, 60000);
    const focus = () => refresh({ quiet: true });
    window.addEventListener("focus", focus);
    return () => { seq.current++; clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);

  // Job names for the linked rows (the ledger stores ids only).
  useEffect(() => {
    const ids = [...new Set(entries.map((e) => e.job_id).filter((id) => id && !(id in jobNames)))];
    if (!ids.length) return undefined;
    let active = true;
    base44.entities.Jobs.filter({ id: { $in: ids.slice(0, 100) } }, "-created_date", 100)
      .then((rows) => { if (active) setJobNames((cur) => ({ ...cur, ...Object.fromEntries(ids.map((id) => [id, ""])), ...Object.fromEntries((rows || []).map((j) => [j.id, j.canonical_name || ""])) })); })
      .catch(() => { if (active) setJobNames((cur) => ({ ...cur, ...Object.fromEntries(ids.map((id) => [id, ""])) })); });
    return () => { active = false; };
  }, [entries, jobNames]);

  const clearFilters = () => { setChipKey("open"); setCategory(""); setQ(""); };

  // Optimistic patch, then the real call, then a quiet reload to settle on the server's view.
  const onAction = async (payload, patch = {}) => {
    const id = payload.id;
    setBusyId(id); setError(""); setNotice("");
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    try {
      const r = await inboxCall(payload);
      if (r?.entry?.id === id) setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, ...r.entry } : e)));
      if (r?.job?.name) setJobNames((cur) => ({ ...cur, [r.job.id]: r.job.name }));
      if (payload.action === "regenerate_draft") setNotice("A reply was drafted in the mailbox. Open it there to read, edit and send it.");
      if (r?.warning) setNotice(r.warning);
      await refresh({ quiet: true });
    } catch (e) { setError(errorText(e)); await refresh({ quiet: true }); }
    finally { setBusyId(""); }
  };

  const sync = async () => {
    setSyncing(true); setError(""); setNotice("");
    try {
      const r = await inboxCall(mailbox === "all" ? { action: "sync" } : { action: "sync", mailbox_key: mailbox });
      const lines = (r.mailboxes || []).map((m) => `${m.mailbox_key}: ${m.status}${syncSummary(m) ? ` — ${syncSummary(m)}` : ""}${m.error ? ` (${m.error})` : ""}`);
      setNotice(lines.length ? `Run finished. ${lines.join(" · ")}` : "Run finished.");
      await Promise.all([loadMailboxes().catch(() => {}), refresh({ quiet: true })]);
    } catch (e) { setError(errorText(e, "The run failed.")); }
    finally { setSyncing(false); }
  };

  const seed = async () => {
    setSeeding(true); setError("");
    try { await inboxCall({ action: "seed_mailboxes" }); await loadMailboxes(); setNotice("Mailboxes created. Authorize each one from the Base44 integrations page, then run the agents."); }
    catch (e) { setError(errorText(e, "Mailboxes could not be set up.")); }
    finally { setSeeding(false); }
  };

  const named = useMemo(() => entries.map((e) => (e.job_id && jobNames[e.job_id] ? { ...e, job_name: jobNames[e.job_id] } : e)), [entries, jobNames]);
  const scoped = useMemo(() => filterEntries(named, { chip: "all", mailboxKey: mailbox, q }), [named, mailbox, q]);
  const counts = useMemo(() => chipCounts(scoped), [scoped]);
  const visible = useMemo(() => sortEntries(filterEntries(scoped, { chip: chipKey, category })), [scoped, chipKey, category]);
  const providerOf = useMemo(() => Object.fromEntries((mailboxes || []).map((m) => [m.key, m.provider])), [mailboxes]);
  const selectedBoxes = (mailboxes || []).filter((m) => mailbox === "all" || m.key === mailbox);
  const unconnected = selectedBoxes.filter((m) => m.connected === false);
  const lastRun = mailbox !== "all" ? selectedBoxes[0]?.last_run : null;
  const filtersActive = chipKey !== "open" || category || q.trim();
  const emptyText = entries.length ? "No entries match these filters." : mailbox !== "all" && unconnected.length ? "Nothing here until this mailbox is connected." : "The agents have not filed anything yet. Run them once a mailbox is connected.";

  const hero = (
    <PageHero eyebrow="Admin · Inbox agents" title="Inbox agents" sub="One agent per mailbox. It files and drafts inside Gmail / Outlook and pushes the meaning into the Hub — job notes, to-dos, PO/OE numbers, homeowners. This is its ledger; the mail stays in the mailbox."
      actions={<>
        {mailboxes?.length ? <button type="button" className={`${heroBtn} disabled:opacity-50`} style={heroPrimary} disabled={syncing || loading} onClick={sync}><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Running…" : "Run now"}</button> : null}
        <button type="button" className={`${heroBtn} disabled:opacity-50`} style={heroSecondary} disabled={loading} onClick={() => refresh()}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} style={{ color: "#e0c994" }} />Refresh</button>
      </>}>
      {mailboxes?.length ? (
        <div className="flex flex-col gap-3">
          <MailboxChips mailboxes={mailboxes} value={mailbox} onChange={setMailbox} />
          {unconnected.length ? <HeroBar><span className="text-[12.5px] font-medium" style={{ color: "#e0c994" }}>{unconnected.map(mailboxName).join(" and ")} {unconnected.length === 1 ? "is" : "are"} not connected yet — authorize {unconnected.length === 1 ? "it" : "them"} from the Base44 integrations page.</span></HeroBar> : null}
          {lastRun && syncSummary(lastRun) ? <div className="text-[12px]" style={{ color: "#aeb5b7" }}>Last run: {syncSummary(lastRun)}{selectedBoxes[0]?.last_error ? <span style={{ color: "#e0c994" }}> · {selectedBoxes[0].last_error}</span> : null}</div> : null}
        </div>
      ) : null}
    </PageHero>
  );

  if (!canView) {
    return <PageShell>{hero}<section className="card-shadow rounded-[14px] bg-white p-5 text-[13.5px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>The inbox agents are an owner tool.</section></PageShell>;
  }

  return (
    <PageShell>
      {hero}
      {error ? <p role="alert" className="m-0 rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)", border: "1px solid var(--gf-error-border)" }}>{error}</p> : null}
      {notice ? <p role="status" className="m-0 rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: "var(--gf-teal-050)", color: C.accentText, border: `1px solid ${C.tagBillable.border}` }}>{notice}</p> : null}
      {loading && mailboxes === null ? <p role="status" className="p-8 text-center text-[13px]" style={{ color: C.textSecondary }}>Loading the ledger…</p> : null}
      {mailboxes && !mailboxes.length ? (
        <section className="card-shadow rounded-[14px] bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]" style={{ backgroundColor: "var(--gf-teal-600)", color: "#f2eee8" }}><Inbox className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h2 className="m-0 font-heading text-[16px] font-bold" style={{ color: C.text }}>No mailboxes yet</h2>
              <p className="m-0 mt-1 text-[13px] leading-[19px]" style={{ color: C.textSecondary }}>The agents watch the Gmail box and the Outlook box. Set up the mailbox records here, then authorize each one from the Base44 integrations page.</p>
              <button type="button" disabled={seeding} onClick={seed} className={`${btnBase} mt-3`} style={btnPrimary}>{seeding ? "Setting up…" : "Set up mailboxes"}</button>
            </div>
          </div>
        </section>
      ) : null}
      {mailboxes?.length ? (
        <>
          <section className="card-shadow flex flex-col gap-3 rounded-[14px] bg-white p-3" style={{ border: `1px solid ${C.border}` }} aria-label="Filters">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative flex min-w-0 flex-1 items-center">
                <Search className="pointer-events-none absolute left-3 h-4 w-4" style={{ color: C.textFaint }} />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, sender, job, PO" aria-label="Search the ledger" className="min-h-11 w-full rounded-[9px] bg-white pl-[38px] pr-9 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={field} />
                {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1 inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ color: C.textMuted }}><X className="h-3.5 w-3.5" /></button> : null}
              </label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="min-h-11 rounded-[9px] bg-white px-3 text-[13px] font-medium sm:w-[200px]" style={field}>
                <option value="">All categories</option>
                {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="View">
              {STATUS_CHIPS.map((s) => {
                const active = chipKey === s.key;
                return <button key={s.key} type="button" role="tab" aria-selected={active} onClick={() => setChipKey(s.key)} className={chip} style={active ? chipOn : chipOff}>{s.label}<span className="rounded-full px-1.5 text-[11px] tabular-nums" style={{ backgroundColor: active ? "rgba(255,255,255,.18)" : "#fff", color: active ? "#fff" : C.textMuted }}>{counts[s.key] ?? 0}</span></button>;
              })}
              {filtersActive ? <button type="button" onClick={clearFilters} className="ml-auto min-h-11 sm:min-h-9 text-[12.5px] font-semibold hover:underline" style={{ color: C.accentText }}>Clear filters</button> : null}
            </div>
          </section>
          <div className="flex flex-col gap-2.5">
            {visible.map((e) => <RelayRow key={e.id} entry={e} provider={providerOf[e.mailbox_key]} onAction={onAction} busy={busyId === e.id} />)}
            {loading && !visible.length ? <p role="status" className="p-6 text-center text-[13px]" style={{ color: C.textSecondary }}>Loading entries…</p> : null}
            {!loading && !visible.length ? (
              <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textSecondary }}>
                {emptyText}
                {filtersActive ? <div className="mt-3"><button type="button" onClick={clearFilters} className="min-h-10 rounded-full bg-white px-4 text-[13px] font-medium" style={{ color: C.accentText }}>Clear filters</button></div> : null}
              </div>
            ) : null}
            {entries.length >= LIST_LIMIT ? <p className="text-center text-[12px]" style={{ color: C.textFaint }}>Showing the newest {LIST_LIMIT} entries. Narrow with search or a mailbox to see older ones.</p> : null}
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
