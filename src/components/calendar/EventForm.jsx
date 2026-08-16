import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const selectCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function Field({ label, children, className }) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export default function EventForm({ initial, jobs, onSave, onCancel, saving }) {
  const [f, setF] = useState({
    event_date: initial?.event_date || "",
    start_time: initial?.start_time || "",
    job_name: initial?.job_name || "",
    builder: initial?.builder || "",
    address: initial?.address || "",
    scope_notes: initial?.scope_notes || "",
    labor_amt: initial?.labor_amt ?? "",
    crew: initial?.crew || "",
    prerequisites: initial?.prerequisites || "",
    job_id: initial?.job_id || "",
  });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Field label="Date"><Input type="date" required value={f.event_date} onChange={set("event_date")} /></Field>
        <Field label="Start time"><Input type="time" value={f.start_time} onChange={set("start_time")} /></Field>
        <Field label="Job name" className="md:col-span-2"><Input required value={f.job_name} onChange={set("job_name")} /></Field>
        <Field label="Builder"><Input value={f.builder} onChange={set("builder")} /></Field>
        <Field label="Crew"><Input value={f.crew} onChange={set("crew")} /></Field>
        <Field label="Labor $"><Input type="number" step="0.01" value={f.labor_amt} onChange={set("labor_amt")} placeholder="0" /></Field>
        <Field label="Job link">
          <select value={f.job_id} onChange={set("job_id")} className={selectCls}>
            <option value="">—</option>
            {jobs.map((j) => <option key={j.id} value={j.id}>{j.canonical_name}</option>)}
          </select>
        </Field>
        <Field label="Address" className="md:col-span-2"><Input value={f.address} onChange={set("address")} /></Field>
        <Field label="Scope notes (crew-safe)" className="md:col-span-4"><Textarea rows={3} value={f.scope_notes} onChange={set("scope_notes")} /></Field>
        <Field label="Prerequisites (forklift, access, materials)" className="md:col-span-4"><Textarea rows={2} value={f.prerequisites} onChange={set("prerequisites")} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : initial?.id ? "Update & push" : "Create & push"}</Button>
      </div>
    </form>
  );
}