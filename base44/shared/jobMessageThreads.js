const phoneKey = value => String(value || '').replace(/\D/g, '').slice(-10);
const emailKey = value => String(value || '').trim().toLowerCase();

const participantKeys = participants => (participants || []).flatMap(value => {
  const raw = String(value || '');
  return raw.includes('@') ? [`email:${emailKey(raw)}`] : phoneKey(raw) ? [`phone:${phoneKey(raw)}`] : [];
});

const contactKeys = contact => [contact?.phone_key && `phone:${phoneKey(contact.phone_key)}`, contact?.email_key && `email:${emailKey(contact.email_key)}`].filter(Boolean);

// A contact association is deliberately narrower than a suggestion: one participant identity,
// one directory contact, and one confirmed job link. Anything else stays in owner review.
export function resolveJobMessageThreads({jobId, conversations = [], contacts = [], links = []}) {
  const identities = new Map();
  for (const contact of contacts) for (const key of contactKeys(contact)) {
    if (!identities.has(key)) identities.set(key, []);
    identities.get(key).push(contact.key);
  }
  const jobsByContact = new Map();
  for (const link of links) {
    if (!jobsByContact.has(link.contact_key)) jobsByContact.set(link.contact_key, new Set());
    jobsByContact.get(link.contact_key).add(link.job_id);
  }
  const threads = [], review = [];
  for (const conversation of conversations) {
    if (conversation.job_id === jobId) {
      threads.push({conversation, provenance:{type:'exact_job',label:'Linked directly to this job'}});
      continue;
    }
    // A thread explicitly linked elsewhere is never reassigned through a contact.
    if (conversation.job_id) continue;
    const matched = new Set();
    let sharedIdentity = false;
    for (const key of participantKeys(conversation.participants)) {
      const found = identities.get(key) || [];
      if (found.length > 1) sharedIdentity = true;
      for (const contactKey of found) matched.add(contactKey);
    }
    const eligible = [...matched].filter(key => {
      const jobs = jobsByContact.get(key);
      return jobs?.size === 1 && jobs.has(jobId);
    });
    if (!sharedIdentity && matched.size === 1 && eligible.length === 1) {
      threads.push({conversation,provenance:{type:'confirmed_contact',contact_key:eligible[0],label:'Confirmed contact linked to this job'}});
    } else if (matched.size || sharedIdentity) {
      review.push({conversation_key:conversation.conversation_key,reason:sharedIdentity?'Shared phone or email':matched.size>1?'Multiple contacts':'Contact is linked to multiple or different jobs'});
    }
  }
  return {threads,review};
}
