      {/* 1. Job ledger: the same rows Purchasing reads */}
      <Sheet title="1 · Job ledger · active jobs" aside={`${t.jobs} sold Purchasing jobs not yet Paid · management margin over each job's lifetime, not a calendar period`}
        source={<>Rule (owner-confirmed): every Purchasing job is an outside-BFS sale; profit = sale less all-in cost (materials + sub-labor + install material), split 50/50 between YA and Glass Forge, with no 10% fee and no overhead. Tags: <strong>feed</strong> = bank feed line matched to the job · <strong>invoice</strong> = QuickBooks document (read only, Oct 26) · <strong>est.</strong> = budget, PO, order, typed or entered figure · Unknown = no figure. Purchasing&apos;s Active view shows these same rows. <Link to="/purchasing" className="font-semibold hover:underline" style={{ color: INK }}>Purchasing →</Link></>}>
        <LedgerTable rows={ledger.active} totals={t} />
        <div className="text-[13px]" style={{ padding: "8px 16px", color: SECONDARY }}>
          Sold, cost and profit add the {t.priced} jobs with a sale{t.noSale.jobs.length ? `; ${t.noSale.jobs.join(", ")} has no sale yet (${money(-t.noSale.cost)} cost, kept out of cost and profit)` : ""}.
          {t.incomplete.jobs.length ? ` Crew cost unknown on ${t.incomplete.jobs.length} (${t.incomplete.jobs.join(", ")}): their ${money(t.incomplete.profit)} profit is before crew. Profit on the ${t.priced - t.incomplete.jobs.length} jobs with every cost on file: ${money(t.completeProfit)}.` : ""}
          {" "}Expected to earn: {["2026", "2026?", "2027", "unknown"].map((y) => [y, ledger.active.filter((r) => r.timing.year === y)]).filter(([, rows]) => rows.length).map(([y, rows]) => `${YEAR_LABEL[y]} ${rows.length} job${rows.length === 1 ? "" : "s"}`).join(" · ")}.
        </div>
        <FlagList rows={ledger.active} />
        <div style={{ borderTop: `2px solid ${STRONG}` }}>
          <div className="flex flex-wrap items-baseline gap-x-3" style={{ padding: "10px 16px 4px" }}>
            <h3 className="m-0 text-[15px] font-bold" style={{ color: INK }}>Completed (Paid) · {tc.jobs} jobs</h3>
            <span className="text-[13px]" style={{ color: SECONDARY }}>own totals, not in the active figures above</span>
          </div>
          <LedgerTable rows={ledger.completed} totals={tc} />
          <FlagList rows={ledger.completed} />
        </div>
      </Sheet>

      {/* 1b. Receipts ledger */}
      <Sheet title="Receipts ledger" aside={`${receipts.mapped.length} customer payments on ledger jobs · ${money(receipts.mappedTotal)}`}
        source="Sources: bank deposits matched to a job (feed), and QuickBooks payments whose deposit is a combined bank line or falls after the bank data ends (invoice). Each payment counts once. Customer deposits no ledger job accounts for are listed after, so nothing received is hidden.">
        <table className="w-full border-collapse">
          <Head cols={[["Date"], ["Job"], ["Amount", true], ["Tag"], ["Source"]]} />
          <tbody>
            {receipts.mapped.map((x, i) => <Row key={`${x.jobId}-${i}`} cells={[[dayLabel(x.date)], [x.job], [x.amount, "money"], [TAGS[x.tag]], [x.source]]} />)}
            <Row tone="total" cells={[["Total"], [""], [receipts.mappedTotal, "money"], [""], [""]]} />
          </tbody>
        </table>
        <div style={{ borderTop: `2px solid ${STRONG}` }}>
          <div style={{ padding: "10px 16px 4px" }}>
            <h3 className="m-0 text-[15px] font-bold" style={{ color: INK }}>Customer deposits no ledger job accounts for · {receipts.unmatched.length} · {money(receipts.unmatchedTotal)}</h3>
          </div>
          <table className="w-full border-collapse">
            <Head cols={[["Date"], ["Amount", true], ["Bank description"], ["What is known"]]} />
            <tbody>
              {receipts.unmatched.map((u) => <Row key={u.id} cells={[[dayLabel(u.date)], [u.amount, "money"], [u.description], [u.note || "—"]]} />)}
            </tbody>
          </table>
        </div>
        <ul className="m-0 list-disc text-[13px]" style={{ padding: "10px 16px 12px 34px", color: SECONDARY }}>
          {receipts.notInLedger.map((s) => <li key={s.ref}>{s.ref} · {s.customer} · {money(s.amount)}{s.open ? ` · ${money(s.open)} open` : " · paid"}: {s.note}</li>)}
        </ul>
      </Sheet>

      {/* 2. Company profit */}
      <Sheet title="2 · Company profit" aside={`YA operating statement · cash basis · ${dayLabel(op.period.from)} – ${dayLabel(op.period.to)}, ${op.period.to.slice(0, 4)} · bank lines, unreconciled`}
        source="One period and basis: every Mountain America bank line in the period. Only genuine operating expenses are deducted. Owner draws, loan payments and transfers are not expenses. Items still to classify are listed apart and not deducted, so the result is before them, not a final profit. Job-lifetime margins (view 1) are a different basis and are not added here.">
        <table className="w-full border-collapse">
          <Head cols={[["Line"], ["Amount", true]]} />
          <tbody>
            {OPERATING_GROUPS.filter(([, , k]) => k === "income").map(([key, label]) => <Row key={key} cells={[[label], [op.totals[key], "money"]]} />)}
            <Row tone="total" cells={[["Income"], [op.income, "money"]]} />
            {OPERATING_GROUPS.filter(([, , k]) => ["direct", "intercompany", "opex"].includes(k)).map(([key, label]) => <Row key={key} cells={[[label], [op.totals[key], "out"]]} />)}
            <Row tone="total" cells={[["Operating result before the items still to classify"], [op.resultBeforePending, "money"]]} />
            {OPERATING_GROUPS.filter(([, , k]) => k === "pending").map(([key, label]) => <Row key={key} tone="muted" cells={[[`To classify · ${label}`], [op.totals[key], "out"]]} />)}
            <Row tone="muted" cells={[["To classify, total (not deducted above)"], [op.pending, "out"]]} />
            {OPERATING_GROUPS.filter(([, , k]) => k === "excluded").map(([key, label]) => <Row key={key} cells={[[`Not an expense · ${label}`], [op.totals[key], "out"]]} />)}
          </tbody>
        </table>
        <div className="text-[13px]" style={{ padding: "8px 16px", color: SECONDARY }}>
          Tax payments, each to classify as employer payroll tax, income tax or other: {op.taxLines.map((x) => `${dayLabel(x.date)} ${x.description} ${money(x.amount)}`).join(" · ")}.
        </div>
        <table className="w-full border-collapse" style={{ borderTop: `2px solid ${STRONG}` }}>
          <Head cols={[["Basis"], ["YA", true], ["Glass Forge", true], ["Combined", true, "YA and Glass Forge together, with the amount between them counted once"]]} />
          <tbody>
            <Row cells={[[`Active jobs · job lifetime · ${t.priced} jobs with a sale (job ledger)`], [entities.jobs.ya, "money"], [entities.jobs.gf, "money"], [entities.jobs.combined, "money"]]} />
            <Row cells={[[`Cash basis · ${dayLabel(op.period.from)} – ${dayLabel(op.period.to)} · before items to classify`], [entities.cash.ya, "money"],
              [<span key="g">{money(entities.cash.gfFromYa)} <span className="text-[13px]" style={{ color: SECONDARY }}>from YA; own costs not in the Hub</span></span>, "r"], [entities.cash.combined, "money"]]} />
          </tbody>
        </table>
        <ul className="m-0 list-disc text-[13px]" style={{ padding: "10px 16px 12px 34px", color: SECONDARY }}>
          <li>Job lifetime: the job profit splits 50/50, so Combined is the whole job profit; Glass Forge&apos;s half is not subtracted again anywhere.</li>
          <li>Cash basis: YA&apos;s {money(entities.cash.eliminated)} of Glass Forge invoices paid is YA&apos;s expense and Glass Forge&apos;s income, so it cancels once in Combined. Glass Forge&apos;s other income and costs are not in the Hub.</li>
          <li>Glass Forge invoices vs the split rule ({GF_FEE_CHECK.invoices.join(", ")}, read {GF_FEE_CHECK.readAt}): {GF_FEE_CHECK.finding} {GF_FEE_CHECK.agren}</li>
          <li>{GF_FEE_CHECK.aside}</li>
        </ul>
      </Sheet>

