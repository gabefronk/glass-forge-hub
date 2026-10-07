// Homeowner person-present header action.
//
// The edit button is always available once a person is present, even when the
// job record has no phone or email yet, so "Add phone" stays reachable for a
// source:"job" homeowner with no contact info. The label reflects the source:
// linked = Change, job = Add phone, otherwise Edit.

export function homeownerEditLabel(person) {
  if (!person) return "Edit";
  if (person.source === "linked") return "Change";
  if (person.source === "job") return "Add phone";
  return "Edit";
}

// The edit button is unconditional in the person-present path.
export function showHomeownerEdit(person) {
  return Boolean(person);
}