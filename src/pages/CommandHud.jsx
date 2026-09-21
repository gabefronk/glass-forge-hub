import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { isAgentCenterOwner } from '@/lib/agentCenterAccess';
import PageNotFound from '@/lib/PageNotFound';
import { base44 } from '@/api/base44Client';

// GLASS FORGE // COMMAND HUD - owner-only page. Non-owners get the plain 404 (PageNotFound),
// so the page is invisible to every other Hub login. Data loads through the signed-in
// session via the SDK - no API token lives in this file. The voice key is per-device
// localStorage, entered by Gabriel himself.

const HUD_CSS = `.command-hud{
  --bg:#060a12; --panel:#0b1220; --panel2:#0e1728; --line:rgba(56,225,255,.16);
  --cyan:#38e1ff; --amber:#ffb020; --mag:#ff3df0; --green:#3dff8e; --red:#ff4d5e; --violet:#9d6bff;
  --ink:#dfe9f5; --dim:#7d8ca3; --faint:#46536b;
}.command-hud, .command-hud *{box-sizing:border-box;margin:0;padding:0}html:has(.command-hud){font-size:clamp(13px,.85vw,18px)}.command-hud{background:var(--bg);color:var(--ink);font-family:'Rajdhani',system-ui,sans-serif;min-height:100vh;overflow-x:hidden}.command-hud::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:99;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.022) 0 1px,transparent 1px 3px)}.command-hud .mono{font-family:'JetBrains Mono',monospace}.command-hud .orb{font-family:'Orbitron',monospace}.command-hud /* ============ VOICE UPLINK ============ */
.vu{display:flex;flex-direction:column;gap:.55rem}.command-hud .vu-row{display:flex;align-items:center;gap:.7rem}.command-hud .vu-btn{width:3.4rem;height:3.4rem;border-radius:50%;border:2px solid var(--cyan);background:rgba(56,225,255,.08);
  color:var(--cyan);font-size:1.35rem;cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:all .15s;flex:none;text-shadow:0 0 12px rgba(56,225,255,.8)}.command-hud .vu-btn:hover{background:rgba(56,225,255,.18)}.command-hud .vu-btn.rec{border-color:var(--red);color:var(--red);background:rgba(255,77,94,.14);animation:vupulse 1.1s infinite}.command-hud .vu-btn:disabled{opacity:.35;cursor:not-allowed}@keyframes vupulse{0%,100%{box-shadow:0 0 0 0 rgba(255,77,94,.5)}50%{box-shadow:0 0 0 9px rgba(255,77,94,0)}}.command-hud .vu-state{font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.18em;color:var(--dim)}.command-hud .vu-state b{color:var(--cyan)}.command-hud .vu-log{background:rgba(0,0,0,.32);border:1px solid var(--line);border-radius:6px;padding:.5rem .65rem;
  font-size:.86rem;min-height:2.6rem;display:flex;flex-direction:column;gap:.3rem}.command-hud .vu-log .who{font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.22em;color:var(--faint)}.command-hud .vu-log .you{color:var(--ink)}.command-hud .vu-log .agent{color:var(--green)}.command-hud .vu-form{display:flex;gap:.45rem}.command-hud .vu-form input{flex:1;background:rgba(0,0,0,.35);border:1px solid var(--line);border-radius:6px;color:var(--ink);
  font-family:'Rajdhani',sans-serif;font-size:.9rem;padding:.42rem .6rem;outline:none}.command-hud .vu-form input:focus{border-color:var(--cyan)}.command-hud .vu-form button{background:rgba(56,225,255,.12);border:1px solid var(--cyan);color:var(--cyan);border-radius:6px;
  font-family:'JetBrains Mono',monospace;font-size:.68rem;letter-spacing:.14em;padding:0 .8rem;cursor:pointer}.command-hud /* ============ HEADER ============ */
header{display:flex;align-items:center;gap:1.4rem;flex-wrap:wrap;padding:1.1rem 1.6rem .9rem;
  border-bottom:1px solid var(--line);
  background:linear-gradient(180deg,rgba(56,225,255,.06),transparent)}.command-hud .brand{font-family:'Orbitron',monospace;font-weight:900;font-size:1.5rem;letter-spacing:.14em;color:#fff}.command-hud .brand b{color:var(--cyan);text-shadow:0 0 18px rgba(56,225,255,.7)}.command-hud .brand small{display:block;font-size:.58rem;letter-spacing:.42em;color:var(--dim);font-weight:500;margin-top:.15rem}.command-hud .clockbox{margin-left:auto;text-align:right}.command-hud .clock{font-family:'JetBrains Mono',monospace;font-size:1.9rem;font-weight:700;color:var(--cyan);text-shadow:0 0 14px rgba(56,225,255,.55);line-height:1}.command-hud .dateline{color:var(--dim);letter-spacing:.22em;font-size:.72rem;text-transform:uppercase;margin-top:.25rem}.command-hud .player{display:flex;align-items:center;gap:.9rem;background:var(--panel);border:1px solid var(--line);
  padding:.55rem 1rem;clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}.command-hud .lvlbadge{font-family:'Orbitron',monospace;font-weight:900;font-size:1.05rem;color:#06121c;background:linear-gradient(135deg,var(--cyan),var(--green));
  padding:.35rem .6rem;clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}.command-hud .xpwrap{width:13rem}.command-hud .xplabel{display:flex;justify-content:space-between;font-size:.68rem;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}.command-hud .xpbar{height:.55rem;background:#101b2e;border:1px solid var(--line);margin-top:.2rem;position:relative;overflow:hidden}.command-hud .xpfill{height:100%;background:linear-gradient(90deg,var(--cyan),var(--green));box-shadow:0 0 12px rgba(61,255,142,.6);transition:width 1s ease;position:relative}.command-hud .xpfill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);
  animation:shimmer 2.6s linear infinite;transform:translateX(-100%)}@keyframes shimmer{to{transform:translateX(100%)}}.command-hud .streak{font-family:'Orbitron',monospace;font-weight:700;font-size:1.05rem;color:var(--amber);text-shadow:0 0 14px rgba(255,176,32,.6);white-space:nowrap}.command-hud /* ============ GRID ============ */
main{display:grid;gap:1.1rem;padding:1.1rem 1.6rem 1.4rem;grid-template-columns:1fr}@media(min-width:1100px){.command-hud main{grid-template-columns:1.05fr 1.35fr 1fr;align-items:start}}@media(min-width:3000px){.command-hud main{grid-template-columns:1fr 1.2fr 1.2fr 1fr}.command-hud .weekrow{grid-column:1/-1}}.command-hud .weekrow{grid-column:1/-1;margin-bottom:0}@media(min-width:1100px){.command-hud .day{min-height:7.5rem}.command-hud .dchip{font-size:.78rem}}.command-hud .panel{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  padding:.95rem 1.05rem 1.05rem;position:relative;margin-bottom:1.1rem;
  clip-path:polygon(14px 0,100% 0,100% calc(100% - 14px),calc(100% - 14px) 100%,0 100%,0 14px)}.command-hud .ptitle{font-family:'Orbitron',monospace;font-size:.82rem;font-weight:700;letter-spacing:.3em;color:var(--cyan);
  text-transform:uppercase;display:flex;align-items:center;gap:.6rem;margin-bottom:.85rem}.command-hud .ptitle::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}.command-hud .ptitle .tag{color:var(--dim);letter-spacing:.15em;font-size:.62rem}.command-hud /* ============ QUEST CARDS ============ */
.quest{display:flex;gap:.8rem;align-items:flex-start;background:rgba(16,27,46,.65);border:1px solid var(--line);
  border-left:3px solid var(--cyan);padding:.65rem .8rem;margin-bottom:.6rem;position:relative}.command-hud .quest.cleared{border-left-color:var(--green);opacity:.62}.command-hud .quest.cleared .qname{text-decoration:line-through}.command-hud .quest.warn{border-left-color:var(--amber)}.command-hud .qnum{font-family:'Orbitron',monospace;font-weight:700;color:var(--faint);font-size:1rem;padding-top:.15rem;min-width:1.6rem}.command-hud .qbody{flex:1;min-width:0}.command-hud .qname{font-weight:700;font-size:1.02rem;color:#fff;line-height:1.15}.command-hud .qmeta{color:var(--dim);font-size:.82rem;margin-top:.15rem;line-height:1.3}.command-hud .qchip{display:inline-block;font-size:.62rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  padding:.1rem .45rem;margin-right:.35rem;border:1px solid currentColor;border-radius:2px}.command-hud .qstatus{font-family:'JetBrains Mono',monospace;font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;
  padding:.28rem .5rem;border:1px solid currentColor;white-space:nowrap}.command-hud .st-active{color:var(--cyan)}.command-hud .st-cleared{color:var(--green)}.command-hud .st-warn{color:var(--amber)}.command-hud .st-bad{color:var(--red)}.command-hud .qxp{font-family:'JetBrains Mono',monospace;font-size:.66rem;color:var(--green);margin-top:.2rem;letter-spacing:.1em}.command-hud .empty{color:var(--faint);font-style:italic;padding:.6rem 0;letter-spacing:.08em}.command-hud /* ============ BOSS ============ */
.boss{border:1px solid rgba(255,77,94,.4);background:linear-gradient(180deg,rgba(80,10,25,.35),var(--panel))}.command-hud .boss .ptitle{color:var(--red)}.command-hud .bossname{font-family:'Orbitron',monospace;font-size:1.25rem;font-weight:900;color:#fff;letter-spacing:.06em}.command-hud .bosshp{display:flex;gap:4px;margin:.7rem 0 .5rem}.command-hud .hpseg{flex:1;height:1.05rem;background:rgba(255,77,94,.85);box-shadow:0 0 8px rgba(255,77,94,.45);
  clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%)}.command-hud .hpseg.dead{background:#141d2e;box-shadow:none}.command-hud .bossmeta{color:var(--dim);font-size:.8rem;letter-spacing:.08em}.command-hud /* ============ FACTION BARS ============ */
.frow{display:grid;grid-template-columns:8.5rem 1fr 3.2rem;align-items:center;gap:.7rem;margin-bottom:.5rem}.command-hud .fname{font-weight:600;font-size:.92rem;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.command-hud .fbar{height:.8rem;background:#101b2e;border:1px solid var(--line);position:relative}.command-hud .ffill{height:100%;box-shadow:0 0 10px currentColor}.command-hud .fcount{font-family:'JetBrains Mono',monospace;text-align:right;font-weight:700}.command-hud /* ============ OUTSTANDING LIST ============ */
.orow{display:flex;align-items:center;gap:.7rem;padding:.42rem .2rem;border-bottom:1px dashed rgba(125,140,163,.18);font-size:.92rem}.command-hud .oname{flex:1;min-width:0;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.command-hud .odays{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;color:var(--amber);white-space:nowrap}.command-hud .odays.hot{color:var(--red)}.command-hud .odate{color:var(--faint);font-size:.74rem;font-family:'JetBrains Mono',monospace;white-space:nowrap}.command-hud /* ============ WEEK ============ */
.week{display:grid;grid-template-columns:repeat(7,1fr);gap:.45rem}.command-hud .day{background:rgba(16,27,46,.6);border:1px solid var(--line);min-height:5.2rem;padding:.4rem .45rem}.command-hud .day.today{border-color:var(--cyan);box-shadow:0 0 14px rgba(56,225,255,.25) inset,0 0 10px rgba(56,225,255,.2)}.command-hud .dhead{font-family:'Orbitron',monospace;font-size:.6rem;letter-spacing:.2em;color:var(--dim);text-transform:uppercase;display:flex;justify-content:space-between}.command-hud .day.today .dhead{color:var(--cyan)}.command-hud .dchip{font-size:.66rem;font-weight:600;margin-top:.3rem;padding:.12rem .3rem;border-left:2px solid var(--cyan);
  background:rgba(56,225,255,.07);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}.command-hud .dchip.done{opacity:.5;text-decoration:line-through;border-left-color:var(--green)}.command-hud .dcount{font-family:'JetBrains Mono',monospace;font-size:.6rem;color:var(--faint);margin-top:.3rem}.command-hud /* ============ CHART ============ */
.chart{display:flex;align-items:flex-end;gap:.35rem;height:6.2rem;padding:.3rem 0 .1rem}.command-hud .cbar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;height:100%}.command-hud .cfill{width:100%;background:linear-gradient(180deg,var(--cyan),rgba(56,225,255,.25));box-shadow:0 0 8px rgba(56,225,255,.3);min-height:2px}.command-hud .cbar.weekend .cfill{background:linear-gradient(180deg,var(--faint),rgba(70,83,107,.2));box-shadow:none}.command-hud .cval{font-family:'JetBrains Mono',monospace;font-size:.62rem;color:var(--dim);margin-bottom:.2rem}.command-hud .clab{font-family:'JetBrains Mono',monospace;font-size:.56rem;color:var(--faint);margin-top:.25rem;letter-spacing:.05em}.command-hud /* ============ ACHIEVEMENTS ============ */
.ach{display:flex;gap:.7rem;align-items:center;padding:.45rem 0;border-bottom:1px dashed rgba(125,140,163,.18)}.command-hud .ach:last-child{border-bottom:none}.command-hud .aicon{font-family:'Orbitron',monospace;font-weight:900;font-size:.72rem;width:2.4rem;height:2.4rem;display:flex;align-items:center;justify:center;color:var(--amber);border:1px solid var(--amber);box-shadow:0 0 10px rgba(255,176,32,.35);clip-path:polygon(6px 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%,0 6px)}.command-hud .ach.locked{opacity:.38}.command-hud .ach.locked .aicon{color:var(--faint);border-color:var(--faint);box-shadow:none}.command-hud .aname{font-weight:700;font-size:.92rem}.command-hud .adesc{color:var(--dim);font-size:.76rem}.command-hud /* ============ STATS ============ */
.stats{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.command-hud .stat{background:rgba(16,27,46,.6);border:1px solid var(--line);padding:.55rem .7rem}.command-hud .sval{font-family:'Orbitron',monospace;font-weight:700;font-size:1.35rem;color:#fff}.command-hud .sval.accent{color:var(--green);text-shadow:0 0 10px rgba(61,255,142,.5)}.command-hud .slab{font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--dim);margin-top:.1rem}.command-hud /* ============ FOOTER ============ */
footer{display:flex;gap:1.5rem;flex-wrap:wrap;align-items:center;padding:.7rem 1.6rem 1rem;border-top:1px solid var(--line);
  color:var(--dim);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase}.command-hud .mode{color:var(--green)}.command-hud .mode.off{color:var(--amber)}.command-hud footer .right{margin-left:auto;font-family:'JetBrains Mono',monospace;text-transform:none;letter-spacing:.05em}.command-hud .pulse{display:inline-block;width:.5rem;height:.5rem;border-radius:50%;background:var(--green);box-shadow:0 0 8px var(--green);
  margin-right:.4rem;animation:pu 2s infinite;vertical-align:middle}.command-hud .mode.off .pulse{background:var(--amber);box-shadow:0 0 8px var(--amber)}@keyframes pu{50%{opacity:.35}}@media (prefers-reduced-motion: reduce){.command-hud, .command-hud *{animation:none!important;transition:none!important}}
.command-hud .vu-hint{font-family:'JetBrains Mono',monospace;font-size:.6rem;letter-spacing:.1em;color:var(--dim);margin-bottom:.4rem;line-height:1.5}
.command-hud .vu-autokey{font-family:'JetBrains Mono',monospace;font-size:.64rem;letter-spacing:.14em;color:var(--green);margin-bottom:.4rem}
/* ============ FIELD ORDERS (TO-DOS) ============ */
.command-hud .tbucket{margin-bottom:.75rem}
.command-hud .tbhead{font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.22em;margin-bottom:.35rem}
.command-hud .tbhead span{color:var(--dim)}
.command-hud .trow{display:flex;align-items:center;gap:.55rem;padding:.42rem .55rem;background:rgba(255,255,255,.028);border:1px solid var(--line);border-radius:5px;margin-bottom:.32rem}
.command-hud .trow.wip{border-color:rgba(255,176,32,.5);background:rgba(255,176,32,.05)}
.command-hud .tdot{width:.45rem;height:.45rem;border-radius:50%;flex:none}
.command-hud .tname{flex:1;font-size:.9rem;line-height:1.25;font-weight:500}
.command-hud .tdue{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:#ffb020;flex:none}
/* ============ ULTRAWIDE SCALE-UP (49in 5120x1440 command wall) ============ */
.command-hud{width:100%;min-height:100%}
@media(min-width:2200px){html:has(.command-hud){font-size:21px}}
@media(min-width:3000px){html:has(.command-hud){font-size:24px}}
@media(min-width:3000px){.command-hud main{grid-template-columns:.95fr 1.35fr 1.05fr}}
@media(min-width:4200px){
  html:has(.command-hud){font-size:27px}
  .command-hud main{grid-template-columns:.95fr 1.35fr 1.05fr;gap:1.3rem;padding:1.3rem 1.9rem 1.5rem}
  .command-hud .day{min-height:9.5rem}
  .command-hud .quest,.command-hud .orow,.command-hud .ach{margin-bottom:.6rem}
}
`;

const HUD_MARKUP = `<header>
  <div class="brand"><b>GLASS FORGE</b> // COMMAND HUD<small>YA WINDOWS + DOORS · FIELD OPERATIONS</small></div>
  <div class="player">
    <div class="lvlbadge" id="lvl">LV 1</div>
    <div class="xpwrap">
      <div class="xplabel"><span id="xptext">0 XP</span><span id="xpnext"></span></div>
      <div class="xpbar"><div class="xpfill" id="xpfill" style="width:0%"></div></div>
    </div>
    <div class="streak" id="streak">STREAK ×0</div>
  </div>
  <div class="clockbox">
    <div class="clock" id="clock">--:--:--</div>
    <div class="dateline" id="dateline"></div>
  </div>
</header>
<main>
  <div class="col" id="col-missions">
    <div class="panel"><div class="ptitle">Field Orders <span class="tag" id="ordertag">to-do ops</span></div><div id="todos"></div></div>
    <div class="panel"><div class="ptitle">Today's Missions <span class="tag" id="todaytag"></span></div><div id="today"></div></div>
    <div class="panel"><div class="ptitle">Tomorrow <span class="tag">recon</span></div><div id="tomorrow"></div></div>
  </div>
  <div class="col" id="col-ops">
    <div class="panel boss" id="bosspanel"><div class="ptitle">Boss Fight <span class="tag">clear outstanding reports to deal damage</span></div><div id="boss"></div></div>
    <div class="panel"><div class="ptitle">Field Report Ops <span class="tag" id="opstag"></span></div>
      <div id="factions"></div>
      <div style="height:.7rem"></div>
      <div id="outstanding" style="max-height:26rem;overflow-y:auto;padding-right:.4rem"></div>
    </div>
    <div class="panel"><div class="ptitle">Reports Cleared <span class="tag">last 14 days</span></div><div class="chart" id="chart"></div></div>
  </div>
  <div class="col" id="col-side">
    <div class="panel" id="vupanel"><div class="ptitle">Voice Uplink <span class="tag" id="vutag">probing</span></div>
      <div class="vu">
        <div class="vu-row">
          <button class="vu-btn" id="vumic"<button class="vu-btn" id="vuspkr" title="speaker on/off" style="font-size:.7rem;letter-spacing:.1em">SPKR ON</button> title="Push to talk">&#127908;</button>
          <div class="vu-state" id="vustate">VOICE LINK <b>CHECKING</b></div>
        </div>
        <div class="vu-log" id="vulog"><div class="who">SYSTEM</div><div class="agent">Voice channel standing by.</div></div>
        <form class="vu-form" id="vuform"><input id="vutext" placeholder="type to Instinct - or just talk&hellip;" autocomplete="off"><button type="submit">SEND</button><button type="button" id="vuclear" title="clear conversation">&#10005;</button></form>
        <div class="vu-hint">hands-free - listens while this tab is open; say "stop" to stop. Keep the tab visible: Chrome can freeze hidden tabs.</div><form class="vu-form" id="vukeyform"><input id="vukey" type="password" placeholder="voice key (stored on this device only)" autocomplete="off"><button type="submit">SET</button></form>
      </div>
    </div>
    <div class="panel"><div class="ptitle">Stats</div><div class="stats" id="stats"></div></div>
    <div class="panel"><div class="ptitle">Achievements</div><div id="ach"></div></div>
  </div>
  <div class="panel weekrow"><div class="ptitle">Week Grid <span class="tag" id="weektag"></span></div><div class="week" id="week"></div></div>
</main>
<footer>
  <span class="mode" id="mode"><span class="pulse"></span>LIVE LINK</span>
  <span id="fresh"></span>
  <span>Source: Glass Forge Hub (Base44) · read-only</span>
  <span class="right" id="sync"></span>
</footer>`;

function bootHud(base44) {
  const OUT_STATUSES = ["pending","missing_photos","missing_notes","missing_all","rescheduled"];
  const SLIM = ['id','event_date','start_time','end_time','builder','job_name','address','crew','report_status','report_required','labor_amt','days_late','organizer','job_id','po_number','oe_number'];

  function denverNow(){ return new Date(new Date().toLocaleString('en-US',{timeZone:'America/Denver'})); }
  function iso(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function todayISO(){ return iso(denverNow()); }
  function addDays(isoStr,n){ const d=new Date(isoStr+'T12:00:00'); d.setDate(d.getDate()+n); return iso(d); }
  function dow(isoStr){ return new Date(isoStr+'T12:00:00').getDay(); }
  const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DN=['SUN','MON','TUE','WED','THU','FRI','SAT'];
  function fmtD(isoStr){ const p=isoStr.split('-'); return DN[dow(isoStr)]+' '+MN[+p[1]-1]+' '+(+p[2]); }

  const PALETTE=['#38e1ff','#ffb020','#ff3df0','#3dff8e','#9d6bff','#ff8a5c','#5ca8ff','#ffe93d','#3dffc8','#ff5c8a'];
  function factionColor(b){ let h=0; const s=b||'?'; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return PALETTE[h%PALETTE.length]; }
  function esc(s){ return (s==null?'':String(s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function factionOf(e){ if(e.builder) return e.builder; const n=e.job_name||''; return /^ya\b/i.test(n.trim())||/^ya\s*-/i.test(n.trim())?'YA Direct':'Unaffiliated'; }
  function shortName(e){ return (e.job_name||'(untitled)').replace(/^YA\s*-\s*/i,''); }

  function compute(events, photosTotal){
    const today=todayISO();
    const tmr=addDays(today,1);
    const active=events.filter(e=>e.event_date>=today);
    const todayQ=events.filter(e=>e.event_date===today).sort((a,b)=>(a.start_time||'99')<(b.start_time||'99')?-1:1);
    const tmrQ=events.filter(e=>e.event_date===tmr);
    const outstanding=events.filter(e=>e.report_required!==false && OUT_STATUSES.includes(e.report_status) && e.event_date<=today && e.event_date>='2026-09-01')
      .sort((a,b)=>a.event_date<b.event_date?-1:1);
    const ok=events.filter(e=>e.report_status==='ok');
    // cleared per day (14d)
    const cleared={}; ok.forEach(e=>{cleared[e.event_date]=(cleared[e.event_date]||0)+1;});
    // streak: consecutive days ending at most recent ok day
    const okDays=[...new Set(ok.map(e=>e.event_date))].sort().reverse();
    let streak=0; if(okDays.length){ let cur=okDays[0]; streak=1; while(okDays.includes(addDays(cur,-1))){ cur=addDays(cur,-1); streak++; } }
    const xp = ok.length*100 + (photosTotal||0)*1 + streak*50;
    const perLevel=2500, level=Math.floor(xp/perLevel)+1, into=xp%perLevel;
    // factions
    const byB={}; outstanding.forEach(e=>{const b=factionOf(e); byB[b]=(byB[b]||0)+1;});
    const factions=Object.entries(byB).sort((a,b)=>b[1]-a[1]);
    // week grid (Mon..Sun)
    const d=dow(today); const monday=addDays(today, d===0?-6:1-d);
    const week=[]; for(let i=0;i<7;i++){ const day=addDays(monday,i); week.push({date:day, events:events.filter(e=>e.event_date===day)}); }
    return {today,tmr,todayQ,tmrQ,outstanding,ok,cleared,streak,xp,level,into,perLevel,factions,week,photosTotal:photosTotal||0};
  }

  function questHTML(e,i){
    const st=e.report_status;
    const cleared=st==='ok';
    const cls=cleared?'quest cleared':(OUT_STATUSES.includes(st)&&st!=='pending'?'quest warn':'quest');
    const stTag=cleared?['st-cleared','CLEARED']:(st==='pending'?['st-active','ACTIVE']:['st-warn',(st||'').replace('missing_','NEEDS ').replace('_',' ').toUpperCase()]);
    const fc=factionColor(factionOf(e));
    return `<div class="${cls}">
      <div class="qnum">${String(i+1).padStart(2,'0')}</div>
      <div class="qbody">
        <div class="qname">${esc(shortName(e))}</div>
        <div class="qmeta"><span class="qchip" style="color:${fc}">${esc(factionOf(e))}</span>${e.start_time?esc(e.start_time)+' · ':''}${esc(e.address||'')}</div>
        ${cleared?'<div class="qxp">+100 XP BANKED</div>':'<div class="qxp" style="color:var(--dim)">REWARD 100 XP · file field report</div>'}
      </div>
      <div class="qstatus ${stTag[0]}">${stTag[1]}</div>
    </div>`;
  }

  function render(m, mode, freshISO){
    document.getElementById('lvl').textContent='LV '+m.level;
    document.getElementById('xptext').textContent=m.xp.toLocaleString()+' XP';
    document.getElementById('xpnext').textContent=(m.perLevel-m.into).toLocaleString()+' to LV '+(m.level+1);
    document.getElementById('xpfill').style.width=(m.into/m.perLevel*100).toFixed(1)+'%';
    document.getElementById('streak').textContent='STREAK ×'+m.streak;
    document.getElementById('todaytag').textContent=fmtD(m.today)+' · '+m.todayQ.length+' mission'+(m.todayQ.length===1?'':'s');
    document.getElementById('today').innerHTML = m.todayQ.length? m.todayQ.map(questHTML).join('') : '<div class="empty">No installs scheduled today. Clear outstanding reports for bonus XP.</div>';
    document.getElementById('tomorrow').innerHTML = m.tmrQ.length? m.tmrQ.map(questHTML).join('') : '<div class="empty">Nothing on the board for tomorrow.</div>';
    // boss
    const boss=m.factions[0];
    const bp=document.getElementById('bosspanel');
    if(!boss){ bp.style.display='none'; } else {
      bp.style.display='';
      const segs=Array.from({length:Math.min(boss[1],12)},()=>'<div class="hpseg"></div>').join('');
      const oldest=m.outstanding.find(o=>factionOf(o)===boss[0]);
      document.getElementById('boss').innerHTML=`
        <div class="bossname">&#9650; ${esc(boss[0]).toUpperCase()}</div>
        <div class="bosshp">${segs}</div>
        <div class="bossmeta">HP ${boss[1]} — ${boss[1]} outstanding report${boss[1]===1?'':'s'}${oldest?' · oldest '+fmtD(oldest.event_date):''}. Each filed report destroys one segment.</div>`;
    }
    // factions
    const maxF=m.factions.length?m.factions[0][1]:1;
    document.getElementById('opstag').textContent=m.outstanding.length+' outstanding';
    document.getElementById('factions').innerHTML=m.factions.map(([b,n])=>`
      <div class="frow"><div class="fname">${esc(b)}</div>
      <div class="fbar"><div class="ffill" style="width:${(n/maxF*100).toFixed(0)}%;background:${factionColor(b)};color:${factionColor(b)}"></div></div>
      <div class="fcount" style="color:${factionColor(b)}">${n}</div></div>`).join('') || '<div class="empty">Zero outstanding. Flawless.</div>';
    // outstanding rows
    document.getElementById('outstanding').innerHTML=m.outstanding.slice(0,30).map(o=>{
      const days=Math.round((new Date(m.today)-new Date(o.event_date))/86400000);
      return `<div class="orow"><span class="qchip" style="color:${factionColor(factionOf(o))}">${esc(factionOf(o))}</span>
        <div class="oname">${esc(shortName(o))}</div>
        <div class="odate">${fmtD(o.event_date)}</div>
        <div class="odays ${days>=7?'hot':''}">${days===0?'TODAY':days+'d LATE'}</div></div>`;
    }).join('') || '<div class="empty">All clear.</div>';
    // chart
    let bars='';
    for(let i=13;i>=0;i--){
      const day=addDays(m.today,-i); const v=m.cleared[day]||0;
      const we=[0,6].includes(dow(day));
      const h=Math.min(100, v*12);
      bars+=`<div class="cbar ${we?'weekend':''}"><div class="cval">${v||''}</div><div class="cfill" style="height:${v?Math.max(6,h):2}%"></div><div class="clab">${MN[+day.split('-')[1]-1]+' '+(+day.split('-')[2])}</div></div>`;
    }
    document.getElementById('chart').innerHTML=bars;
    // week
    document.getElementById('weektag').textContent='week of '+fmtD(m.week[0].date);
    document.getElementById('week').innerHTML=m.week.map(d=>{
      const chips=d.events.slice(0,3).map(e=>`<div class="dchip ${e.report_status==='ok'?'done':''}" style="border-left-color:${factionColor(factionOf(e))}">${e.start_time?esc(e.start_time)+' ':''}${esc(shortName(e))}</div>`).join('');
      const more=d.events.length>3?`<div class="dcount">+${d.events.length-3} more</div>`:'';
      return `<div class="day ${d.date===m.today?'today':''}"><div class="dhead"><span>${DN[dow(d.date)]}</span><span>${+d.date.split('-')[2]}</span></div>${chips}${more}</div>`;
    }).join('');
    // stats
    const weekAgo=addDays(m.today,-7);
    const ok7=m.ok.filter(e=>e.event_date>=weekAgo).length;
    const stats=[
      [m.ok.length,'reports filed',1],
      [m.photosTotal.toLocaleString(),'photos archived',0],
      ['2,000+','jobs tracked',0],
      [ok7,'cleared last 7d',1],
      [m.outstanding.length,'outstanding',0],
      [m.streak+' day'+(m.streak===1?'':'s'),'current streak',0],
    ];
    document.getElementById('stats').innerHTML=stats.map(([v,l,a])=>`<div class="stat"><div class="sval ${a?'accent':''}">${v}</div><div class="slab">${l}</div></div>`).join('');
    // achievements
    const ach=[
      [m.ok.length>=100,'100','Century','100 field reports filed'],
      [m.photosTotal>=2000,'2K','Shutterbug II','2,000+ install photos archived'],
      [m.streak>=5,'5X','On a Roll','5-day filing streak'],
      [m.ok.length>=1,'01','First Blood','First report filed'],
      [m.outstanding.length===0,'0','Clean Sweep','Zero outstanding reports'],
      [m.ok.length>=150,'150','150 Club','150 reports filed'],
      [m.streak>=10,'10X','Unstoppable','10-day filing streak'],
    ];
    document.getElementById('ach').innerHTML=ach.map(([on,ic,n,dd])=>`<div class="ach ${on?'':'locked'}"><div class="aicon">${ic}</div><div><div class="aname">${n}</div><div class="adesc">${dd}</div></div></div>`).join('');
    // footer
    const modeEl=document.getElementById('mode');
    modeEl.className='mode'+(mode==='live'?'':' off');
    modeEl.innerHTML='<span class="pulse"></span>'+(mode==='live'?'LIVE LINK':'OFFLINE SNAPSHOT');
    document.getElementById('fresh').textContent='data as of '+new Date(freshISO).toLocaleString('en-US',{timeZone:'America/Denver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' MT';
  }

  // clock
  function tickClock(){
    const n=new Date().toLocaleString('en-US',{timeZone:'America/Denver',hour12:false});
    const d=denverNow();
    document.getElementById('clock').textContent=d.toTimeString().slice(0,8);
    document.getElementById('dateline').textContent=DN[d.getDay()]+' · '+MN[d.getMonth()]+' '+d.getDate()+' '+d.getFullYear()+' · DENVER';
  }
  const hudT1=setInterval(tickClock,1000); tickClock();

  // data
  let nextSync=0;
  async function loadLive(){
    try{
      const [ev,fr]=await Promise.all([
        base44.entities.CalendarEvents.list('-event_date',2000),
        base44.entities.FieldReports.list('-created_date',2000),
      ]);
      const events=ev.filter(e=>e.event_date&&e.event_date>='2026-08-20').map(e=>{const o={};SLIM.forEach(k=>o[k]=e[k]);return o;});
      const photos=fr.reduce((s,r)=>s+(r.attachment_count||0),0);
      render(compute(events,photos),'live',new Date().toISOString());
    }catch(err){
      render(compute([],0),'offline',new Date().toISOString());
      document.getElementById('fresh').textContent='data load failed - retrying';
    }
    nextSync=Date.now()+180000;
  }
  /* ============ FIELD ORDERS - Gabriel's private to-do board (owner-only member board,
     same gate as the rest of this page). Buckets in his order: Follow-ups, Quote Requests,
     Orders to Place, Odd End Items, then uncategorized. ============ */
  const TODO_MEMBER = '6aa7aa807101f01d02723c86';
  const TODO_LANES = [['follow_up','FOLLOW-UPS','#3dffc8'],['quote_request','QUOTE REQUESTS','#5ca8ff'],['order','ORDERS TO PLACE','#ffb020'],['odd_end','ODD END ITEMS','#c07bff'],['','NEEDS A CATEGORY','#ff5c8a']];
  async function loadTodos(){
    const el = document.getElementById('todos');
    try {
      const r = await base44.functions.invoke('todos', {action:'board', member_id: TODO_MEMBER});
      const tasks = ((r.data && r.data.tasks) || []).filter(t => t.status === 'open' || t.status === 'in_progress');
      const byLane = {};
      tasks.forEach(t => { const k = TODO_LANES.some(l => l[0] === t.category) ? t.category : ''; (byLane[k] = byLane[k] || []).push(t); });
      el.innerHTML = TODO_LANES.map(([k, label, color]) => {
        const rows = byLane[k] || [];
        if (!rows.length) return '';
        return '<div class="tbucket"><div class="tbhead" style="color:' + color + '">' + label + ' <span>' + rows.length + '</span></div>' +
          rows.map(t => '<div class="trow' + (t.status === 'in_progress' ? ' wip' : '') + '"><div class="tdot" style="background:' + color + ';box-shadow:0 0 6px ' + color + '"></div><div class="tname">' + esc(t.title) + '</div>' +
          (t.due_date ? '<div class="tdue">' + esc(t.due_date.slice(5).replace('-', '/')) + '</div>' : '') + '</div>').join('') + '</div>';
      }).join('') || '<div class="empty">Zero open to-dos. Flawless.</div>';
      document.getElementById('ordertag').textContent = tasks.length + ' open';
      el.dataset.loaded = '1';
    } catch (e) { if (!el.dataset.loaded) el.innerHTML = '<div class="empty">To-do board offline.</div>'; }
  }
  loadTodos();
  loadLive();
  const hudT2=setInterval(() => { loadLive(); loadTodos(); }, 180000);
  const hudT3=setInterval(()=>{
    const s=Math.max(0,Math.round((nextSync-Date.now())/1000));
    document.getElementById('sync').textContent='next sync '+String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+'';
  },1000);

  /* ============ VOICE UPLINK v3 - continuous hands-free, INSTINCT ONLY.
     The mic opens on page load (one-time Chrome permission) and the panel stays
     listening while this tab is open. A VAD segments speech: an utterance ends after
     ~1.8s of silence -> WAV chunk -> /voice/transcribe -> the text is auto-sent as an
     iMessage from Gabriel's number to the Instinct line (+16502507662) via /voice/send.
     No taps, no commands, no contact matching - nobody else is reachable from this panel.
     The standalone word "stop" / "stop listening" ends the session (mic released,
     STOPPED); a single mic tap re-arms. Instinct's replies are polled read-only.
     Typed input below goes to the same Instinct thread as a fallback. ============ */
  const VU_DEST_NAME = 'INSTINCT';
  const VU_DEST_GUID = 'iMessage;-;+16502507662';
  let VU_API = (() => { try { return (localStorage.getItem('vu_api') || 'https://voice.gfglassforge.com').replace(/\/+$/, ''); } catch { return 'https://voice.gfglassforge.com'; } })();
  const vu = { state:'probing', media:null, after: Date.now(), poll:null };
  const vuTag = document.getElementById('vutag'), vuState = document.getElementById('vustate'),
        vuMic = document.getElementById('vumic'), vuLog = document.getElementById('vulog');
  let vuAutoKey = '';  // synced from the Hub's stored BlueBubbles config - never typed, never shown
  function vuToken(){ try { const m = localStorage.getItem('vu_token'); if (m) return m; } catch {} return vuAutoKey; }
  const VU_ACTIVE = ['listening','hearing','transcribing','sending'];
  function vuSet(state, label){ vu.state = state; vuState.innerHTML = 'VOICE LINK <b>' + label + '</b>';
    vuMic.classList.toggle('rec', VU_ACTIVE.includes(state));
    vuMic.disabled = ['offline','probing'].includes(state); }
  function vuSay(cls, who, text){ const d = document.createElement('div'); d.innerHTML = '<div class="who">' + who + '</div><div class="' + cls + '"></div>';
    d.querySelector('div.' + cls).textContent = text; vuLog.prepend(d); while (vuLog.children.length > 8) vuLog.lastChild.remove(); }
  async function vuCall(path, opts){ const o = Object.assign({}, opts || {});
    o.headers = Object.assign({}, o.headers || {}, { 'Authorization': 'Bearer ' + vuToken() });
    const r = await fetch(VU_API + path, o);
    if (!r.ok) { const e = new Error('voice ' + r.status); e.status = r.status; throw e; }
    return r.json(); }
  /* ---- talk-back: speak Instinct's replies through the voice service TTS endpoint.
     POST /voice/speak (same Bearer as the rest of the voice API), JSON {text} (2000
     char cap), returns raw audio/wav 22050Hz mono - played as a blob. ~2.3s per
     two-sentence reply; generation is serialized server-side and playback is queued
     client-side so replies never overlap.
     CRITICAL: duck the VAD/mic while audio plays + 500ms after the LAST queued clip,
     so the spoken reply never gets transcribed and sent back as Gabriel's message
     (no echo loop). ---- */
  let vuTtsOn = true, vuAudio = null, vuSpeakQ = Promise.resolve(), vuSpeakPending = 0, vuUnduckT = null;
  function vuDuckStart(){ if (vuUnduckT) { clearTimeout(vuUnduckT); vuUnduckT = null; }
    vad.ducking = true; vad.seg = []; vad.pre = []; vad.speaking = false; vad.speechMs = 0; vad.silentMs = 0; }
  function vuDuckEnd(){ vuUnduckT = setTimeout(() => { if (vuSpeakPending === 0) vad.ducking = false; }, 500); }
  async function vuSpeakOne(text){
    const r = await fetch(VU_API + '/voice/speak', { method:'POST',
      headers:{ 'Authorization':'Bearer ' + vuToken(), 'Content-Type':'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 2000) }), signal: AbortSignal.timeout(30000) });
    if (!r.ok) { const e = new Error('speak ' + r.status); e.status = r.status; throw e; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    await new Promise(res => {
      const a = new Audio(url); vuAudio = a;
      const done = () => { try { URL.revokeObjectURL(url); } catch (e) {} if (vuAudio === a) vuAudio = null; res(); };
      a.onended = done; a.onerror = done;
      a.play().catch(done);
    });
  }
  function vuSpeak(text){
    if (!vuTtsOn || !text) return;
    vuSpeakPending++; vuDuckStart();
    vuSpeakQ = vuSpeakQ.then(() => vuSpeakOne(text)).catch(() => {})
      .finally(() => { vuSpeakPending = Math.max(0, vuSpeakPending - 1); vuDuckEnd(); });
  }
  async function vuProbe(){ try { const j = await vuCall('/voice/health', {signal: AbortSignal.timeout(5000)});
      if (j.status !== 'ok' && !j.stt) throw 0;
      vuTag.textContent = 'online'; vuTag.style.color = 'var(--green)';
      if (vu.state === 'offline' || vu.state === 'probing') vuSet('ready','READY'); }
    catch (e) { vuTag.textContent = 'offline'; vuTag.style.color = 'var(--red)'; if (vu.state !== 'stopped') vuSet('offline','OFFLINE'); } }

  /* ---- VAD + WAV: continuous capture, utterance segmentation, 16-bit PCM WAV encode ---- */
  const vad = { ctx:null, proc:null, src:null, rate:44100, noise:0.008, speaking:false, seg:[], pre:[], speechMs:0, silentMs:0, busy:false, queue:[], ducking:false };
  const VAD = { endMs:1800, minMs:700, maxMs:15000, threshFactor:2.5, threshFloor:0.010 };
  function vuEncodeWav(chunks, rate){
    // server-verified capture format: WAV PCM 16kHz mono LEI16 - resample if the context runs hotter
    if (rate !== 16000) {
      let total = 0; chunks.forEach(c => total += c.length);
      const flat = new Float32Array(total); let o = 0; chunks.forEach(c => { flat.set(c, o); o += c.length; });
      const outLen = Math.round(total * 16000 / rate), rs = new Float32Array(outLen), ratio = rate / 16000;
      for (let i = 0; i < outLen; i++) { const pos = i * ratio, i0 = Math.floor(pos), i1 = Math.min(i0 + 1, total - 1), f = pos - i0;
        rs[i] = flat[i0] * (1 - f) + flat[i1] * f; }
      chunks = [rs]; rate = 16000;
    }
    let len = 0; chunks.forEach(c => len += c.length);
    const buf = new ArrayBuffer(44 + len * 2), v = new DataView(buf);
    const ws = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    ws(0,'RIFF'); v.setUint32(4, 36 + len * 2, true); ws(8,'WAVE'); ws(12,'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    ws(36,'data'); v.setUint32(40, len * 2, true);
    let off = 44;
    chunks.forEach(c => { for (let i = 0; i < c.length; i++, off += 2) { const q = Math.max(-1, Math.min(1, c[i])); v.setInt16(off, q < 0 ? q * 32768 : q * 32767, true); } });
    return new Blob([buf], {type:'audio/wav'});
  }
  function onAudio(e){
    if (!vad.proc || vu.state === 'stopped' || vad.ducking) return;
    const d = e.inputBuffer.getChannelData(0);
    let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / d.length);
    const bufMs = d.length / vad.rate * 1000;
    const thresh = Math.max(vad.noise * VAD.threshFactor, VAD.threshFloor);
    if (!vad.speaking) {
      vad.noise = Math.max(0.004, vad.noise * 0.97 + Math.min(rms, vad.noise * 2) * 0.03);
      vad.pre.push(new Float32Array(d)); if (vad.pre.length > 6) vad.pre.shift();
      if (rms > thresh) { vad.speaking = true; vad.seg = vad.pre.slice(); vad.pre = []; vad.speechMs = bufMs; vad.silentMs = 0;
        if (!vad.busy) vuSet('hearing','HEARING'); }
    } else {
      vad.seg.push(new Float32Array(d)); vad.speechMs += bufMs;
      if (rms < thresh) vad.silentMs += bufMs; else vad.silentMs = 0;
      if (vad.speechMs >= VAD.maxMs || (vad.silentMs >= VAD.endMs && vad.speechMs >= VAD.minMs)) {
        const seg = vad.seg; vad.seg = []; vad.speaking = false; vad.speechMs = 0; vad.silentMs = 0;
        if (vad.busy) vad.queue.push(seg); else vuHandleSegment(seg);
      }
    }
  }
  async function vuStart(){
    if (vad.ctx || vu.state === 'offline' || vu.state === 'probing') return;
    if (!vuToken()) { vuSay('agent','FORGE','Set the voice key first (line below).'); return; }
    try { vu.media = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}}); }
    catch { vuSet('blocked','MIC BLOCKED'); vuSay('agent','FORGE','Mic blocked - allow microphone access for this page (lock icon left of the URL), then tap the mic.'); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    vad.ctx = new AC(); vad.rate = vad.ctx.sampleRate;
    vad.src = vad.ctx.createMediaStreamSource(vu.media);
    vad.proc = vad.ctx.createScriptProcessor(4096, 1, 1);
    vad.noise = 0.008; vad.speaking = false; vad.seg = []; vad.pre = []; vad.queue = []; vad.busy = false;
    vad.proc.onaudioprocess = onAudio;
    vad.src.connect(vad.proc); vad.proc.connect(vad.ctx.destination);
    vad.ctx.onstatechange = () => { if (vad.ctx && vad.ctx.state === 'running' && VU_ACTIVE.includes(vu.state) === false && vu.state !== 'stopped' && vu.state !== 'blocked') vuSet('listening','LISTENING'); };
    if (vad.ctx.state === 'suspended') {
      vuSet('arming','TAP ANYWHERE TO ARM MIC');
      const resume = () => { if (vad.ctx) vad.ctx.resume(); document.removeEventListener('pointerdown', resume); };
      document.addEventListener('pointerdown', resume);
    } else vuSet('listening','LISTENING');
    vuSay('agent','FORGE','Listening. Talk normally - I send each thought to Instinct when you pause. Say "stop" to stop.');
    vuStartPoll();
  }
  function vuStopSession(){
    if (vad.proc) { try { vad.proc.disconnect(); } catch {} vad.proc = null; }
    if (vad.src) { try { vad.src.disconnect(); } catch {} vad.src = null; }
    if (vad.ctx) { const c = vad.ctx; vad.ctx = null; c.close().catch(() => {}); }
    if (vu.media) { vu.media.getTracks().forEach(t => t.stop()); vu.media = null; }
    if (vu.poll) { clearInterval(vu.poll); vu.poll = null; }
    vad.speaking = false; vad.seg = []; vad.pre = []; vad.queue = []; vad.busy = false;
    vuSet('stopped','STOPPED - tap mic to re-arm');
    vuSay('agent','FORGE','Stopped. Mic is off and nothing is being captured. Tap the mic to listen again.');
  }
  async function vuHandleSegment(seg){
    vad.busy = true; vuSet('transcribing','TRANSCRIBING');
    try {
      const j = await vuCall('/voice/transcribe', {method:'POST', headers:{'Content-Type':'audio/wav'},
        body: vuEncodeWav(seg, vad.rate), signal: AbortSignal.timeout(60000)});
      const text = (j.text || '').trim();
      if (text) {
        vuSay('you','YOU', text);
        const norm = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
        if (norm === 'stop' || norm === 'stop listening') { vad.busy = false; vad.queue = []; vuStopSession(); return; }
        vuSet('sending','SENDING TO INSTINCT');
        await vuCall('/voice/send', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({chatGuid: VU_DEST_GUID, text}), signal: AbortSignal.timeout(20000)});
        vu.after = Date.now();
        vuSay('agent','FORGE','Sent to Instinct. The reply lands here and in your iMessage thread.');
      }
    } catch (err) {
      if (err.status === 401) { vuAutoKey = ''; vuSay('agent','FORGE','Voice key rejected - re-enter it below.'); vuProbe(); }
      else vuSay('agent','FORGE','Voice service error - that one was not sent.');
    }
    vad.busy = false;
    if (vu.state !== 'stopped') vuSet('listening','LISTENING');
    if (vad.queue.length) vuHandleSegment(vad.queue.shift());
  }
  function vuStartPoll(){ if (vu.poll) clearInterval(vu.poll);
    vu.poll = setInterval(async () => {
      try { const j = await vuCall('/voice/replies?chatGuid=' + encodeURIComponent(VU_DEST_GUID) + '&after=' + vu.after, {signal: AbortSignal.timeout(10000)});
        const rows = j.messages || j.replies || (Array.isArray(j) ? j : []);
        for (const m of rows) { const ts = (m.dateCreated || m.date || 0); if (ts > vu.after) vu.after = ts;
          if (!m.isFromMe && !m.is_from_me) { vuSay('agent', VU_DEST_NAME, m.text || ''); vuSpeak(m.text || ''); } } } catch {} }, 4000); }

  document.getElementById('vuspkr').addEventListener('click', () => {
    vuTtsOn = !vuTtsOn;
    document.getElementById('vuspkr').textContent = vuTtsOn ? 'SPKR ON' : 'SPKR OFF';
    if (!vuTtsOn) { try { if (vuAudio) { vuAudio.pause(); vuAudio = null; } } catch (e) {} vuSpeakPending = 0; vuSpeakQ = Promise.resolve(); vad.ducking = false; }
    vuSay('agent','FORGE', vuTtsOn ? 'Speaker on - I will read Instinct replies aloud.' : 'Speaker off - replies will be text only.');
  });
  vuMic.addEventListener('click', () => {
    if (vu.state === 'stopped' || vu.state === 'blocked' || vu.state === 'ready') vuStart();
    else if (VU_ACTIVE.includes(vu.state)) vuSay('agent','FORGE','Listening - say "stop" to stop.');
  });
  document.getElementById('vuform').addEventListener('submit', async e => { e.preventDefault();
    const inp = document.getElementById('vutext'), text = inp.value.trim();
    if (!text) return;
    if (!vuToken()) { vuSay('agent','FORGE','Set the voice key first (line below).'); return; }
    inp.value = ''; vuSay('you','YOU (typed)', text); vuSet('sending','SENDING TO INSTINCT');
    try { await vuCall('/voice/send', {method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({chatGuid: VU_DEST_GUID, text}), signal: AbortSignal.timeout(20000)});
      vu.after = Date.now();
      vuSay('agent','FORGE','Sent to Instinct.'); }
    catch (err) { vuSay('agent','FORGE', err.status === 401 ? 'Voice key rejected - re-enter it below.' : 'Send failed.'); }
    if (vu.state !== 'stopped' && !VU_ACTIVE.includes(vu.state)) vuSet('ready','READY');
    else if (vu.state === 'sending') vuSet(vad.ctx ? 'listening' : 'ready', vad.ctx ? 'LISTENING' : 'READY'); });
  document.getElementById('vuclear').addEventListener('click', () => { vuLog.innerHTML = ''; });
  document.getElementById('vukeyform').addEventListener('submit', e => { e.preventDefault();
    const k = document.getElementById('vukey'); const v = k.value.trim(); if (!v) return;
    try { localStorage.setItem('vu_token', v); } catch {}
    k.value = ''; vuSay('agent','FORGE','Voice key saved on this device only.'); vuProbe(); if (!vad.ctx) vuStart(); });
  /* Auto-sync the voice key from the Hub's stored BlueBubbles config (owner-only page +
     owner-only function = only Gabriel's session ever receives it). A manually entered
     key on this device still wins; the entry line stays as fallback. Once the service is
     confirmed online, the mic opens and the panel starts listening on its own. */
  async function vuAutoKeyLoad(){
    if (!vuToken()) {
      try {
        const r = await base44.functions.invoke('messages-api', {action:'get_voice_key'});
        const d = (r && r.data) || {};
        if (d.ok && d.voice_key) {
          vuAutoKey = d.voice_key;
          if (d.voice_base) VU_API = String(d.voice_base).replace(/\/+$/, '');
          const kf = document.getElementById('vukeyform');
          if (kf && !document.querySelector('.vu-autokey')) kf.insertAdjacentHTML('beforebegin', '<div class="vu-autokey">&#10003; voice key synced automatically</div>');
        }
      } catch (e) { /* manual entry below still works */ }
    }
    await vuProbe();
    if (vu.state !== 'offline') vuStart();
  }
  vuAutoKeyLoad(); const hudT4=setInterval(vuProbe, 30000);
  return () => {
    clearInterval(hudT1); clearInterval(hudT2); clearInterval(hudT3); clearInterval(hudT4);
    vuStopSession();
  };
}

export default function CommandHud() {
  const { user } = useAuth();
  const owner = isAgentCenterOwner(user);
  const ref = useRef(null);

  useEffect(() => {
    if (!owner || !ref.current) return;
    const style = document.createElement('style');
    style.dataset.commandHud = '1';
    style.textContent = HUD_CSS;
    const l1 = document.createElement('link');
    l1.rel = 'preconnect'; l1.href = 'https://fonts.googleapis.com'; l1.dataset.commandHud = '1';
    const l2 = document.createElement('link');
    l2.rel = 'stylesheet'; l2.dataset.commandHud = '1';
    l2.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap';
    document.head.appendChild(style); document.head.appendChild(l1); document.head.appendChild(l2);
    ref.current.innerHTML = HUD_MARKUP;
    const cleanup = bootHud(base44);
    return () => { cleanup(); style.remove(); l1.remove(); l2.remove(); };
  }, [owner]);

  if (!owner) return <PageNotFound />;
  return <div ref={ref} className="command-hud" />;
}
