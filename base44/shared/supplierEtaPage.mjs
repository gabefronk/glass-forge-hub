// Shared supplier UI: the owner preview uses exactly the public page, with local-only saves.
function portalClient(previewOrders) {
  const preview = Array.isArray(previewOrders);
  const token = new URLSearchParams(location.hash.slice(1)).get('key') || '';
  let orders = previewOrders || [];
  const list = document.getElementById('orders'), notice = document.getElementById('notice');
  const dateText = value => value ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : 'Not confirmed';
  const responseText = row => row.responded_at ? (row.response === 'pending' ? 'Still pending' : 'ETA supplied') + ' · response recorded ' + new Date(row.responded_at).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MT' : 'No supplier-link response yet';
  const el = (tag, cls, content) => { const node = document.createElement(tag); if (cls) node.className = cls; if (content) node.textContent = content; return node; };
  const call = async body => {
    const response = await fetch(location.pathname, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, token }) });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data.error || 'Unable to save. Refresh and try again.');
    return data;
  };
  const render = () => {
    list.replaceChildren();
    document.getElementById('count').textContent = orders.length + (orders.length === 1 ? ' order' : ' orders') + ' to review';
    if (!orders.length) { list.append(el('p', 'empty', 'No open orders are available on this link.')); return; }
    orders.forEach(row => {
      const card = el('article', 'card'), title = el('h2', '', row.job_name);
      card.append(title, el('p', 'refs', [row.po_number, row.quote_number ? 'Quote ' + row.quote_number : '', row.supplier_order ? 'Order ' + row.supplier_order : ''].filter(Boolean).join(' · ')));
      const summary = el('div', 'summary');
      summary.append(el('span', 'eyebrow', 'CURRENT ETA'), el('strong', '', row.response === 'pending' ? 'Awaiting an ETA' : dateText(row.eta_date)));
      if (row.response === 'pending' && row.previous_eta_date) summary.append(el('small', '', 'Previous estimate: ' + dateText(row.previous_eta_date) + ' — awaiting confirmation'));
      summary.append(el('p', 'response', responseText(row)));
      card.append(summary);
      const form = el('form', 'form'), label = el('label', '', 'Estimated ready / delivery date');
      const input = el('input'); input.type = 'date'; input.value = row.eta_date || ''; input.id = 'eta-' + row.id; label.htmlFor = input.id;
      const pendingLabel = el('label', 'pending'), pending = el('input'); pending.type = 'checkbox'; pending.checked = row.response === 'pending';
      pendingLabel.append(pending, document.createTextNode('Still pending — no ETA to confirm yet'));
      const button = el('button', 'save', preview ? 'Try saving response' : 'Save response'); button.type = 'submit';
      const result = el('p', 'result'); result.setAttribute('role', 'status');
      const update = () => { input.disabled = pending.checked; input.required = !pending.checked; }; update();
      pending.onchange = update;
      let request = null;
      form.onsubmit = async event => {
        event.preventDefault(); button.disabled = true; result.textContent = 'Saving…';
        const response = pending.checked ? 'pending' : 'eta', eta_date = pending.checked ? '' : input.value;
        const fingerprint = response + eta_date;
        if (!request || request.fingerprint !== fingerprint) request = { fingerprint, id: crypto.randomUUID() };
        try {
          let saved;
          if (preview) saved = { ...row, response, eta_date, previous_eta_date: row.eta_date || row.previous_eta_date || '', responded_at: new Date().toISOString(), version: 'preview' };
          else saved = (await call({ action: 'save', order_id: row.id, response, eta_date, expected_version: row.version, request_id: request.id })).order;
          Object.assign(row, saved); render();
          notice.textContent = preview ? 'Preview response saved on this page only. Your actual order was not changed.' : 'Response saved. Thank you — Glass Forge can now see your update.';
          notice.className = 'notice success';
        } catch (error) { result.textContent = error.message; }
        finally { button.disabled = false; }
      };
      form.append(label, input, pendingLabel, button, result); card.append(form); list.append(card);
    });
  };
  const load = async () => {
    if (preview) { render(); return; }
    notice.textContent = 'Loading your orders…';
    try {
      const data = await call({ action: 'read' }); orders = data.orders; render();
      notice.textContent = 'Only the orders shared with this link are shown. You can correct an ETA at any time.';
    } catch (error) { orders = []; render(); notice.textContent = error.message; notice.className = 'notice error'; }
  };
  document.getElementById('refresh').onclick = load;
  if (preview) {
    document.getElementById('preview').hidden = false;
    notice.textContent = 'Try an ETA or “still pending.” Preview responses do not change real orders.';
  }
  load();
}
export function supplierEtaHTML({ nonce = '', previewOrders = null } = {}) {
  const data = JSON.stringify(previewOrders).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>AMSCO order updates · Glass Forge</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#153633;font-family:system-ui,-apple-system,sans-serif;font-size:15px}main{max-width:850px;margin:0 auto;padding:32px 20px 60px}.brand{font-size:12px;font-weight:750;letter-spacing:.15em;color:#5f7168;margin-bottom:20px}header{background:#123d38;color:#fff;padding:30px;border-radius:18px}h1{font-size:30px;line-height:1.15;margin:9px 0 12px;letter-spacing:-.03em}header p{color:#d0ded6;line-height:1.6;margin:0}.eyebrow{font-size:10px;font-weight:750;letter-spacing:.12em;display:block}.bar{display:flex;align-items:center;justify-content:space-between;margin:20px 0 12px;gap:12px}.bar button{background:transparent;color:#173d36;border:1px solid #b8c5bb;padding:9px 14px;border-radius:8px;cursor:pointer}.card{background:white;border:1px solid #dedfd3;border-radius:16px;padding:25px;margin-bottom:18px;box-shadow:0 6px 20px #243b3010}h2{font-size:21px;line-height:1.3;margin:0 0 7px;overflow-wrap:anywhere}.refs{color:#647268;font-size:13px;line-height:1.5;margin:0 0 20px}.summary{background:#edf3ec;padding:16px;border-radius:10px}.summary strong{font-size:21px;display:block;margin:6px 0}.summary small{display:block;color:#745d26}.response{font-size:12px;color:#506959;margin:8px 0 0}.form{display:grid;gap:10px;margin-top:21px}.form>label:first-child{font-weight:650;font-size:13px}input[type=date]{font:inherit;padding:11px;border:1px solid #bac9bd;border-radius:8px;background:white;width:100%;max-width:350px;color:#163d35}input:disabled{background:#f1f1ed;color:#888}.pending{display:flex;align-items:center;gap:10px;font-size:13px;line-height:1.5;padding:7px 0}input[type=checkbox]{width:19px;height:19px;accent-color:#16493d}.save{justify-self:start;background:#174d3f;border:0;color:white;font:inherit;font-weight:650;padding:12px 22px;border-radius:9px;cursor:pointer}.save:disabled{opacity:.6;cursor:wait}.notice{font-size:13px;color:#53695a;line-height:1.5;padding:0 0 14px}.notice.success{color:#14633c}.notice.error,.result{color:#9b3330}.result:empty{display:none}.result{margin:0;font-size:13px}.preview{background:#fff1c9;color:#775018;border:1px solid #ead492;padding:12px 16px;border-radius:10px;margin-bottom:18px;font-size:13px}footer{font-size:12px;line-height:1.6;color:#6c7568;margin-top:24px}button:focus-visible,input:focus-visible{outline:3px solid #c39b42;outline-offset:3px}@media(max-width:500px){main{padding:20px 12px}header,.card{padding:21px}h1{font-size:27px}h2{font-size:19px}.save{width:100%}input[type=date]{max-width:none}}</style></head><body><main><div class="brand">GLASS FORGE</div><div id="preview" class="preview" hidden><strong>Owner preview</strong> · Nothing here changes a real order or sends a message.</div><header><span class="eyebrow">AMSCO · ORDER UPDATES</span><h1>A quick ETA check.</h1><p>Confirm a date when you have one, or let us know it’s still pending.<br>Thanks for keeping us in the loop, Steve.</p></header><div class="bar"><strong id="count">Your orders</strong><button id="refresh" type="button">Refresh</button></div><p id="notice" class="notice" role="status"></p><section id="orders" aria-label="Shared orders"></section><footer>Dates are estimates for material readiness or delivery, not confirmation that material has arrived. No payment or order placement happens here.<br>This private link only opens the orders Glass Forge selected. Please don’t forward it.</footer></main><script nonce="${nonce}">(${portalClient.toString()})(${data});</script></body></html>`;
}
