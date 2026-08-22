import { Check as CheckIcon } from "lucide-react";
import { C } from "@/lib/feeUI";

export default function CheckBox({ checked, onChange, indeterminate }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className="flex items-center justify-center w-4 h-4 rounded border transition-colors shrink-0 cursor-pointer"
      style={{
        backgroundColor: checked ? C.accent : indeterminate ? C.accent18 : "transparent",
        borderColor: checked || indeterminate ? C.accent : C.mutedText,
      }}
    >
      {checked && <CheckIcon className="h-3 w-3" style={{ color: C.accentDark }} />}
      {indeterminate && !checked && <div className="w-2 h-0.5 rounded" style={{ backgroundColor: C.accent }} />}
    </button>
  );
}