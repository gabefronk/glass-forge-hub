// The super form's auto-save rule: an entry saves itself once it has a name and
// a full phone or email. Anything less stays unsaved (safe partial entry) with
// the form saying so. Mirrors the backend's contactFields validation.
export const superEntryComplete = (f) =>
  String(f?.name || "").trim().length >= 2 &&
  (String(f?.phone || "").replace(/\D/g, "").length >= 10 ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(f?.email || "").trim()));

export const superEntrySig = (f) =>
  [f?.name, f?.phone, f?.email].map((v) => String(v || "").trim()).join("|");
