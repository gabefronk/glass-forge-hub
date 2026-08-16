import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/feeMath";

// Inline editable text/number cell. Save on blur or Enter.
export function EditableText({ value, onCommit, type = "text", className, alignRight, displayFormat }) {
  const [v, setV] = useState(value ?? "");
  const [editing, setEditing] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!editing) setV(value ?? "");
  }, [value, editing]);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const out = type === "number" ? (v === "" ? null : Number(v)) : v;
    if (out !== value) onCommit(out);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        type={type}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setV(value ?? ""); setEditing(false); }
        }}
        className={cn(
          "w-full px-1.5 py-1 rounded border border-ring bg-background outline-none text-sm",
          alignRight && "text-right",
          className
        )}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        "w-full text-left px-1.5 py-1 rounded hover:bg-accent/60 text-sm transition-colors",
        alignRight && "text-right tabular-nums",
        className
      )}
    >
      {value === null || value === undefined || value === "" ? <span className="text-muted-foreground">—</span> : displayFormat === "currency" ? `$${formatMoney(value)}` : String(value)}
    </button>
  );
}

export function EditableSwitch({ checked, onCommit, className }) {
  return (
    <Switch
      checked={!!checked}
      onCheckedChange={(c) => onCommit(c)}
      className={className}
    />
  );
}

export function AdjustedMarker() {
  return (
    <span title="Manually adjusted" className="inline-flex items-center justify-center">
      <Check className="h-3 w-3 text-violet-600" />
    </span>
  );
}