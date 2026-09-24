// GF Quoting Engine - Hub server function (branch: window-quoting-entities)
// AMSCO: formula engine on DimPricing ceiling grid (validated 16/16 exact offline).
// Pella: empirical anchor lookup with confidence bands. No external calls - catalog data only.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

function rnd01(x){ return Math.ceil(Number((x*10).toFixed(6)))/10; }
function frameArea(tw, th){ return Math.ceil(tw*th/144); }

function ceilCell(gridRows, code, w, h){
  const cells = gridRows.filter(r => r.price_code === code);
  if(!cells.length) return { cw:null, ch:null, base:null };
  const ws = [...new Set(cells.map(c=>c.max_width))].sort((a,b)=>a-b);
  const hs = [...new Set(cells.map(c=>c.max_height))].sort((a,b)=>a-b);
  const cw = ws.find(x => x >= w - 1e-9) ?? null;
  const ch = hs.find(x => x >= h - 1e-9) ?? null;
  if(cw === null || ch === null) return { cw, ch, base:null };
  const hit = cells.find(c => Math.abs(c.max_width-cw)<1e-9 && Math.abs(c.max_height-ch)<1e-9);
  return { cw, ch, base: hit ? hit.base_price : null };
}

function priceAmsco(line, gridRows, adders, tiers, seriesRows){
  const series = seriesRows.find(s => s.vendor==='AMSCO' && s.series_name===line.product);
  if(!series) return { error:'unknown AMSCO product', product:line.product };
  const code = series.price_code;
  const { cw, ch, base } = ceilCell(gridRows, code, line.width, line.height);
  if(base === null) return { error:'over-grid', grid_code:code, cell:[cw,ch] };
  const cf = (series.color_factors && series.color_factors[line.ext_color]) ?? 1.0;
  let listp = rnd01(base*cf);
  const fa = frameArea(cw, ch);
  const applied = {};
  const add = (key, rate, unit) => { if(!rate) return; applied[key] = unit==='sf' ? rnd01(fa*rate) : rate; };
  if(line.tempered) add('tempered', (adders.find(a=>a.name==='tempered')||{}).rate ?? 14.60, 'sf');
  if(line.debris && line.debris!=='None'){
    const d = adders.find(a=>a.name==='debris_protect');
    const rate = d && d.notes ? (JSON.parse(d.notes)[line.debris] ?? 0) : ({Both:3.70,Inside:1.90,Outside:1.90}[line.debris] ?? 0);
    add('debris', rate, 'sf');
  }
  if(line.grille_igai){
    const g = adders.find(a=>a.name==='grille_igai');
    const table = g && g.notes ? JSON.parse(g.notes) : {1:3.30,2:4.20,3:8.50,4:9.80,9:52.00,11:57.20};
    add('grille', table[String(line.grille_igai)] ?? 37.70, 'sf');
  }
  listp = Math.round((listp + Object.values(applied).reduce((a,b)=>a+b,0))*100)/100;
  const tier = tiers.find(t=>t.tier_code==='VMULT');
  const df = tier ? tier.factor : 0.4556;
  const dealer = Math.round(listp*df*100)/100;
  const qty = line.qty ?? 1;
  return { grid_code:code, cell:[cw,ch], base, color_factor:cf, frame_area_sf:fa, adders:applied,
           unit_list:listp, unit_dealer:dealer, qty,
           line_list:Math.round(listp*qty*100)/100, line_dealer:Math.round(dealer*qty*100)/100,
           evidence:'grid_formula', confidence:'high', vendor:'AMSCO' };
}

function strSim(a,b){
  a=(a||'').toLowerCase(); b=(b||'').toLowerCase();
  if(a===b) return 1;
  const set=new Set(a.split(/\s+/).filter(Boolean));
  const ws=b.split(/\s+/).filter(Boolean);
  const inter=ws.filter(w=>set.has(w)).length;
  return inter/Math.max(set.size, ws.length, 1);
}

function pricePella(line, anchors){
  const cand = anchors.filter(u => u.series && u.series.toLowerCase() === String(line.series||'').toLowerCase());
  if(!cand.length) return { error:'no anchors for series', series:line.series, vendor:'Pella' };
  const qty = line.qty ?? 1;
  const exact = cand.filter(u => Math.abs(u.width-line.width)<0.01 && Math.abs(u.height-line.height)<0.01);
  if(exact.length){
    exact.sort((x,y)=>strSim(y.description,line.description)-strSim(x.description,line.description));
    const best = exact[0];
    const prices = [...new Set(exact.map(u=>u.list_price))];
    const out = { unit_list:best.list_price, qty, line_list:Math.round(best.list_price*qty*100)/100,
      anchor:best.description, source:best.source_anchor, evidence:'empirical_anchor',
      confidence:'high', vendor:'Pella' };
    if(prices.length>1){
      const lo=Math.min(...prices), hi=Math.max(...prices);
      if((hi-lo)/lo>0.01){
        out.anchor_conflict={min:lo,max:hi,count:prices.length,
          note:'multiple anchors at these dims differ on price (uncaptured options); verify against full spec'};
        out.confidence='medium';
      }
    }
    return out;
  }
  const area = line.width*line.height;
  const scored = cand.map(u=>({u, dev:Math.abs(u.width*u.height-area)/area, sim:strSim(u.description,line.description)}));
  scored.sort((x,y)=>(x.dev-y.dev)||(y.sim-x.sim));
  const best = scored[0].u;
  const ua = best.width*best.height;
  const est = Math.round(best.list_price*(area/ua)*100)/100;
  const dev = scored[0].dev;
  return { unit_list_estimated:est, qty, line_list_estimated:Math.round(est*qty*100)/100,
    anchor:best.description, anchor_dims:[best.width,best.height], size_deviation:Math.round(dev*1000)/1000,
    confidence: dev<0.25?'medium':'low', evidence:'empirical_interp', estimated:true, vendor:'Pella' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const lines = body.lines || [];
    const [seriesRows, gridRows, adders, tiers, pellaAnchors] = await Promise.all([
      base44.asServiceRole.entities.CatalogSeries.list('-created_date', 500),
      base44.asServiceRole.entities.PriceGridRow.list('-created_date', 5000),
      base44.asServiceRole.entities.PriceAdder.list('-created_date', 200),
      base44.asServiceRole.entities.TierDiscount.list('-created_date', 50),
      base44.asServiceRole.entities.PellaEmpiricalPrice.list('-created_date', 2000),
    ]);
    const results = lines.map(line =>
      line.vendor === 'AMSCO'
        ? { ...line, pricing: priceAmsco(line, gridRows, adders, tiers, seriesRows) }
        : { ...line, pricing: pricePella(line, pellaAnchors) }
    );
    return Response.json({ ok:true, results });
  } catch (error) {
    return Response.json({ ok:false, error: error.message }, { status: 500 });
  }
});