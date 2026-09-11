import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, ListChecks, Loader2, Plus, Search, X } from "lucide-react";
import { Link } from "react-router-dom";
import { filterQuoteRows, quoteListRow } from "./quoteListModel";

const control = "h-11 rounded border border-[#AAB2BE] bg-white px-3 text-base sm:text-sm text-[#203B64] outline-none focus:border-[#213D73] focus:ring-2 focus:ring-[#213D73]/20";
const action = "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#AAB2BE] bg-white text-[#364B66] hover:border-[#213D73] hover:bg-[#EDF3FA] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#213D73]";
const columns = [["created", "Created"], ["number", "Number"], ["name", "Name"], ["client", "Client / Yard"], ["status", "Status"], ["units", "Units"], ["total", "Quote Total"]];

export default function WindowQuoteList({ quotes, loading, failed, onOpen, onNew, statusLabel, renderStatus }) {
  const [search, setSearch] = useState("");
  const [field, setField] = useState("all");
  const [status, setStatus] = useState("all");
  const [sorting, setSorting] = useState({ sort: "created", direction: "desc" });
  const rows = useMemo(() => quotes.map(quote => quoteListRow(quote, statusLabel(quote))), [quotes, statusLabel]);
  const visible = useMemo(() => filterQuoteRows(rows, { search, field, status, ...sorting }), [rows, search, field, status, sorting]);
  const filtered = search.trim() || status !== "all";
  const changeSort = key => setSorting(previous => ({ sort: key, direction: previous.sort === key && previous.direction === "asc" ? "desc" : "asc" }));
  const reset = () => { setSearch(""); setStatus("all"); };

  return <section aria-label="My quotes" className="min-w-0 rounded-md border border-[#DDE3EC] bg-white px-4 pb-2 pt-5 sm:px-6">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <label className="sr-only" htmlFor="quote-list-status">Quote status</label>
        <select id="quote-list-status" className={control} value={status} onChange={event => setStatus(event.target.value)}>
          <option value="all">All quotes</option><option value="open">Open quotes</option><option value="draft">Drafts</option><option value="ready">Ready</option><option value="won">Won</option><option value="attention">Needs attention</option>
        </select>
        <span aria-live="polite" className="whitespace-nowrap text-sm text-[#687385]">{visible.length} {visible.length === 1 ? "quote" : "quotes"}{filtered ? ` of ${rows.length}` : ""}</span>
      </div>
      <div role="search" aria-label="Search quotes" className="flex w-full flex-wrap gap-2 lg:w-auto">
        <div className="flex min-w-0 flex-1 lg:w-[500px]">
          <label className="sr-only" htmlFor="quote-list-field">Search by</label>
          <select id="quote-list-field" className={control + " w-[120px] shrink-0 rounded-r-none border-r-0 sm:w-[140px]"} value={field} onChange={event => setField(event.target.value)}>
            <option value="all">All fields</option><option value="number">Number</option><option value="name">Name</option><option value="client">Client / Yard</option>
          </select>
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" size={16} className="pointer-events-none absolute left-3 top-3.5 text-[#7A8596]" />
            <input id="quote-list-search" aria-label="Search quotes" className={control + " w-full rounded-l-none pl-9 pr-10"} placeholder={field === "all" ? "Search quotes" : `Search by ${field === "client" ? "client or yard" : field}`} value={search} onChange={event => setSearch(event.target.value)} />
            {search && <button type="button" aria-label="Clear search" className="absolute right-1 top-1 inline-flex h-9 w-9 items-center justify-center rounded text-[#687385] hover:bg-[#EDF3FA]" onClick={() => setSearch("")}><X size={16} /></button>}
          </div>
        </div>
        <button type="button" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded sm:w-auto bg-[#20386E] px-4 text-sm font-semibold text-white hover:bg-[#172A53]" onClick={onNew}><Plus size={18} />New quote</button>
      </div>
    </div>
    <div className="md:hidden">
      {loading ? <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#687385]"><Loader2 size={18} className="animate-spin" />Loading quotes…</div> : visible.map(row => <article key={row.id} className="border-t border-[#C8CED7] py-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[#687385]">
          <span>{row.number ? `Quote ${row.number}` : "Quote"}</span>
          {row.created > 0 && <time dateTime={new Date(row.created).toISOString()}>{new Date(row.created).toLocaleDateString("en-US")}</time>}
        </div>
        <h2><button className="min-h-11 w-full break-words py-1 text-left text-base font-semibold leading-relaxed text-[#203B64] [overflow-wrap:anywhere] hover:underline" onClick={() => onOpen(row.id)}>{row.name}</button></h2>
        {row.client && <p className="mt-1 break-words text-sm leading-relaxed text-[#687385]">{row.client}</p>}
        <div className="my-3 flex flex-wrap items-center justify-between gap-3">
          {renderStatus(row.quote)}
          <div className="text-right"><div className="text-xs text-[#687385]">Quote total</div><div className="text-base font-semibold tabular-nums text-[#203B64]">{row.total == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: row.currency }).format(row.total)}</div></div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-[#687385]">{row.units} {row.units === 1 ? "unit" : "units"} · {row.lines} {row.lines === 1 ? "line" : "lines"}</span>
          <div className="flex gap-2">
            <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded border border-[#AAB2BE] px-3 text-sm font-medium text-[#203B64] hover:bg-[#EDF3FA]" aria-label={`View quote: ${row.name}`} onClick={() => onOpen(row.id)}><ListChecks size={17} />View quote</button>
            {row.quote.job_id && <Link className={action + " min-h-11 min-w-11"} to={`/jobs/${encodeURIComponent(row.quote.job_id)}`} aria-label={`Open linked job: ${row.name}`}><ArrowUpRight size={18} /></Link>}
          </div>
        </div>
      </article>)}
      {!loading && !visible.length && <div className="border-t border-[#C8CED7] py-12 text-center text-sm text-[#687385]">{failed ? "Quotes couldn’t be loaded. Use Refresh below to try again." : filtered ? <><p>No quotes match these filters.</p><button className="mt-2 min-h-11 font-medium text-[#20386E]" onClick={reset}>Clear filters</button></> : <><p>No quotes yet.</p><button className="mt-2 min-h-11 font-medium text-[#20386E]" onClick={onNew}>Create your first quote</button></>}</div>}
    </div>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
        <caption className="sr-only">Saved window quotes. Select a quote name or its view button to open the schedule.</caption>
        <thead>
          <tr className="border-b border-[#9CA6B2] text-[#17243A]">
            <th scope="col" className="w-14 px-2 py-3"><span className="sr-only">Open quote</span></th>
            {columns.map(([key, label]) => <th key={key} scope="col" aria-sort={sorting.sort === key ? sorting.direction === "asc" ? "ascending" : "descending" : "none"} className={`px-3 py-3 font-semibold ${["units", "total"].includes(key) ? "text-right" : ""}`}>
              <button className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-[#2A5EA8] ${["units", "total"].includes(key) ? "justify-end" : ""}`} onClick={() => changeSort(key)}>{label}{sorting.sort === key ? sorting.direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} /> : <ArrowUpDown size={13} className="text-[#AAB2BE]" />}</button>
            </th>)}
            <th scope="col" className="w-28 px-2 py-3 text-right"><span className="sr-only">Quote actions</span></th>
          </tr>
        </thead>
        <tbody>
          {loading ? <tr><td colSpan={9} className="py-16 text-center text-[#687385]"><span className="inline-flex items-center gap-2"><Loader2 size={18} className="animate-spin" />Loading quotes…</span></td></tr> :
            visible.map(row => <tr key={row.id} className="border-b border-[#C8CED7] align-top text-[#203B64] transition-colors last:border-b-0 hover:bg-[#F7F9FC]">
              <td className="px-2 py-4"><button className={action} title="View quote" aria-label={`View quote: ${row.name}`} onClick={() => onOpen(row.id)}><Search size={17} /></button></td>
              <td className="whitespace-nowrap px-3 py-5 tabular-nums">{row.created ? <time dateTime={new Date(row.created).toISOString()}>{new Date(row.created).toLocaleDateString("en-US")}</time> : "—"}</td>
              <td className="whitespace-nowrap px-3 py-5 tabular-nums">{row.number ? <button className="text-left hover:underline" onClick={() => onOpen(row.id)}>{row.number}</button> : <span className="text-[#939CAA]">—</span>}</td>
              <td className="w-[30%] min-w-[240px] px-3 py-5"><button className="break-words text-left font-medium leading-relaxed hover:underline" onClick={() => onOpen(row.id)}>{row.name}</button></td>
              <td className="min-w-[150px] px-3 py-5 leading-relaxed">{row.client || <span className="text-[#939CAA]">—</span>}</td>
              <td className="px-3 py-5">{renderStatus(row.quote)}</td>
              <td className="px-3 py-5 text-right tabular-nums">{row.units || "—"}</td>
              <td className="whitespace-nowrap px-3 py-5 text-right tabular-nums">{row.total == null ? <span className="text-[#939CAA]">—</span> : new Intl.NumberFormat("en-US", { style: "currency", currency: row.currency }).format(row.total)}</td>
              <td className="px-2 py-4">
                <div className="flex justify-end gap-2">
                  <button className={action + " relative"} title={`${row.lines} line items`} aria-label={`Open ${row.lines} line items: ${row.name}`} onClick={() => onOpen(row.id)}><ListChecks size={18} /><span className="absolute -right-1 -top-2 min-w-5 rounded-full bg-[#20386E] px-1 text-center text-[10px] leading-5 text-white">{row.lines}</span></button>
                  {row.quote.job_id && <Link className={action} to={`/jobs/${encodeURIComponent(row.quote.job_id)}`} title="Open linked job" aria-label={`Open linked job: ${row.name}`}><ArrowUpRight size={18} /></Link>}
                </div>
              </td>
            </tr>)}
          {!loading && !visible.length && <tr><td colSpan={9} className="px-4 py-14 text-center text-[#687385]">{failed ? "Quotes couldn’t be loaded. Use Refresh below to try again." : filtered ? <><p>No quotes match these filters.</p><button className="mt-3 font-medium text-[#20386E] hover:underline" onClick={reset}>Clear filters</button></> : <><p>No quotes yet.</p><button className="mt-3 font-medium text-[#20386E] hover:underline" onClick={onNew}>Create your first quote</button></>}</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="mt-2 border-t border-[#E7EAF0] py-3 text-xs text-[#7A8596]">Showing {visible.length} of {rows.length} {rows.length === 1 ? "quote" : "quotes"}</div>
  </section>;
}
