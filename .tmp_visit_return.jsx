  // Issues, heads-ups and the field report stay in view; the calendar's work notes, product,
  // files and the rest fold under "Visit details", open by default only for upcoming visits.
  const detailHint = [
    work.length ? "Work" : "",
    multiVendor || product ? "Product" : "",
    cells.length ? "Details" : "",
    f.moves.length ? "Moves" : "",
    files.length ? `${files.length} ${files.length === 1 ? "file" : "files"}` : "",
    people.length ? "People" : "",
    result.length ? "Result" : "",
    other.length || original ? "Calendar notes" : "",
  ].filter(Boolean);
  const [showDetails, setShowDetails] = useState(() => !!ev.event_date && ev.event_date > denverDate());

  return (
    <article className="min-w-0">
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: TEAL050, color: TEAL, border: `1px solid ${MINT}` }}><Icon className="h-[15px] w-[15px]" /></span>
        <div className="min-w-0 flex-1">
          <h4 className="m-0 flex flex-wrap items-center gap-1.5 text-[15.5px] font-bold leading-tight" style={{ color: INK }}>{title}{chips.map((c) => <Chip key={c} tone="teal">{c}</Chip>)}{tickets.map((n) => <Chip key={`ticket-${n}`} tone={n >= 2 ? "amber" : "sand"}>{ticketLabel(n)}</Chip>)}</h4>
          <div className="mt-0.5 text-[12.5px]" style={{ color: MUTED }}>{meta}</div>
        </div>
        {badge ? <span className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span> : null}
      </div>
      {issues.length || headsUp.length || reports.length ? (
        <dl className="m-0 mt-3 flex flex-col gap-2.5 pl-[38px] max-[599px]:pl-0">
          {issues.length ? (
            <Row label="Issue">
              <ul className="m-0 list-none p-0">{issues.map((i, k) => <li key={k} className="mb-1 last:mb-0">{i.text}{i.line ? <span className="ml-1.5 font-mono text-[11.5px]" style={{ color: MUTED }}>line {i.line}</span> : null}</li>)}</ul>
            </Row>
          ) : null}
          {headsUp.length ? <Row label="Heads up"><span className="font-medium" style={{ color: AMBER7 }}><Bullets items={headsUp.map((h) => h.charAt(0).toUpperCase() + h.slice(1))} /></span></Row> : null}
          {reports.length ? (
            <Row label="Report">
              {reports.map((r, i) => (
                <div key={r.post_id || i} className={i ? "mt-3" : ""}>
                  {r.message ? <div className="border-l-[3px] pl-3" style={{ borderColor: MINT }}><ClampedText text={r.message} maxLines={4} className="text-[14.5px] leading-[21px] whitespace-pre-wrap break-words" style={{ color: INK }} /></div>
                    : <span className="text-[13.5px]" style={{ color: MUTED }}>Photos only, no notes.</span>}
                  {r.edited_at ? <span className="text-[11.5px] italic" style={{ color: MUTED }}>{r.edited_by ? `edited by ${r.edited_by}` : "edited"}</span> : null}
                  <PhotoStrip urls={r.photos} onPhotoClick={onPhotoClick} className="mt-2" />
                  <HistoryTextEdit type="report" recordId={r.id} jobId={r.job_id} text={r.message} canEdit={canEditText} onSaved={onChanged} />
                </div>
              ))}
            </Row>
          ) : null}
        </dl>
      ) : null}
      {services.length ? (
        <div className="pl-[38px] max-[599px]:pl-0">
          {services.map((s) => <ServiceItemPanel key={s.id} item={s} withReport={false} onChanged={onServiceChanged} />)}
        </div>
      ) : null}
      {detailHint.length ? (
        <div className="mt-2.5 pl-[38px] max-[599px]:pl-0">
          <button type="button" aria-expanded={showDetails} onClick={() => setShowDetails((v) => !v)} className="inline-flex max-w-full items-center gap-2 rounded-[8px] px-2.5 py-1 text-[12.5px] font-semibold hover:brightness-[0.98]" style={{ backgroundColor: BAND, color: TEAL, border: `1px solid ${HAIR}` }}>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${showDetails ? "rotate-180" : ""}`} />
            <span className="shrink-0">{showDetails ? "Hide visit details" : "Visit details"}</span>
            {showDetails ? null : <span className="min-w-0 truncate font-medium" style={{ color: MUTED }}>{detailHint.join(" · ")}</span>}
          </button>
          {showDetails ? (
            <>
              <dl className="m-0 mt-3 flex flex-col gap-2.5">
                {work.length ? <Row label="Work"><Bullets items={work} /></Row> : null}
                {multiVendor ? (
                  <Row label="Product">
                    <table className="w-full max-w-[420px] border-collapse overflow-hidden rounded-[9px] text-[13.5px]" style={{ border: `1px solid ${HAIR}` }}>
                      <thead><tr style={{ backgroundColor: BAND }}>{["Vendor", "Qty", "At BFS"].map((h) => <th key={h} className="border-b px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-[.1em]" style={{ color: INK2, borderColor: HAIR }}>{h}</th>)}</tr></thead>
                      <tbody>{f.vendors.filter((v) => v.qty != null).map((v, i) => <tr key={i}><td className="border-b px-3 py-1.5 font-semibold" style={{ borderColor: HAIR }}>{v.brand || "—"}</td><td className="border-b px-3 py-1.5" style={{ borderColor: HAIR }}>{v.qty}</td><td className="border-b px-3 py-1.5" style={{ borderColor: HAIR }}>{clean(v.here) || "—"}</td></tr>)}</tbody>
                    </table>
                  </Row>
                ) : null}
                {product ? <Row label="Product">{product}</Row> : null}
                {cells.length ? <Row label="Details"><InlineDetails cells={cells} /></Row> : null}
                {f.moves.length ? <Row label="Moved"><ul className="m-0 list-none p-0 text-[13.5px]" style={{ color: MUTED }}>{f.moves.map((m, i) => <li key={i} className={i === f.moves.length - 1 ? "font-semibold" : ""} style={i === f.moves.length - 1 ? { color: INK } : undefined}>{clean(m)}</li>)}</ul></Row> : null}
                {files.length ? <Row label="Files"><Files files={files} /></Row> : null}
                {people.length ? <Row label="People"><ul className="m-0 list-none p-0">{people.map((p, i) => <li key={i} className="mb-0.5"><span className="text-[12px] font-semibold" style={{ color: INK2 }}>{p.role}:</span> {p.text}</li>)}</ul></Row> : null}
                {result.length ? <Row label="Result"><Bullets items={result} /></Row> : null}
                {other.length ? (
                  <Row label="Other">
                    {showOther ? <Bullets items={other} /> : <button type="button" onClick={() => setShowOther(true)} className="text-[12.5px] font-semibold hover:underline" style={{ color: TEAL }}>Show {other.length} more {other.length === 1 ? "note" : "notes"}</button>}
                  </Row>
                ) : null}
              </dl>
              {original ? (
                <div className="mt-2">
                  <button type="button" onClick={() => setShowOriginal((v) => !v)} className="text-[12px] font-semibold hover:underline" style={{ color: MUTED }}>{showOriginal ? "Hide original calendar notes" : "Original calendar notes"}</button>
                  {showOriginal ? <p className="m-0 mt-1.5 whitespace-pre-wrap rounded-[9px] px-3 py-2 font-mono text-[12px] leading-[1.55]" style={{ backgroundColor: BAND, color: "#34403f", border: `1px solid ${HAIR}` }}>{original.replace(/\n{3,}/g, "\n\n")}</p> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

