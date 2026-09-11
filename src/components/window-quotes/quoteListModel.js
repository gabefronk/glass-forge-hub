export function quoteCreatedAt(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const normalized = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:[.][0-9]+)?)?$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const time = new Date(normalized).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function quoteListRow(quote, statusLabel) {
  const accepted = quote.sales_status === "won" ? quote.accepted_snapshot : null;
  const result = accepted?.result || quote.result;
  const lines = accepted?.lines || quote.lines || [];
  const settings = accepted?.settings || quote.settings || {};
  const rawTotal = result?.totals?.total;
  const imported = result?.native_source === "amsco_saved_import";
  const canShowTotal = (result?.verified === true || imported) && (quote.worker_status === "ready" || quote.sales_status === "won");
  return {
    quote,
    id: quote.id,
    created: quoteCreatedAt(quote.created_date),
    number: String(result?.native_quote_number || ""),
    name: quote.title || "Untitled quote",
    client: imported ? (result.snapshot?.customer?.Name || result.snapshot?.details?.Client || "") : [settings.dealer, settings.yard].filter(Boolean).join(" · "),
    status: quote.sales_status === "won" ? "Won" : statusLabel,
    lines: lines.length,
    units: lines.reduce((sum, line) => {
      const qty = Number(line.qty);
      return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
    }, 0),
    total: canShowTotal && rawTotal != null && rawTotal !== "" && Number.isFinite(Number(rawTotal)) ? Number(rawTotal) : null,
    currency: result?.totals?.currency || "USD",
  };
}

export function filterQuoteRows(rows, { search = "", field = "all", status = "all", sort = "created", direction = "desc" } = {}) {
  const query = search.trim().toLowerCase();
  const filtered = rows.filter(row => {
    const quote = row.quote;
    const statusMatches = status === "all" ||
      (status === "won" ? quote.sales_status === "won" :
        quote.sales_status !== "won" && (status === "open" ||
          (status === "attention" ? ["needs_details", "needs_sign_in", "failed"].includes(quote.worker_status) :
            quote.worker_status === status)));
    const text = field === "all" ? [row.number, row.name, row.client, row.status].join(" ") : String(row[field] ?? "");
    return statusMatches && text.toLowerCase().includes(query);
  });
  return filtered.sort((a, b) => {
    const first = a[sort], second = b[sort];
    // Keep missing values at the end in both sort directions.
    if (first == null || first === "") return second == null || second === "" ? 0 : 1;
    if (second == null || second === "") return -1;
    const comparison = typeof first === "number" && typeof second === "number" ? first - second : String(first).localeCompare(String(second), "en", { numeric: true, sensitivity: "base" });
    return (direction === "asc" ? comparison : -comparison) || b.created - a.created;
  });
}
