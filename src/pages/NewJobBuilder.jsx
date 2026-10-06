import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, ArrowRight, Check, UploadCloud, Building2, MapPin, User, Calendar,
  FileText, DollarSign, CheckCircle2, Pencil,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { C } from "@/lib/feeUI";
import { money, percent, buttonClass, primaryStyle, secondaryStyle, Field } from "@/components/budgets/ProcurementForms";
import SaleWonBanner from "@/components/new-job/SaleWonBanner";
import MonthAchievement from "@/components/new-job/MonthAchievement";

// DEMO ONLY — sample data, no entity writes. The final "Create job" button is
// permanently disabled and labelled "Demo only - not saved". Every field is
// editable after the fact: header fields and review values tap to edit in place.
const SALES_TAX_RATE = 0.0745;

const BUILDER_PRESETS = [
  { key: "shelby", name: "Shelby Homes", contact: "Camden Brien", phone: "801-555-0142", email: "camden@shelbyhomes.com", billing: "Net 30", leadWeeks: 4, blurb: "Production builder · standard vinyl package" },
  { key: "cadence", name: "Cadence Homes", contact: "Marisa Lloyd", phone: "385-555-0190", email: "marisa@cadencehomes.com", billing: "Net 45", leadWeeks: 5, blurb: "Production builder · mixed vinyl & patio doors" },
  { key: "other", name: "Someone else", contact: "", phone: "", email: "", billing: "", leadWeeks: 4, blurb: "Custom or one-off job" },
];

const SAMPLE = {
  jobName: "Shelby Homes - 215 Skyridge",
  jobCode: "SH-215SK",
  windowPO: "PO-7215606",
  mfgOrder: "",
  builderKey: "shelby",
  builderCustom: { contact: "", phone: "", email: "", billing: "", leadWeeks: 4 },
  address: { street: "215 Skyridge Dr", city: "Lehi, UT", lot: "Lot 12" },
  contact: { name: "Jared Pew", phone: "385-555-0188", email: "jared.pew@gmail.com" },
  leads: { orderDate: "2026-10-12", delivery: "2026-11-09", install: "2026-11-16" },
  quote: { vendor: "AMSCO Windows", quoteNumber: "Q-3517590", units: 14, material: 18400, fileName: "AMSCO_215Skyridge_Q3517590.pdf" },
  money: { cost: 18400, sale: 24900 },
};

const STEPS = [
  { key: "builder", title: "Who is the builder?", helper: "Pick a preset to fill in their contact and billing. You can edit anything after.", icon: Building2 },
  { key: "address", title: "Where is the job?", helper: "The street address is the hard match key for this job.", icon: MapPin },
  { key: "contact", title: "Who is the site contact?", helper: "The person on site who can let the crew in.", icon: User },
  { key: "leads", title: "When does it happen?", helper: "We will remind you about ordering and install dates.", icon: Calendar },
  { key: "quote", title: "Drop the supplier quote", helper: "Drag the PDF here. We show the parsed numbers so you can confirm them.", icon: FileText },
  { key: "money", title: "Money, in plain words", helper: "Type what you charge. We never add margin for you.", icon: DollarSign },
];

// Dark inline edit (header): display + pencil; tap to turn into an input.
function InlineEdit({ value, onCommit, type = "text", mono = false, placeholder = "—" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = () => { onCommit(draft); setEditing(false); };
  if (editing) {
    return (
      <input
        autoFocus type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? "0" : undefined}
        value={draft} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        className={`w-full min-w-0 rounded-[6px] px-1.5 py-0.5 text-[15px] font-bold outline-none focus:ring-2 ${mono ? "font-ref" : ""}`}
        style={{ color: "#f2eee8", backgroundColor: "rgba(255,255,255,.14)", border: "1px solid rgba(224,201,148,.6)", "--tw-ring-color": "rgba(224,201,148,.5)" }}
      />
    );
  }
  const empty = value === "" || value == null;
  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex w-full min-w-0 items-center gap-1.5 text-left">
      <span className={`truncate ${empty ? "italic" : ""} ${mono ? "font-ref" : ""}`} style={{ color: empty ? "#8f999b" : "#f2eee8" }}>{empty ? placeholder : value}</span>
      <Pencil size={12} className="shrink-0 opacity-40 transition group-hover:opacity-90" style={{ color: "#e0c994" }} />
    </button>
  );
}

// Light inline edit (review): dark text on light card.
function InlineEditLight({ value, onCommit, type = "text", mono = false, placeholder = "—" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => { setDraft(value ?? ""); }, [value]);
  const commit = () => { onCommit(draft); setEditing(false); };
  if (editing) {
    return (
      <input
        autoFocus type={type} step={type === "number" ? "any" : undefined} min={type === "number" ? "0" : undefined}
        value={draft} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(value ?? ""); setEditing(false); } }}
        className={`w-full min-w-0 rounded-[6px] px-1.5 py-0.5 text-[15px] font-bold outline-none focus:ring-2 ${mono ? "font-ref" : ""}`}
        style={{ color: "#101617", backgroundColor: "#fff", border: "1px solid #0b3f3b", "--tw-ring-color": "rgba(11,63,59,.4)" }}
      />
    );
  }
  const empty = value === "" || value == null;
  return (
    <button type="button" onClick={() => setEditing(true)} className="group flex w-full min-w-0 items-center gap-1.5 text-left">
      <span className={`truncate ${empty ? "italic" : ""} ${mono ? "font-ref" : ""} text-[13px] font-bold`} style={{ color: empty ? "#8a8f93" : "#101617" }}>{empty ? placeholder : value}</span>
      <Pencil size={12} className="shrink-0 opacity-0 transition group-hover:opacity-70" style={{ color: "#0b3f3b" }} />
    </button>
  );
}

function StepShell({ icon: Icon, title, helper, children }) {
  return <SheetCard icon={Icon} tile={TILE.teal} title={title} sub={helper}>{children}</SheetCard>;
}

function MoneyStat({ label, value, tone }) {
  const color = tone === "cost" ? "#0b3f3b" : tone === "sale" ? "#34506a" : tone === "profit" ? "#166447" : "#101617";
  return (
    <div className="rounded-[12px] p-4" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
      <div className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#616a6d" }}>{label.toUpperCase()}</div>
      <div className="mt-1 text-[28px] font-extrabold tabular-nums" style={{ color, letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

export default function NewJobBuilder() {
  const [s, setS] = useState(SAMPLE);
  const [step, setStep] = useState(0);
  const [dragging, setDragging] = useState(false);
  const set = (patch) => setS(prev => ({ ...prev, ...patch }));

  const builder = BUILDER_PRESETS.find(p => p.key === s.builderKey) || BUILDER_PRESETS[2];
  const builderFields = builder.key === "other" ? s.builderCustom : builder;
  const tax = Math.round((Number(s.money.sale) || 0) * SALES_TAX_RATE * 100) / 100;
  const cost = Number(s.money.cost) || 0;
  const sale = Number(s.money.sale) || 0;
  const profit = sale - cost;
  const profitPct = cost > 0 ? profit / cost : 0;
  const customerTotal = sale + tax;
  const atReview = step === STEPS.length;

  function pickBuilder(key) { set({ builderKey: key }); }
  function onDrop(e) {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer?.files?.[0];
    set({ quote: { ...s.quote, fileName: file ? file.name : s.quote.fileName } });
  }

  return (
    <PageShell width="max-w-[980px]">
      <Link to="/purchasing" className="inline-flex items-center gap-1 text-sm font-semibold" style={{ color: C.text }}><ArrowLeft size={15} /> Back to Purchasing</Link>

      {/* Sticky header — four big fields, tap to edit in place */}
      <div className="sticky top-0 z-30 rounded-[14px]" style={{ background: "linear-gradient(160deg,#10292b 0%,#0a1d1f 100%)", boxShadow: "0 16px 36px -22px rgba(10,29,31,.7)" }}>
        <div className="px-5 py-4 max-[699px]:px-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="m-0 text-[20px] font-bold" style={{ color: "#f2eee8", letterSpacing: "-0.03em" }}>Start a new job</h1>
            <span className="inline-flex items-center gap-1.5 rounded-[7px] px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "rgba(224,201,148,.14)", color: "#e0c994", border: "1px solid rgba(224,201,148,.35)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />Demo
            </span>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Job name", value: s.jobName, key: "jobName", mono: false, placeholder: "Job name" },
              { label: "Job code number", value: s.jobCode, key: "jobCode", mono: true, placeholder: "e.g. SH-215SK" },
              { label: "Window PO number", value: s.windowPO, key: "windowPO", mono: true, placeholder: "e.g. PO-7215606" },
              { label: "Manufacturer order #", value: s.mfgOrder, key: "mfgOrder", mono: true, placeholder: "Not ordered yet" },
            ].map(f => (
              <label key={f.key} className="block min-w-0">
                <span className="block text-[10.5px] font-semibold tracking-[.14em]" style={{ color: "#9fc3b6" }}>{f.label.toUpperCase()}</span>
                <div className="mt-1">
                  <InlineEdit value={f.value} mono={f.mono} placeholder={f.placeholder} onCommit={v => set({ [f.key]: v })} />
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-1.5">
        {STEPS.concat([{ key: "review", title: "Review", icon: CheckCircle2 }]).map((st, i) => {
          const done = i < step, current = i === step;
          return (
            <div key={st.key} className="flex flex-1 flex-col items-center gap-1">
              <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: done || current ? "#0b3f3b" : "#e0dacf" }} />
              <span className="text-[11px] font-semibold" style={{ color: current ? "#0b3f3b" : done ? "#3e5a55" : "#8a8f93" }}>{i + 1}. {st.title.replace("?", "")}</span>
            </div>
          );
        })}
      </div>

      {/* Step content */}
      {!atReview && (() => {
        const st = STEPS[step]; const Icon = st.icon;
        return (
          <StepShell icon={Icon} title={st.title} helper={st.helper}>
            {step === 0 && (
              <div className="grid gap-3 sm:grid-cols-3">
                {BUILDER_PRESETS.map(p => {
                  const selected = s.builderKey === p.key;
                  return (
                    <button key={p.key} type="button" onClick={() => pickBuilder(p.key)} className="rounded-[12px] p-4 text-left transition" style={{ backgroundColor: selected ? "#eef5f3" : "#ffffff", border: `2px solid ${selected ? "#0b3f3b" : "#d3cabb"}` }}>
                      <div className="flex items-center justify-between"><Building2 size={18} style={{ color: "#0b3f3b" }} />{selected && <Check size={16} style={{ color: "#0b3f3b" }} />}</div>
                      <div className="mt-2 text-[15px] font-bold" style={{ color: "#101617" }}>{p.name}</div>
                      <div className="text-[12px]" style={{ color: "#616a6d" }}>{p.blurb}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {step === 0 && (
              <div className="mt-4 grid gap-3 rounded-[12px] p-4 sm:grid-cols-2" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
                <Field label="Builder contact" value={builderFields.contact} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, contact: v } }) : set({})} />
                <Field label="Builder phone" value={builderFields.phone} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, phone: v } }) : set({})} />
                <Field label="Builder email" value={builderFields.email} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, email: v } }) : set({})} />
                <Field label="Billing terms" value={builderFields.billing} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, billing: v } }) : set({})} />
                <Field label="Default lead time (weeks)" type="number" value={String(builderFields.leadWeeks)} onChange={v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, leadWeeks: Number(v) || 0 } }) : set({})} />
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><Field label="Street address" value={s.address.street} onChange={v => set({ address: { ...s.address, street: v } })} /></div>
                <Field label="City, State" value={s.address.city} onChange={v => set({ address: { ...s.address, city: v } })} />
                <Field label="Lot / unit" value={s.address.lot} onChange={v => set({ address: { ...s.address, lot: v } })} />
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Site contact name" value={s.contact.name} onChange={v => set({ contact: { ...s.contact, name: v } })} />
                <Field label="Phone" value={s.contact.phone} onChange={v => set({ contact: { ...s.contact, phone: v } })} />
                <div className="sm:col-span-2"><Field label="Email" value={s.contact.email} onChange={v => set({ contact: { ...s.contact, email: v } })} /></div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Order date" type="date" value={s.leads.orderDate} onChange={v => set({ leads: { ...s.leads, orderDate: v } })} />
                <Field label="Expected delivery" type="date" value={s.leads.delivery} onChange={v => set({ leads: { ...s.leads, delivery: v } })} />
                <Field label="Install date" type="date" value={s.leads.install} onChange={v => set({ leads: { ...s.leads, install: v } })} />
                <div className="sm:col-span-3 rounded-[10px] p-3 text-[13px]" style={{ backgroundColor: "#eef5f3", color: "#082f2c", border: "1px solid #c7e4d2" }}>
                  Windows usually take about {builderFields.leadWeeks} weeks from order to delivery. We will set the manufacturer order number once you place it.
                </div>
              </div>
            )}

            {step === 4 && (
              <div>
                <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} className="flex flex-col items-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-8 text-center" style={{ borderColor: dragging ? "#0b3f3b" : "#d3cabb", backgroundColor: dragging ? "#eef5f3" : "#f4f1ea" }}>
                  <UploadCloud size={28} style={{ color: "#0b3f3b" }} />
                  <strong className="text-[14px]" style={{ color: "#101617" }}>Drop the supplier quote PDF here</strong>
                  <span className="text-[12px]" style={{ color: "#616a6d" }}>Demo: no file is uploaded. We show a parsed sample below.</span>
                </div>
                <div className="mt-4 rounded-[12px] p-4" style={{ backgroundColor: "#ffffff", border: "1px solid #d3cabb" }}>
                  <div className="flex items-center gap-2">
                    <FileText size={16} style={{ color: "#0b3f3b" }} />
                    <span className="text-[14px] font-bold" style={{ color: "#101617" }}>{s.quote.fileName}</span>
                    <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "#e2eeeb", color: "#082f2c", border: "1px solid #c7e4d2" }}>Parsed</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                    <div><div className="text-[11px]" style={{ color: "#616a6d" }}>Vendor</div><strong>{s.quote.vendor}</strong></div>
                    <div><div className="text-[11px]" style={{ color: "#616a6d" }}>Quote #</div><strong className="font-ref">{s.quote.quoteNumber}</strong></div>
                    <div><div className="text-[11px]" style={{ color: "#616a6d" }}>Units</div><strong>{s.quote.units}</strong></div>
                    <div><div className="text-[11px]" style={{ color: "#616a6d" }}>Material cost</div><strong>{money(s.quote.material)}</strong></div>
                  </div>
                  <button className={buttonClass + " mt-3"} style={secondaryStyle} onClick={() => set({ money: { ...s.money, cost: s.quote.material } })}>Use this as my cost</button>
                </div>
              </div>
            )}

            {step === 5 && (
              <div>
                <SaleWonBanner cost={cost} sale={sale} profit={profit} profitPct={profitPct} />
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="block text-[12px] font-semibold" style={{ color: "#566063" }}>What it costs me</span>
                    <input type="number" min="0" step="any" value={s.money.cost} onChange={e => set({ money: { ...s.money, cost: e.target.value } })} className="mt-1 w-full rounded-[10px] px-3 py-3 text-[20px] font-bold tabular-nums" style={{ border: "1px solid #d3cabb", color: "#101617" }} />
                  </label>
                  <label className="block">
                    <span className="block text-[12px] font-semibold" style={{ color: "#566063" }}>What I charge (sale price)</span>
                    <input type="number" min="0" step="any" value={s.money.sale} onChange={e => set({ money: { ...s.money, sale: e.target.value } })} className="mt-1 w-full rounded-[10px] px-3 py-3 text-[20px] font-bold tabular-nums" style={{ border: "1px solid #d3cabb", color: "#101617" }} />
                  </label>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <MoneyStat label="What it costs me" value={money(cost)} tone="cost" />
                  <MoneyStat label="What I charge" value={money(sale)} tone="sale" />
                  <MoneyStat label="What I keep (profit)" value={money(profit)} tone="profit" />
                </div>
                <div className="mt-4 rounded-[12px] p-4" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
                  <div className="flex items-center justify-between text-[14px]"><span style={{ color: "#566063" }}>Sale price</span><strong>{money(sale)}</strong></div>
                  <div className="mt-2 flex items-center justify-between text-[14px]"><span style={{ color: "#566063" }}>Sales tax (automatic, {(SALES_TAX_RATE * 100).toFixed(2)}%)</span><strong>{money(tax)}</strong></div>
                  <div className="mt-2 flex items-center justify-between text-[14px]" style={{ borderTop: "1px solid #d3cabb", paddingTop: 8 }}><span style={{ color: "#566063" }}>Customer total with tax</span><strong>{money(customerTotal)}</strong></div>
                  <div className="mt-2 flex items-center justify-between text-[14px]"><span style={{ color: "#566063" }}>Profit</span><strong style={{ color: profit >= 0 ? "#166447" : "#a43432" }}>{money(profit)} ({percent(profitPct)} margin)</strong></div>
                </div>
                <p className="mt-3 text-[12px]" style={{ color: "#616a6d" }}>No automatic margin is applied. You set the sale price; the tax line is the only thing added for you.</p>
                <MonthAchievement thisJob={sale} />
              </div>
            )}

            <div className="mt-5 flex items-center justify-between">
              <button className={buttonClass} style={secondaryStyle} disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={15} />Back</button>
              <button className={buttonClass} style={primaryStyle} onClick={() => setStep(step + 1)}>{step === STEPS.length - 1 ? "Review" : "Next"}<ArrowRight size={15} /></button>
            </div>
          </StepShell>
        );
      })()}

      {/* Review — every value taps to edit in place */}
      {atReview && (
        <SheetCard icon={CheckCircle2} tile={TILE.teal} title="Review your new job" sub="Tap any value to edit it. Everything below is sample data — nothing is saved.">
          <SaleWonBanner cost={cost} sale={sale} profit={profit} profitPct={profitPct} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Job name", value: s.jobName, onCommit: v => set({ jobName: v }) },
              { label: "Job code", value: s.jobCode, mono: true, onCommit: v => set({ jobCode: v }) },
              { label: "Window PO", value: s.windowPO, mono: true, onCommit: v => set({ windowPO: v }) },
              { label: "Mfg order #", value: s.mfgOrder, mono: true, placeholder: "Not ordered yet", onCommit: v => set({ mfgOrder: v }) },
            ].map(f => (
              <div key={f.label} className="rounded-[10px] p-3" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
                <div className="text-[10.5px] font-semibold tracking-[.12em]" style={{ color: "#616a6d" }}>{f.label.toUpperCase()}</div>
                <div className="mt-1"><InlineEditLight value={f.value} mono={f.mono} placeholder={f.placeholder} onCommit={f.onCommit} /></div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReviewBlock title="Builder" icon={Building2} fields={[
              { label: "Name", value: builder.name },
              { label: "Contact", value: builderFields.contact, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, contact: v } }) : set({}) },
              { label: "Phone", value: builderFields.phone, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, phone: v } }) : set({}) },
              { label: "Email", value: builderFields.email, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, email: v } }) : set({}) },
              { label: "Billing", value: builderFields.billing, onCommit: v => builder.key === "other" ? set({ builderCustom: { ...s.builderCustom, billing: v } }) : set({}) },
            ]} />
            <ReviewBlock title="Address" icon={MapPin} fields={[
              { label: "Street", value: s.address.street, onCommit: v => set({ address: { ...s.address, street: v } }) },
              { label: "City, State", value: s.address.city, onCommit: v => set({ address: { ...s.address, city: v } }) },
              { label: "Lot / unit", value: s.address.lot, onCommit: v => set({ address: { ...s.address, lot: v } }) },
            ]} />
            <ReviewBlock title="Site contact" icon={User} fields={[
              { label: "Name", value: s.contact.name, onCommit: v => set({ contact: { ...s.contact, name: v } }) },
              { label: "Phone", value: s.contact.phone, onCommit: v => set({ contact: { ...s.contact, phone: v } }) },
              { label: "Email", value: s.contact.email, onCommit: v => set({ contact: { ...s.contact, email: v } }) },
            ]} />
            <ReviewBlock title="Lead times" icon={Calendar} fields={[
              { label: "Order date", value: s.leads.orderDate, type: "date", onCommit: v => set({ leads: { ...s.leads, orderDate: v } }) },
              { label: "Delivery", value: s.leads.delivery, type: "date", onCommit: v => set({ leads: { ...s.leads, delivery: v } }) },
              { label: "Install", value: s.leads.install, type: "date", onCommit: v => set({ leads: { ...s.leads, install: v } }) },
            ]} />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[12px] p-4" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
              <div className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#616a6d" }}>COST (TAP TO EDIT)</div>
              <div className="mt-1"><InlineEditLight value={s.money.cost} type="number" onCommit={v => set({ money: { ...s.money, cost: v } })} /></div>
            </div>
            <div className="rounded-[12px] p-4" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
              <div className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#616a6d" }}>SALE (TAP TO EDIT)</div>
              <div className="mt-1"><InlineEditLight value={s.money.sale} type="number" onCommit={v => set({ money: { ...s.money, sale: v } })} /></div>
            </div>
            <MoneyStat label="Profit" value={`${money(profit)} (${percent(profitPct)})`} tone="profit" />
          </div>

          <MonthAchievement thisJob={sale} />

          <div className="mt-4 rounded-[12px] p-3 text-[13px]" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }}>
            Sales tax (automatic, 7.45%): <strong>{money(tax)}</strong> · Customer total with tax: <strong>{money(customerTotal)}</strong>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button className={buttonClass} style={secondaryStyle} onClick={() => setStep(STEPS.length - 1)}><ArrowLeft size={15} />Back to money</button>
            <button disabled className={buttonClass} style={{ ...primaryStyle, opacity: 0.6, cursor: "not-allowed" }}><Check size={15} />Demo only - not saved</button>
          </div>
          <p className="mt-3 text-[12px]" style={{ color: "#616a6d" }}>This is a demo on a branch. No Job, Quote, FeeLine or PO record is created. The button is disabled on purpose.</p>
        </SheetCard>
      )}
    </PageShell>
  );
}

function ReviewBlock({ title, icon: Icon, fields }) {
  return (
    <div className="rounded-[12px] p-4" style={{ backgroundColor: "#ffffff", border: "1px solid #d3cabb" }}>
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: "#0b3f3b" }} />
        <h3 className="m-0 text-[14px] font-bold" style={{ color: "#082f2c" }}>{title}</h3>
      </div>
      <div className="mt-2 space-y-1.5">
        {fields.map(f => (
          <div key={f.label} className="flex items-start gap-3">
            <span className="w-24 shrink-0 pt-1 text-[11px] font-semibold" style={{ color: "#616a6d" }}>{f.label}</span>
            <div className="min-w-0 flex-1"><InlineEditLight value={f.value} type={f.type} mono={f.mono} placeholder={f.placeholder} onCommit={f.onCommit || (() => {})} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}