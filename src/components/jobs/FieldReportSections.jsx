// The conditional sections of the field-visit report form. Which of these render is decided
// by eventFieldScope() in base44/shared/fieldVisitReport.js — the same rules the server
// validates with — so a field can never appear on an event that does not collect it.
//
// Phone-first throughout: one column, 44-48px touch targets, no horizontal scroll, and the
// only media picker in the whole form lives in the modal's shared end-of-visit section.
// Nothing here renders an upload control: issues are checklist and note items, never
// attachment subforms.
import { Plus, Trash2 } from "lucide-react";
import {
  WINDOW_SOURCES,
  SCREEN_ISSUE_KINDS,
  SHEETROCK_OUTCOMES,
  documentationPrompts,
  requiredDimensionsFor,
  windowIssueKindsFor,
  notReadyReasonsFor,
  checklistItemsFor,
} from "../../../base44/shared/fieldVisitReport.js";

const CARD = "#FFFFFF", LINE = "#D6CCBA", EDGE = "#B3A792", FIELD = "#9A9080";
const INK = "#101617", MUT = "#34403F", DARK = "#0F2628", TEAL = "#0B3F3B";

const fieldStyle = { border: `1px solid ${FIELD}`, backgroundColor: CARD, color: INK };
const inputClass = "min-h-[48px] w-full rounded-[12px] px-3 text-[15px] focus:outline-none";

export function Label({ children, as: Tag = "div", className = "" }) {
  return <Tag className={`mb-1.5 block text-[12px] font-semibold uppercase ${className}`} style={{ color: MUT, letterSpacing: ".06em" }}>{children}</Tag>;
}

export function Card({ title, hint, children, ...rest }) {
  return (
    <section className="space-y-3 rounded-[12px] p-3" style={{ backgroundColor: CARD, border: `1px solid ${EDGE}` }} {...rest}>
      {title ? <h4 className="text-[14.5px] font-semibold" style={{ color: INK }}>{title}</h4> : null}
      {hint ? <p className="text-[12.5px]" style={{ color: MUT }}>{hint}</p> : null}
      {children}
    </section>
  );
}

// A two-way switch: both halves are real buttons, the picked one is filled.
export function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-2 gap-1 rounded-[12px] p-1" style={{ backgroundColor: "#E9E2D4" }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={String(o.value)} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className="min-h-[44px] rounded-[9px] px-2 text-[14px] font-semibold"
            style={on ? { backgroundColor: DARK, color: "#fff" } : { color: MUT }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// A full-width checkbox row: the whole row is the hit target, which is what a thumb needs.
export function CheckRow({ checked, onChange, label, sub, children }) {
  return (
    <div className="rounded-[10px]" style={{ border: `1px solid ${checked ? TEAL : LINE}`, backgroundColor: checked ? "#EAF2EF" : CARD }}>
      <label className="flex min-h-[48px] cursor-pointer items-center gap-3 px-3 py-2">
        <input type="checkbox" className="sr-only" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px]" style={{ border: `2px solid ${checked ? TEAL : FIELD}`, backgroundColor: checked ? TEAL : CARD }} aria-hidden="true">
          {checked ? <span className="text-[13px] font-bold leading-none text-white">✓</span> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold" style={{ color: INK }}>{label}</span>
          {sub ? <span className="block text-[12.5px]" style={{ color: "#566063" }}>{sub}</span> : null}
        </span>
      </label>
      {checked && children ? <div className="space-y-2 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3, ariaLabel }) {
  // Plain textarea: the phone keyboard's own dictation button fills it. No speech code here.
  return (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} aria-label={ariaLabel}
      placeholder={placeholder} className="w-full resize-y rounded-[12px] p-3 text-[15px] focus:outline-none" style={fieldStyle} />
  );
}

function AddAnother({ onClick, label }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[12px] border-2 border-dashed text-[14px] font-semibold"
      style={{ borderColor: FIELD, color: TEAL, backgroundColor: CARD }}>
      <Plus className="h-4 w-4" />{label}
    </button>
  );
}

function RowHeader({ title, onRemove }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[13px] font-semibold" style={{ color: MUT }}>{title}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${title}`} className="flex h-9 w-9 items-center justify-center rounded-full" style={{ border: `1px solid ${EDGE}`, color: INK }}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

const listOps = (value, onChange) => ({
  rows: Array.isArray(value) ? value : [],
  add: (row) => onChange([...(Array.isArray(value) ? value : []), row]),
  patch: (i, patch) => onChange((Array.isArray(value) ? value : []).map((r, j) => (j === i ? { ...r, ...patch } : r))),
  remove: (i) => onChange((Array.isArray(value) ? value : []).filter((_, j) => j !== i)),
});

// ── Readiness / not-ready reasons ──────────────────────────────────────────────
export function NotReadySection({ eventType, value, onChange, notReady, onNotReady }) {
  const reasons = notReadyReasonsFor(eventType);
  if (!reasons.length) return null;
  const { rows, patch } = listOps(value, onChange);
  const pick = (spec, on) => {
    if (on) onChange([...rows, { key: spec.key, label: spec.label, note: "" }]);
    else onChange(rows.filter((r) => r.key !== spec.key));
  };
  const title = eventType === "job_readiness" ? "Job-level readiness" : eventType === "install" ? "Not ready / cannot install" : "Job not ready";
  return (
    <Card title={title} hint="Leave every box clear when the job was ready.">
      {eventType !== "job_readiness" ? (
        <CheckRow checked={notReady} onChange={onNotReady} label="The job was not ready for this visit" />
      ) : null}
      <div className="space-y-2">
        {reasons.map((spec) => {
          const i = rows.findIndex((r) => r.key === spec.key);
          const on = i >= 0;
          return (
            <CheckRow key={spec.key} checked={on} onChange={(c) => pick(spec, c)} label={spec.label}
              sub={spec.reschedules ? "Flags delivery / install as needing rescheduling" : undefined}>
              <TextArea value={on ? rows[i].note || "" : ""} onChange={(v) => patch(i, { note: v })} rows={2}
                ariaLabel={`${spec.label} note`} placeholder={spec.needsNote ? "Required — say what the problem is" : "Optional note"} />
            </CheckRow>
          );
        })}
      </div>
    </Card>
  );
}

// ── Ordered-window issues (Install, Job Readiness) ─────────────────────────────
export function WindowIssuesSection({ eventType, windows, value, onChange, job }) {
  const kinds = windowIssueKindsFor(eventType);
  if (!kinds.length) return null;
  const { rows, add, patch, remove } = listOps(value, onChange);
  const options = [...(windows || []), { id: "other", label: "Other / cannot identify the unit", other: true }];
  const title = eventType === "job_readiness" ? "Window-by-window checklist" : "Window issues";
  const hint = windows && windows.length
    ? "Pick the unit from the job's ordered window package. Add another item for each separate issue."
    : "This job has no ordered window package in the Hub yet, so pick Other and describe the location.";

  return (
    <Card title={title} hint={hint}>
      {rows.map((row, i) => {
        const spec = kinds.find((k) => k.key === row.kind) || kinds[0];
        const required = requiredDimensionsFor(job, row.window_id);
        return (
          <div key={i} className="space-y-2 rounded-[10px] p-2.5" style={{ border: `1px solid ${LINE}` }}>
            <RowHeader title={`Item ${i + 1}`} onRemove={() => remove(i)} />
            <label className="block">
              <Label as="span">Issue</Label>
              <select value={row.kind} onChange={(e) => patch(i, { kind: e.target.value })} className={inputClass} style={fieldStyle}>
                {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <label className="block">
              <Label as="span">Affected window</Label>
              <select value={row.window_id || ""} onChange={(e) => {
                const req = requiredDimensionsFor(job, e.target.value);
                patch(i, {
                  window_id: e.target.value,
                  window_label: (options.find((o) => o.id === e.target.value) || {}).label || "",
                  required_width: req ? req.width : row.required_width,
                  required_height: req ? req.height : row.required_height,
                });
              }} className={inputClass} style={fieldStyle}>
                <option value="">Pick a window…</option>
                {options.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
              </select>
            </label>
            {row.window_id === "other" ? (
              <TextArea value={row.location_note || ""} onChange={(v) => patch(i, { location_note: v })} rows={2}
                ariaLabel="Window location" placeholder="Required — where is it? (e.g. basement north wall, second from left)" />
            ) : null}
            {spec?.needsDimensions ? (
              <div className="space-y-2">
                <div>
                  <Label>Current framed opening (in)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" inputMode="decimal" min="0" step="0.125" value={row.current_width ?? ""} onChange={(e) => patch(i, { current_width: e.target.value })} placeholder="Width" aria-label="Current width" className={inputClass} style={fieldStyle} />
                    <input type="number" inputMode="decimal" min="0" step="0.125" value={row.current_height ?? ""} onChange={(e) => patch(i, { current_height: e.target.value })} placeholder="Height" aria-label="Current height" className={inputClass} style={fieldStyle} />
                  </div>
                </div>
                <div>
                  <Label>Required per the ordered unit (in)</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" inputMode="decimal" min="0" step="0.125" value={row.required_width ?? ""} onChange={(e) => patch(i, { required_width: e.target.value })} placeholder="Width" aria-label="Required width" className={inputClass} style={fieldStyle} />
                    <input type="number" inputMode="decimal" min="0" step="0.125" value={row.required_height ?? ""} onChange={(e) => patch(i, { required_height: e.target.value })} placeholder="Height" aria-label="Required height" className={inputClass} style={fieldStyle} />
                  </div>
                  {required ? <p className="mt-1 text-[12px]" style={{ color: MUT }}>Ordered unit: {required.width ?? "?"} × {required.height ?? "?"} {required.units}{required.dimension_basis ? ` (${required.dimension_basis.replace("_", " ")})` : ""}</p> : null}
                </div>
              </div>
            ) : null}
            {spec?.needsSource ? (
              <label className="block">
                <Label as="span">Delivery / source</Label>
                <select value={row.source ?? ""} onChange={(e) => patch(i, { source: e.target.value })} className={inputClass} style={fieldStyle}>
                  {WINDOW_SOURCES.map((s) => <option key={s.key || "unknown"} value={s.key}>{s.label}</option>)}
                </select>
              </label>
            ) : null}
            {spec?.needsInstalledAnyway ? (
              <div>
                <Label>Installed anyway?</Label>
                <Segmented ariaLabel="Installed anyway" value={row.installed_anyway === true ? "yes" : row.installed_anyway === false ? "no" : ""}
                  onChange={(v) => patch(i, { installed_anyway: v === "yes" })}
                  options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
              </div>
            ) : null}
            <TextArea value={row.note || ""} onChange={(v) => patch(i, { note: v })} rows={2} ariaLabel={`Item ${i + 1} notes`}
              placeholder={spec?.needsNote ? "Required — what needs clarifying?" : "Notes (optional)"} />
            {spec?.needsRecipients ? <p className="text-[12px]" style={{ color: MUT }}>This creates a review item for the people you pick below.</p> : null}
          </div>
        );
      })}
      <AddAnother onClick={() => add({ kind: kinds[0].key, window_id: "", note: "", source: "" })} label={rows.length ? "Add another window item" : "Add a window item"} />
    </Card>
  );
}

// ── Sheetrock Window Install ───────────────────────────────────────────────────
export function SheetrockSection({ value, onChange }) {
  const { rows, patch } = listOps(value, onChange);
  const pick = (spec, on) => {
    if (on) onChange([...rows, { key: spec.key, label: spec.label, note: "" }]);
    else onChange(rows.filter((r) => r.key !== spec.key));
  };
  return (
    <Card title="What happened with the sheetrock window?" hint="Pick everything that applies.">
      {SHEETROCK_OUTCOMES.map((spec) => {
        const i = rows.findIndex((r) => r.key === spec.key);
        const on = i >= 0;
        return (
          <CheckRow key={spec.key} checked={on} onChange={(c) => pick(spec, c)} label={spec.label}
            sub={spec.reschedules ? "Marks the visit as needing rescheduling and routes follow-up" : undefined}>
            <TextArea value={on ? rows[i].note || "" : ""} onChange={(v) => patch(i, { note: v })} rows={2} ariaLabel={`${spec.label} note`} placeholder="Notes (optional)" />
          </CheckRow>
        );
      })}
    </Card>
  );
}

// ── Service: parts, screens, cannot-fix ────────────────────────────────────────
export function PartsNeededSection({ value, onChange }) {
  return (
    <Card title="Parts needed" hint="Type or dictate it — whatever has to be ordered or brought back.">
      <TextArea value={value} onChange={onChange} rows={3} ariaLabel="Parts needed" placeholder="e.g. two 36x48 half screens, one cam lock, white" />
    </Card>
  );
}

export function ScreenIssuesSection({ value, onChange }) {
  const { rows, add, patch, remove } = listOps(value, onChange);
  return (
    <Card title="Screen issues" hint="Quantity and where they go. Add another item for each different screen problem.">
      {rows.map((row, i) => (
        <div key={i} className="space-y-2 rounded-[10px] p-2.5" style={{ border: `1px solid ${LINE}` }}>
          <RowHeader title={`Screen item ${i + 1}`} onRemove={() => remove(i)} />
          <label className="block">
            <Label as="span">Problem</Label>
            <select value={row.kind} onChange={(e) => patch(i, { kind: e.target.value })} className={inputClass} style={fieldStyle}>
              {SCREEN_ISSUE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <label className="block">
              <Label as="span">Qty</Label>
              <input type="number" inputMode="numeric" min="1" step="1" value={row.quantity ?? ""} onChange={(e) => patch(i, { quantity: e.target.value })} aria-label="Screen quantity" className={inputClass} style={fieldStyle} />
            </label>
            <label className="block">
              <Label as="span">Location</Label>
              <input type="text" value={row.location || ""} onChange={(e) => patch(i, { location: e.target.value })} placeholder="e.g. upstairs front bedroom" aria-label="Screen location" className={inputClass} style={fieldStyle} />
            </label>
          </div>
          <TextArea value={row.note || ""} onChange={(v) => patch(i, { note: v })} rows={2} ariaLabel={`Screen item ${i + 1} notes`} placeholder="Notes (optional)" />
        </div>
      ))}
      <AddAnother onClick={() => add({ kind: SCREEN_ISSUE_KINDS[0].key, quantity: 1, location: "", note: "" })} label={rows.length ? "Add another screen item" : "Add a screen item"} />
    </Card>
  );
}

export function CannotFixSection({ windows, value, onChange }) {
  const { rows, add, patch, remove } = listOps(value, onChange);
  const options = [...(windows || []), { id: "other", label: "Other / cannot identify the unit" }];
  return (
    <Card title="Could not fix a window" hint="Each one goes to a manager for investigation / review.">
      {rows.map((row, i) => (
        <div key={i} className="space-y-2 rounded-[10px] p-2.5" style={{ border: `1px solid ${LINE}` }}>
          <RowHeader title={`Window ${i + 1}`} onRemove={() => remove(i)} />
          <label className="block">
            <Label as="span">Affected window</Label>
            <select value={row.window_id || ""} onChange={(e) => patch(i, { window_id: e.target.value, window_label: (options.find((o) => o.id === e.target.value) || {}).label || "" })} className={inputClass} style={fieldStyle}>
              <option value="">Pick a window…</option>
              {options.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </label>
          <TextArea value={row.note || ""} onChange={(v) => patch(i, { note: v })} rows={3} ariaLabel={`Window ${i + 1} problem`} placeholder="Required — what is wrong and what you tried" />
        </div>
      ))}
      <AddAnother onClick={() => add({ window_id: "", note: "", needs_manager_review: true })} label={rows.length ? "Add another window" : "Add a window we could not fix"} />
    </Card>
  );
}

// ── Repeatable checklist items (Service, Installer Error) ──────────────────────
export function ChecklistSection({ eventType, value, onChange }) {
  const vocab = checklistItemsFor(eventType);
  if (!vocab.length) return null;
  const { rows, patch } = listOps(value, onChange);
  const pick = (spec, on) => {
    if (on) onChange([...rows, { key: spec.key, label: spec.label, note: "", follow_up: false }]);
    else onChange(rows.filter((r) => r.key !== spec.key));
  };
  return (
    <Card title={eventType === "installer_error" ? "What was corrected" : "Issues found"} hint="Tick each one and add a note. Photos for all of them go in one place at the end.">
      {vocab.map((spec) => {
        const i = rows.findIndex((r) => r.key === spec.key);
        const on = i >= 0;
        return (
          <CheckRow key={spec.key} checked={on} onChange={(c) => pick(spec, c)} label={spec.label}>
            <TextArea value={on ? rows[i].note || "" : ""} onChange={(v) => patch(i, { note: v })} rows={2} ariaLabel={`${spec.label} note`}
              placeholder={spec.needsNote ? "Required — describe it" : "Notes (optional)"} />
            <CheckRow checked={on ? rows[i].follow_up === true : false} onChange={(c) => patch(i, { follow_up: c })} label="Still unresolved — needs follow-up" />
          </CheckRow>
        );
      })}
    </Card>
  );
}

// ── Warranty ───────────────────────────────────────────────────────────────────
export function WarrantySection({ value, onChange }) {
  const v = value || {};
  return (
    <Card title="Issue as reported" hint="What the superintendent or caller said the problem was.">
      <label className="block">
        <Label as="span">Reported by</Label>
        <input type="text" value={v.reported_by || ""} onChange={(e) => onChange({ ...v, reported_by: e.target.value })} placeholder="Superintendent / caller name" aria-label="Reported by" className={inputClass} style={fieldStyle} />
      </label>
      <TextArea value={v.text || ""} onChange={(t) => onChange({ ...v, text: t })} rows={3} ariaLabel="Reported issue" placeholder="What they reported" />
    </Card>
  );
}

// ── Hours + product material (Screen Service, Warranty, Installer Error) ───────
export function HoursMaterialSection({ eventType, materials, hours, onHours, material, onMaterial, longDistance, onLongDistance, showLongDistance, billable }) {
  const step = (d) => onHours(Math.min(24, Math.max(0, Math.round((Number(hours || 0) + d) * 2) / 2)));
  return (
    <Card title="Man-hours and product material"
      hint={billable
        ? "These price the visit from the Hub's pricing rubric."
        : "Installer Error is never charged to the customer. These are kept on the job's internal record only."}>
      <label className="block">
        <Label as="span">Product material</Label>
        <select value={material} onChange={(e) => onMaterial(e.target.value)} className={inputClass} style={fieldStyle}>
          <option value="">Pick…</option>
          {(materials || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      <div>
        <Label>Hours worked</Label>
        <div className="flex items-center gap-2 rounded-[12px] p-1" style={fieldStyle}>
          <button type="button" aria-label="Half hour less" onClick={() => step(-0.5)} className="h-11 w-11 rounded-[9px] text-[20px] font-bold" style={{ backgroundColor: "#E9E2D4", color: INK }}>−</button>
          <span className="flex-1 text-center font-mono-num text-[20px] font-semibold" style={{ color: INK }} aria-live="polite">{Number(hours || 0).toFixed(1)}</span>
          <button type="button" aria-label="Half hour more" onClick={() => step(0.5)} className="h-11 w-11 rounded-[9px] text-[20px] font-bold" style={{ backgroundColor: "#E9E2D4", color: INK }}>+</button>
        </div>
      </div>
      {showLongDistance ? (
        <div>
          <Label>Long distance</Label>
          <Segmented ariaLabel="Long distance" value={longDistance ? "yes" : "no"} onChange={(v) => onLongDistance(v === "yes")}
            options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
        </div>
      ) : null}
      {!billable ? <p className="text-[12.5px]" style={{ color: MUT }}>Internal cost shows as pending until a verified internal labour rate exists; the Hub never uses customer pricing as cost.</p> : null}
    </Card>
  );
}

// ── Shared documentation confirmations (Install, Service) ──────────────────────
export function DocumentationSection({ eventType, hasPatioDoor, onPatioDoor, value, onChange }) {
  const prompts = documentationPrompts(eventType, { hasPatioDoor });
  if (!documentationPrompts(eventType, { hasPatioDoor: true }).length) return null;
  const v = value || {};
  return (
    <Card title="Documentation (optional)" hint="Helpful, never required. A blank box never stops you submitting.">
      <div>
        <Label>Does this house have a patio door?</Label>
        <Segmented ariaLabel="Patio door" value={hasPatioDoor ? "yes" : "no"} onChange={(x) => onPatioDoor(x === "yes")}
          options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
      </div>
      <div className="space-y-2">
        {prompts.map((p) => (
          <CheckRow key={p.key} checked={v[p.key] === true} onChange={(c) => onChange({ ...v, [p.key]: c })} label={p.label} sub="Optional" />
        ))}
      </div>
    </Card>
  );
}

// ── Follow-up recipients ───────────────────────────────────────────────────────
export function RecipientsSection({ people, value, onChange, required, triggers, loading, error }) {
  const ids = Array.isArray(value) ? value : [];
  const toggle = (id, on) => onChange(on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id));
  return (
    <Card title={required ? "Who needs to know? (required)" : "Who needs to know? (optional)"}
      hint={required
        ? `This report needs follow-up: ${triggers.join(", ")}. Pick at least one manager or salesperson — each one gets their own Today item with this report attached.`
        : "Nothing here needs follow-up, so you can leave this empty."}>
      {loading ? <p className="text-[13px]" style={{ color: MUT }}>Loading the team…</p> : null}
      {error ? <p role="alert" className="text-[13px]" style={{ color: "#A43432" }}>{error}</p> : null}
      {!loading && !error && !(people || []).length ? (
        <p className="text-[13px]" style={{ color: "#A43432" }}>No team members are set up to receive follow-up yet. Ask the owner to add them in Todos → Team.</p>
      ) : null}
      <div className="space-y-2">
        {(people || []).map((p) => (
          <CheckRow key={p.id} checked={ids.includes(p.id)} onChange={(c) => toggle(p.id, c)} label={p.display_name}
            sub={p.pending_account ? "No Hub sign-in yet — the item still files for them" : undefined} />
        ))}
      </div>
    </Card>
  );
}
