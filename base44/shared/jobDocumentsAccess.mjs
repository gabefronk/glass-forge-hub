// Temporary Hub policy: all signed-in users may read and link verified job folders.
// Tighten this predicate at crew onboarding for folder-link writes.
export const canReadJobDocuments = user => Boolean(user);
export const canWriteJobDocuments = user => Boolean(user);
