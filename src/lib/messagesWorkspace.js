const VIEWS = new Set(['bluebubbles', 'inbox', 'assistant']);

export function resolveMessagesView(params) {
  const explicit = params.get('view');
  if (VIEWS.has(explicit)) return explicit;
  return ['conversation', 'job', 'contact'].some(key => params.get(key)) ? 'inbox' : 'bluebubbles';
}

export function backgroundMessageIssue({bridgeDevices = [], assistantDevices = [], cases = [], bridgeError = '', assistantError = '', now = Date.now()} = {}) {
  if (bridgeError || assistantError) return {view: bridgeError ? 'inbox' : 'assistant', message: 'The background connection needs a check.'};
  const stalled = device => {
    const last = Date.parse(device.last_seen_at || '');
    return device.enabled && (device.last_error || !Number.isFinite(last) || now - last > 10 * 60 * 1000);
  };
  if (bridgeDevices.some(device => stalled(device) || (device.enabled && device.source_ok === false))) {
    return {view: 'inbox', message: 'The Mac message connection needs attention.'};
  }
  if (assistantDevices.some(stalled)) return {view: 'assistant', message: 'The background assistant needs attention.'};
  if (cases.some(item => item.result?.missing_info?.length && !['completed', 'dismissed'].includes(item.status))) {
    return {view: 'assistant', message: 'A service request needs a detail from you.'};
  }
  return null;
}
