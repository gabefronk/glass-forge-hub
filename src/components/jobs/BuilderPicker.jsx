import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const CASH_BUILDER = "Cash customer";
const OTHER = "__other__";
const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none sm:text-sm";
const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

// One place to choose a builder: the builders already mapped on your jobs, a
// cash customer for the odd job that never goes through a GC, and a free-text
// "other" so a brand-new builder can still be typed in.
export default function BuilderPicker({ value, onChange, builders = [] }) {
  const known = builders.filter((b) => !same(b, CASH_BUILDER));
  const listed = known.find((b) => same(b, value));
  const custom = Boolean(value) && !listed && !same(value, CASH_BUILDER);
  const [typing, setTyping] = useState(custom);
  const choice = typing ? OTHER : listed || (same(value, CASH_BUILDER) ? CASH_BUILDER : "none");
  const pick = (next) => {
    if (next === OTHER) { setTyping(true); onChange(""); return; }
    setTyping(false);
    onChange(next === "none" ? "" : next);
  };
  return (
    <div>
      <Select value={choice} onValueChange={pick}>
        <SelectTrigger id="new-job-builder" aria-label="Builder" className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base sm:text-sm">
          <SelectValue placeholder="Not set" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="none">Not set</SelectItem>
          <SelectItem value={CASH_BUILDER}>{CASH_BUILDER}</SelectItem>
          {known.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          <SelectItem value={OTHER}>Other builder (type it)</SelectItem>
        </SelectContent>
      </Select>
      {typing && <input autoFocus className={inputClass} placeholder="New builder name" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}