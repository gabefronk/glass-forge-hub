import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Inbox, RefreshCw, Search, X } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { PageShell, PageHero, HeroBar, heroBtn, heroPrimary, heroSecondary, heroField } from "@/components/PageShell";
import { C } from "@/lib/feeUI";
import { CATEGORY_KEYS, STATUS_CHIPS, categoryLabel, errorText, filterThreads, mailboxName, sortThreads, statusCounts, syncSummary } from "@/lib/emailInbox";
import { emailCall, btnBase, btnPrimary } from "@/components/email/emailApi";
import MailboxChips from "@/components/email/MailboxChips";
import ThreadRow from "@/components/email/ThreadRow";

const LIST_LIMIT = 300;
const chip = "inline-flex min-h-11 sm:min-h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors";
const canViewEmail = (user) => user?.role === "admin" || user?.role === "manager";

export default function EmailInbox() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const canView = canViewEmail(user);
  const [searchParams, setSearchParams] = useSearchParams();
  const wanted = searchParams.get("thread") || "";
  const [mailboxes, setMailboxes] = useState(null);
  const [mailbox, setMailbox] = useState("all");
  const [status, setStatus] = useState(wanted ? "all" : "open");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState([]);
  const [pinned, setPinned] = useState(null);
  const [expandedId, setExpandedId] = useState(wanted);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const seq = useRef(0);
  const wantedRef = useRef(null);
  const scrolled = useRef(false);

  useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(timer); }, [q]);

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!canView) { setLoading(false); return; }
    const mine = ++seq.current;
    if (!quiet) setLoading(true);
    try {
      const payload = { action: "list", limit: LIST_LIMIT };
      if (mailbox !== "all") payload.mailbox_key = mailbox;
      if (query) payload.q = query;
      const [list, boxes] = await Promise.all([emailCall(payload), mailboxes === null ? emailCall({ action: "mailboxes" }).catch(() => null) : Promise.resolve(null)]);
      if (mine !== seq.current) return;
      setThreads(Array.isArray(list.threads) ? list.threads : []);
      if (Array.isArray(list.mailboxes)) setMailboxes(list.mailboxes);
      else if (boxes && Array.isArray(boxes.mailboxes)) setMailboxes(boxes.mailboxes);
      else if (mailboxes === null) setMailboxes([]);
      setError("");
    } catch (e) {
      if (mine === seq.current) { setError(errorText(e, "Email could not load. Reload to try again.")); if (mailboxes === null) setMailboxes([]); }
    } finally { if (mine === seq.current) setLoading(false); }
  }, [mailbox, query, canView, mailboxes === null]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh({ quiet: true }); }, 60000);
    const focus = () => refresh({ quiet: true });
    window.addEventListener("focus", focus);
    return () => { seq.current++; clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);

  // /email?thread=<id>: expand that thread even when it is outside the current list.
  useEffect(() => {
    if (!wanted || loading || pinned?.id === wanted) return;
    if (threads.some((t) => t.id === wanted)) { setPinned(null); return; }
    let active = true;
    emailCall({ action: "thread", id: wanted }).then((r) => { if (active && r.thread) setPinned(r.thread); }).catch(() => {});
    return () => { active = false; };
  }, [wanted, loading, threads]);
  useEffect(() => {
    if (scrolled.current || !expandedId || !wantedRef.current) return;
    scrolled.current = true;
    wantedRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  const toggle = (id) => {
    const next = expandedId === id ? "" : id;
    setExpandedId(next);
    const p = new URLSearchParams(searchParams);
    if (next) p.set("thread", next); else p.delete("thread");
    setSearchParams(p, { replace: true });
  };

  // Optimistic patch, then the real call, then a quiet reload to settle on the server's view.
  const onAction = async (payload, patch = {}) => {
    const id = payload.id;
    setBusyId(id); setError(""); setNotice("");
    const apply = (t) => (t.id === id ? { ...t, ...patch } : t);
    setThreads((cur) => cur.map(apply));
    setPinned((p) => (p ? apply(p) : p));
    try {
      const r = await emailCall(payload);
      if (r?.thread?.id === id) { setThreads((cur) => cur.map((t) => (t.id === id ? { ...t, ...r.thread } : t))); setPinned((p) => (p?.id === id ? { ...p, ...r.thread } : p)); }
      if (payload.action === "send_draft") setNotice("Reply sent.");
      else if (payload.action === "regenerate_draft") setNotice("A new draft is being written. It shows up here when the agent finishes.");
      await refresh({ quiet: true });
    } catch (e) { setError(errorText(e)); await refresh({ quiet: true }); }
    finally { setBusyId(""); }
  };

  const sync = async () => {
    setSyncing(true); setError(""); setNotice("");
    try {
      const r = await emailCall(mailbox === "all" ? { action: "sync" } : { action: "sync", mailbox_key: mailbox });
      const summary = syncSummary(r.last_run || r.run || r);
      setNotice(summary ? `Sync finished: ${summary}.` : "Sync finished.");
      setMailboxes(null);
      await refresh({ quiet: true });
    } catch (e) { setError(errorText(e, "Sync failed.")); }
    finally { setSyncing(false); }
  };

  const seed = async () => {
    setSeeding(true); setError("");
    try { await emailCall({ action: "seed_mailboxes" }); const r = await emailCall({ action: "mailboxes" }); setMailboxes(r.mailboxes || []); setNotice("Mailboxes created. Authorize each one from the Base44 integrations page, then sync."); }
    catch (e) { setError(errorText(e, "Mailboxes could not be set up.")); }
    finally { setSeeding(false); }
  };

  const scoped = useMemo(() => filterThreads(threads, { status: "all", mailboxKey: mailbox, q }), [threads, mailbox, q]);
  const counts = useMemo(() => statusCounts(scoped), [scoped]);
  const visible = useMemo(() => {
    const rows = sortThreads(filterThreads(scoped, { status, category }));
    return pinned && !rows.some((t) => t.id === pinned.id) ? [pinned, ...rows] : rows;
  }, [scoped, status, category, pinned]);
  const providerOf = useMemo(() => Object.fromEntries((mailboxes || []).map((m) => [m.key, m.provider])), [mailboxes]);
  const selectedBoxes = (mailboxes || []).filter((m) => mailbox === "all" || m.key === mailbox);
  const unconnected = selectedBoxes.filter((m) => !m.connected);
  const lastRun = mailbox !== "all" ? selectedBoxes[0]?.last_run : null;
  const filtersActive = status !== "open" || category || q.trim();

  const hero = (
    <PageHero eyebrow="Glass Forge · Inbox agents" title="Email" sub="Both mailboxes, read by the agents: each thread sorted, summarized, linked to its job and answered with a draft for you to approve."
      actions={<>
        {isAdmin && mailboxes?.length ? <button type="button" className={`${heroBtn} disabled:opacity-50`} style={heroPrimary} disabled={syncing || loading} onClick={sync}><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Syncing…" : "Sync now"}</button> : null}
        <button type="button" className={`${heroBtn} disabled:opacity-50`} style={heroSecondary} disabled={loading} onClick={() => refresh()}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} style={{ color: "#e0c994" }} />Refresh</button>
      </>}>
      {mailboxes?.length ? (
        <div className="flex flex-col gap-3">
          <MailboxChips mailboxes={mailboxes} value={mailbox} onChange={(k) => { setMailbox(k); setExpandedId(""); }} />
          {unconnected.length ? <HeroBar><span className="text-[12.5px] font-medium" style={{ color: "#e0c994" }}>{unconnected.map(mailboxName).join(" and ")} {unconnected.length === 1 ? "is" : "are"} not connected yet — authorize {unconnected.length === 1 ? "it" : "them"} from the Base44 integrations page.</span></HeroBar> : null}
          {lastRun && syncSummary(lastRun) ? <div className="text-[12px]" style={{ color: "#aeb5b7" }}>Last run: {syncSummary(lastRun)}{selectedBoxes[0]?.last_error ? <span style={{ color: "#e0c994" }}> · {selectedBoxes[0].last_error}</span> : null}</div> : null}
        </div>
      ) : null}
    </PageHero>
  );

  if (!canView) {
    return <PageShell>{hero}<section className="card-shadow rounded-[14px] bg-white p-5 text-[13.5px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Email is available to admins and managers. Ask Gabe if you need access.</section></PageShell>;
  }

  return (
    <PageShell>
      {hero}
      {error ? <p role="alert" className="rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: "var(--gf-error-bg)", color: "var(--gf-error)", border: "1px solid var(--gf-error-border)" }}>{error}</p> : null}
      {notice ? <p role="status" className="rounded-[12px] p-3.5 text-[13px]" style={{ backgroundColor: "var(--gf-teal-050)", color: C.accentText, border: `1px solid ${C.tagBillable.border}` }}>{notice}</p> : null}
      {loading && mailboxes === null ? <p role="status" className="p-8 text-center text-[13px]" style={{ color: C.textSecondary }}>Loading your inbox…</p> : null}
      {mailboxes && !mailboxes.length ? (
        <section className="card-shadow rounded-[14px] bg-white p-5" style={{ border: `1px solid ${C.border}` }}>
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px]" style={{ backgroundColor: "var(--gf-teal-600)", color: "#f2eee8" }}><Inbox className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h2 className="m-0 font-heading text-[16px] font-bold" style={{ color: C.text }}>No mailboxes yet</h2>
              <p className="m-0 mt-1 text-[13px] leading-[19px]" style={{ color: C.textSecondary }}>The inbox agents watch two accounts: the Gmail box and the Outlook box. Both sign-ins are still pending. Set up the mailbox records here, then authorize each one from the Base44 integrations page.</p>
              {isAdmin ? <button type="button" disabled={seeding} onClick={seed} className={`${btnBase} mt-3`} style={btnPrimary}>{seeding ? "Setting up…" : "Set up mailboxes"}</button> : <p className="m-0 mt-2 text-[12px]" style={{ color: C.textFaint }}>An admin has to set them up.</p>}
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
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search subject, sender, job" aria-label="Search email" className="min-h-11 w-full rounded-[9px] bg-white pl-[38px] pr-9 text-[14px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gf-teal-500)]" style={{ border: `1px solid ${C.border}`, color: C.text }} />
                {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-1 inline-flex h-9 w-9 items-center justify-center rounded-full" style={{ color: C.textMuted }}><X className="h-3.5 w-3.5" /></button> : null}
              </label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" className="min-h-11 rounded-[9px] bg-white px-3 text-[13px] font-medium sm:w-[200px]" style={{ border: `1px solid ${C.border}`, color: C.text }}>
                <option value="">All categories</option>
                {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{categoryLabel(k)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Status">
              {STATUS_CHIPS.map((s) => {
                const active = status === s.key;
                return <button key={s.key} type="button" role="tab" aria-selected={active} onClick={() => setStatus(s.key)} className={chip} style={active ? { backgroundColor: C.accent, color: "#fff", border: "1px solid transparent" } : { backgroundColor: C.cardAlt, color: C.textSecondary, border: `1px solid ${C.border}` }}>{s.label}<span className="rounded-full px-1.5 text-[11px] tabular-nums" style={{ backgroundColor: active ? "rgba(255,255,255,.18)" : "#fff", color: active ? "#fff" : C.textMuted }}>{counts[s.key] ?? 0}</span></button>;
              })}
              {status === "all" ? <span className={chip} style={{ backgroundColor: C.accent, color: "#fff" }}>All<span className="rounded-full px-1.5 text-[11px] tabular-nums" style={{ backgroundColor: "rgba(255,255,255,.18)" }}>{counts.all}</span></span> : null}
              {filtersActive ? <button type="button" onClick={() => { setStatus("open"); setCategory(""); setQ(""); }} className="ml-auto min-h-11 sm:min-h-9 text-[12.5px] font-semibold hover:underline" style={{ color: C.accentText }}>Clear filters</button> : null}
            </div>
          </section>
          {heroHint(threads, loading)}
          <div className="flex flex-col gap-2.5">
            {visible.map((t) => <ThreadRow key={t.id} thread={t} provider={providerOf[t.mailbox_key]} expanded={expandedId === t.id} onToggle={() => toggle(t.id)} onAction={onAction} busy={busyId === t.id} isAdmin={isAdmin} rowRef={t.id === wanted ? wantedRef : undefined} />)}
            {!loading && !visible.length ? (
              <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textSecondary }}>
                {threads.length ? "No threads match these filters." : mailbox !== "all" && unconnected.length ? "Nothing here until this mailbox is connected." : "Nothing in the inbox yet. Run a sync once a mailbox is connected."}
                {filtersActive ? <div className="mt-3"><button type="button" onClick={() => { setStatus("open"); setCategory(""); setQ(""); }} className="min-h-10 rounded-full bg-white px-4 text-[13px] font-medium" style={{ color: C.accentText }}>Clear filters</button></div> : null}
              </div>
            ) : null}
            {threads.length >= LIST_LIMIT ? <p className="text-center text-[12px]" style={{ color: C.textFaint }}>Showing the newest {LIST_LIMIT} threads. Narrow with search or a mailbox to see older ones.</p> : null}
          </div>
        </>
      ) : null}
    </PageShell>
  );
}

function heroHint(threads, loading) {
  if (loading && !threads.length) return <p role="status" className="p-6 text-center text-[13px]" style={{ color: C.textSecondary }}>Loading threads…</p>;
  return null;
}
