// Shared supplier UI: the owner preview uses exactly the public page, with local-only saves.
function portalClient(previewOrders) {
  const preview = Array.isArray(previewOrders);
  const token = new URLSearchParams(location.hash.slice(1)).get('key') || '';
  let orders = previewOrders || [];
  const list = document.getElementById('orders'), notice = document.getElementById('notice');
  const dateText = value => value ? new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : 'Not confirmed';
  const responseText = row => row.responded_at ? (row.response === 'owner' ? 'Glass Forge reviewed ETA' : row.response === 'pending' ? 'Still pending' : 'ETA supplied') + ' · response recorded ' + new Date(row.responded_at).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' MT' : 'No supplier-link response yet';
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
<style>:root{color-scheme:light;--ink:#122f2c;--muted:#465e58;--accent:#145b4b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 10% 0%,#a6c2b8 0,transparent 48%),radial-gradient(ellipse at 95% 65%,#c1b68f 0,transparent 48%),#d2dbcf;color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:15px;line-height:1.55;min-height:100vh}main{max-width:1060px;margin:0 auto;padding:26px 28px 40px}.brand{text-align:center;font-size:12px;font-weight:800;letter-spacing:.24em;color:#26473f;margin-bottom:17px}.preview{background:#e9dfbd;color:#493e23;border:1px solid #b9aa77;padding:10px 18px;border-radius:10px;margin-bottom:20px;font-size:12px;text-align:center;box-shadow:0 3px 8px #263e3210}header{text-align:center;background:linear-gradient(130deg,#102f2c,#1d5146);color:#fff;padding:34px 26px 32px;border:1px solid #35685a;border-radius:18px;box-shadow:0 14px 28px #173b3429,inset 0 1px #ffffff15;position:relative}header:after{content:"";display:block;width:48px;height:3px;border-radius:2px;background:#d6b875;margin:21px auto 0}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.15em;display:block}header .eyebrow{color:#dec995}h1{font-size:38px;line-height:1.18;margin:10px 0 13px;letter-spacing:-.045em}header p{color:#e2ece5;font-size:15px;line-height:1.75;margin:0}.bar{display:flex;align-items:center;justify-content:space-between;margin:28px 0 9px;gap:12px}.bar strong{font-size:17px;letter-spacing:-.02em}.bar button{background:#e8ede2;color:#20463c;border:1px solid #a5b6a8;padding:9px 16px;border-radius:9px;cursor:pointer;min-height:42px;font:inherit;font-size:12px;font-weight:700;box-shadow:0 3px 6px #1b3c3110}.bar button:hover{background:#f4f4e9}.notice{font-size:12px;color:#385447;line-height:1.6;margin:0 0 19px;min-height:20px}.notice.success{color:#175432;font-weight:600}.notice.error,.result{color:#962d25}.card{display:grid;grid-template-columns:minmax(0,.86fr) minmax(0,1.14fr);column-gap:28px;align-items:start;background:linear-gradient(135deg,#fbfaf2,#eff2e8);border:1px solid #a7b7a5;border-top:4px solid #416d59;border-radius:16px;padding:25px 27px 27px;margin-bottom:23px;box-shadow:0 12px 25px #1b3b3220,0 3px 7px #1b3b3210}h2{grid-column:1/-1;font-size:21px;line-height:1.35;letter-spacing:-.025em;margin:0 0 8px;overflow-wrap:anywhere}.refs{grid-column:1/-1;color:#3d5d50;font-size:12px;font-weight:600;letter-spacing:.01em;line-height:1.7;margin:0 0 22px;padding-bottom:18px;border-bottom:1px solid #c8d2bf;font-variant-numeric:tabular-nums}.summary{background:linear-gradient(140deg,#dce8d8,#d0dfcd);padding:21px;border:1px solid #aec4aa;border-radius:11px;min-height:165px;box-shadow:inset 0 1px #ffffff90}.summary .eyebrow{color:#3c6146;font-size:10px}.summary strong{font-size:25px;line-height:1.25;letter-spacing:-.035em;display:block;margin:10px 0 13px;color:#173e30}.summary small{display:block;font-size:12px;color:#69511d}.response{font-size:12px;color:#3c5843;line-height:1.7;margin:9px 0 0}.form{display:grid;gap:11px;margin:0}.form>label:first-child{font-weight:750;font-size:13px;line-height:1.4}input[type=date]{font:inherit;font-size:15px;padding:11px 14px;border:1px solid #9cae99;border-radius:9px;background:#fffef6;width:100%;height:47px;min-width:0;color:#173b2f;box-shadow:inset 0 2px 3px #1b3c3106}input:disabled{background:#e0e5d9;color:#677662;border-color:#bdcbb6}.pending{display:flex;align-items:center;gap:10px;font-size:12px;line-height:1.5;padding:4px 0;min-height:38px;cursor:pointer;color:#304e40}input[type=checkbox]{width:18px;height:18px;margin:0;flex:0 0 18px;accent-color:var(--accent)}.save{justify-self:stretch;background:linear-gradient(#236a54,#15513f);border:1px solid #104332;color:#fff;font:inherit;font-size:13px;font-weight:750;padding:11px 20px;min-height:45px;border-radius:9px;cursor:pointer;box-shadow:0 4px 8px #17442e24,inset 0 1px #ffffff20;transition:box-shadow .15s,background .15s}.save:hover{background:#103e30;box-shadow:0 5px 12px #17442e35}.save:disabled{opacity:.6;cursor:wait}.result{margin:0;font-size:12px}.result:empty{display:none}footer{text-align:center;font-size:11px;line-height:1.85;color:#3e5344;margin:28px auto 0;max-width:840px}button:focus-visible,input:focus-visible{outline:3px solid #9b7028;outline-offset:3px}@media(max-width:650px){main{padding:20px 16px 30px}.brand{font-size:11px}header{padding:27px 18px}h1{font-size:31px}header p{font-size:14px}.card{grid-template-columns:minmax(0,1fr);gap:0;padding:22px 20px 24px;margin-bottom:21px}h2{font-size:20px}.refs{margin-bottom:18px;padding-bottom:16px;font-size:12px}.summary{min-height:0;padding:18px}.summary strong{font-size:24px;margin-bottom:8px}.form{margin-top:23px}.preview{font-size:11px;padding:10px 12px}.pending{font-size:12px;min-height:44px}.save{min-height:47px}.bar{margin-top:24px}.bar strong{font-size:16px}footer{font-size:11px}}@media(prefers-reduced-motion:reduce){.save{transition:none}}</style></head><body><main><div class="brand">GLASS FORGE</div><div id="preview" class="preview" hidden><strong>Owner preview</strong> · Nothing here changes a real order or sends a message.</div><header><span class="eyebrow">AMSCO · ORDER UPDATES</span><h1>A quick ETA check.</h1><p>Confirm a date when you have one, or let us know it’s still pending.<br>Thanks for keeping us in the loop, Steve.</p></header><div class="bar"><strong id="count">Your orders</strong><button id="refresh" type="button">Refresh</button></div><p id="notice" class="notice" role="status"></p><section id="orders" aria-label="Shared orders"></section><footer>Dates are estimates for material readiness or delivery, not confirmation that material has arrived. No payment or order placement happens here.<br>This private link only opens the orders Glass Forge selected. Please don’t forward it.</footer></main><script nonce="${nonce}">(${portalClient.toString()})(${data});</script></body></html>`;
}
