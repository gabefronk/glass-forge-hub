// Temporary Hub policy: verified job documents are readable by signed-in users.
// Keep all folder writes owner-only in the job-documents handler.
export const canReadJobDocuments = user => Boolean(user);
