import { useState } from "react";
import { Smartphone } from "lucide-react";
import { ASSIGNABLE_CONTACT_ROLES, ROLE_LABELS } from "@/lib/jobContacts";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none sm:text-sm";

// The phone's own address book (Contact Picker API). Android Chrome only, over
// HTTPS, and it must be a real tap - so the button appears just where it works.
const phoneBook = () => (typeof navigator !== "undefined" && navigator.contacts?.select ? navigator.contacts : null);

export default function NewJobContactFields({ value, onChange, role, onRole }) {
  const [pickerError, setPickerError] = useState("");
  const canPick = Boolean(phoneBook());
  const set = (key, v) => onChange({ ...value, [key]: v });

  const addFromPhone = async () => {
    const book = phoneBook();
    if (!book) return;
    setPickerError("");
    try {
      const [picked] = await book.select(["name", "tel", "email"], { multiple: false });
      if (!picked) return;
      const [first, ...rest] = String(picked.name?.[0] || "").trim().split(/\s+/);
      onChange({
        ...value,
        first_name: first || value.first_name,
        last_name: rest.join(" ") || value.last_name,
        email: picked.email?.[0] || value.email,
        phone: picked.tel?.[0] || value.phone,
      });
    } catch { setPickerError("Phone contacts were not shared."); }
  };

  return (
    <div className="mt-2">
      {canPick && (
        <div className="mb-2">
          <button type="button" onClick={addFromPhone} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 px-3 text-xs font-semibold">
            <Smartphone className="h-4 w-4" /> Add from phone contacts
          </button>
          {pickerError && <p className="mt-1 text-xs text-amber-700">{pickerError}</p>}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs">First name<input className={inputClass} value={value.first_name} onChange={(e) => set("first_name", e.target.value)} /></label>
        <label className="text-xs">Last name<input className={inputClass} value={value.last_name} onChange={(e) => set("last_name", e.target.value)} /></label>
        <label className="text-xs">Email<input className={inputClass} type="email" value={value.email} onChange={(e) => set("email", e.target.value)} /></label>
        <label className="text-xs">Phone<input className={inputClass} type="tel" value={value.phone} onChange={(e) => set("phone", e.target.value)} /></label>
        <label className="text-xs sm:col-span-2">Builder<input className={inputClass} value={value.builder} onChange={(e) => set("builder", e.target.value)} /></label>
      </div>
      <label className="mt-2 block text-xs">Role for new contact<select className={inputClass} value={role} onChange={(e) => onRole(e.target.value)}><option value="">Choose role</option>{ASSIGNABLE_CONTACT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></label>
      <p className="mt-2 text-xs">An existing email or phone must be selected from the picker instead of creating a duplicate.</p>
    </div>
  );
}