import React, { useId, useMemo, useRef, useState, useCallback, useEffect } from 'react';
import './system-map.css';
import { Maximize, RotateCcw } from 'lucide-react';

const STATUS = {
  working: { label: 'Recorded working', color: '#175652' },
  partial: { label: 'Needs follow-up', color: '#a6792b' },
  planned: { label: 'Planned', color: '#748878' },
  reference: { label: 'Reference', color: '#858786' },
};

const CARD_W = 162;
const CARD_H = 78;
const NODE_GAP = 12;
const GROUP_PAD_X = 18;
const GROUP_PAD_TOP = 34;
const GROUP_PAD_BOTTOM = 16;
const LAYER_GAP = 56;
const SIDE_MARGIN = 104;

// Layered architecture derived from existing node types/labels (no invented systems).
// A node joins the first layer whose matcher accepts it; ids take precedence over
// categories so the Hub/orchestration nodes sit together above the operational modules.
const LAYER_DEFS = [
  { id: 'people', title: 'People & Business', match: (n) => ['business', 'person'].includes(n.category) },
  { id: 'hub', title: 'Core Hub & Orchestration', match: (n) => ['hub', 'today', 'agent_center', 'codex'].includes(n.id) },
  { id: 'ops', title: 'Operational Modules', match: (n) => n.category === 'app' },
  { id: 'sources', title: 'Workers & Sources', match: (n) => ['input', 'worker'].includes(n.category) },
  { id: 'infra', title: 'Devices & Network', match: (n) => ['device', 'network'].includes(n.category) },
];

function asText(value) {
  return typeof value === 'string' ? value : '';
}

function statusInfo(status) {
  return STATUS[status] || STATUS.reference;
}

function displayDate(value) {
  if (!value) return 'Date not provided';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
  return Number.isNaN(date.getTime())
    ? 'Date not provided'
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function safeHref(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url)) return url;
  return null;
}

function matchesSearch(node, query) {
  const haystack = [
    node.label, node.category, node.summary, node.owner, node.nextStep,
    ...(node.details || []), ...(node.links || []).map((link) => link.label),
  ].join(' ').toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function normalizeData(data) {
  const seen = new Set();
  const nodes = (Array.isArray(data?.nodes) ? data.nodes : []).filter((node) => {
    if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  }).map((node) => ({
    ...node,
    label: asText(node.label) || node.id,
    category: asText(node.category) || 'System',
    status: Object.hasOwn(STATUS, node.status) ? node.status : 'reference',
    summary: asText(node.summary),
    owner: asText(node.owner),
    nextStep: asText(node.nextStep),
    details: Array.isArray(node.details) ? node.details.filter((item) => typeof item === 'string') : [],
    links: Array.isArray(node.links) ? node.links.filter((link) => link && typeof link.label === 'string') : [],
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (Array.isArray(data?.edges) ? data.edges : []).filter((edge) => edge && byId.has(edge.from) && byId.has(edge.to));
  const workflows = (Array.isArray(data?.workflows) ? data.workflows : []).filter(Boolean).map((workflow, index) => ({
    ...workflow,
    id: asText(workflow.id) || `workflow-${index}`,
    title: asText(workflow.title) || 'Workflow',
    summary: asText(workflow.summary),
    steps: Array.isArray(workflow.steps) ? workflow.steps.filter((id) => byId.has(id)) : [],
  }));
  const openItems = (Array.isArray(data?.openItems) ? data.openItems : []).filter(Boolean);
  return { nodes, byId, edges, workflows, openItems };
}

function degreeMap(model) {
  const deg = new Map(model.nodes.map((n) => [n.id, 0]));
  for (const e of model.edges) {
    deg.set(e.from, (deg.get(e.from) || 0) + 1);
    deg.set(e.to, (deg.get(e.to) || 0) + 1);
  }
  return deg;
}

// Flow rank from recorded workflows — used as a stable, graph-derived ordering key
// so the primary operational path reads left-to-right within each layer.
function buildFlowRank(workflows) {
  const rank = new Map();
  let next = 0;
  for (const w of workflows) {
    for (const id of w.steps) {
      if (!rank.has(id)) rank.set(id, next++);
    }
  }
  return rank;
}

function buildLayers(model) {
  const buckets = LAYER_DEFS.map((def) => ({ ...def, nodes: [] }));
  for (const node of model.nodes) {
    const layer = buckets.find((b) => b.match(node)) || buckets[buckets.length - 1];
    layer.nodes.push(node);
  }
  const rank = buildFlowRank(model.workflows);
  const deg = degreeMap(model);
  for (const bucket of buckets) {
    bucket.nodes.sort((a, b) => {
      const ra = rank.get(a.id) ?? 9999;
      const rb = rank.get(b.id) ?? 9999;
      if (ra !== rb) return ra - rb;
      return (deg.get(b.id) || 0) - (deg.get(a.id) || 0) || a.label.localeCompare(b.label);
    });
  }
  return buckets.filter((b) => b.nodes.length);
}

function layout(layers) {
  const maxNodesWidth = Math.max(0, ...layers.map((l) => l.nodes.length * CARD_W + Math.max(0, l.nodes.length - 1) * NODE_GAP));
  const groupWidth = maxNodesWidth + GROUP_PAD_X * 2;
  const canvasWidth = groupWidth + SIDE_MARGIN * 2;
  let y = 24;
  const layerBoxes = [];
  const positions = new Map();
  layers.forEach((layer, li) => {
    const nodesWidth = layer.nodes.length * CARD_W + Math.max(0, layer.nodes.length - 1) * NODE_GAP;
    const groupHeight = GROUP_PAD_TOP + CARD_H + GROUP_PAD_BOTTOM;
    layerBoxes.push({ ...layer, index: li, x: SIDE_MARGIN, y, width: groupWidth, height: groupHeight });
    const startX = SIDE_MARGIN + GROUP_PAD_X + (maxNodesWidth - nodesWidth) / 2;
    layer.nodes.forEach((node, i) => {
      positions.set(node.id, {
        x: startX + i * (CARD_W + NODE_GAP),
        y: y + GROUP_PAD_TOP,
        width: CARD_W,
        height: CARD_H,
        layer: li,
        col: i,
      });
    });
    y += groupHeight + LAYER_GAP;
  });
  const canvasHeight = y - LAYER_GAP + 24;
  return { positions, layerBoxes, width: canvasWidth, height: canvasHeight };
}

function buildPrimaryEdges(workflows) {
  const set = new Set();
  for (const w of workflows) {
    for (let i = 0; i < w.steps.length - 1; i++) {
      set.add(`${w.steps[i]}→${w.steps[i + 1]}`);
    }
  }
  return set;
}

// Orthogonal step routing. Adjacent layers route through the gap between them;
// same-layer edges dip just below the band; edges that skip a layer are routed
// out to a side margin lane so they never cut through an intermediate group.
function routeEdge(a, b, index, canvasWidth) {
  const aCx = a.x + a.width / 2;
  const bCx = b.x + b.width / 2;
  const layerDiff = Math.abs(a.layer - b.layer);
  if (layerDiff > 1) {
    const right = bCx >= aCx;
    const laneX = right
      ? canvasWidth - SIDE_MARGIN + 22 + (index % 3) * 9
      : SIDE_MARGIN - 22 - (index % 3) * 9;
    const sx = right ? a.x + a.width : a.x;
    const tx = right ? b.x + b.width : b.x;
    const aCy = a.y + a.height / 2;
    const bCy = b.y + b.height / 2;
    return `M ${sx} ${aCy} L ${laneX} ${aCy} L ${laneX} ${bCy} L ${tx} ${bCy}`;
  }
  if (a.layer === b.layer) {
    const laneY = Math.max(a.y + a.height, b.y + b.height) + 14 + (index % 4) * 7;
    return `M ${aCx} ${a.y + a.height} L ${aCx} ${laneY} L ${bCx} ${laneY} L ${bCx} ${b.y + b.height}`;
  }
  const downward = b.layer > a.layer;
  if (downward) {
    const sy = a.y + a.height;
    const ty = b.y;
    const midY = (sy + ty) / 2 + (index % 5 - 2) * 5;
    return `M ${aCx} ${sy} L ${aCx} ${midY} L ${bCx} ${midY} L ${bCx} ${ty}`;
  }
  const sy = a.y;
  const ty = b.y + b.height;
  const midY = (sy + ty) / 2 + (index % 5 - 2) * 5;
  return `M ${aCx} ${sy} L ${aCx} ${midY} L ${bCx} ${midY} L ${bCx} ${ty}`;
}

function edgeStyle(edge, isPrimary) {
  if (isPrimary) return { stroke: '#175652', width: 2.3, dash: null, opacity: 0.95, marker: 'primary' };
  switch (edge.status) {
    case 'working': return { stroke: '#5b7a72', width: 1.5, dash: null, opacity: 0.72, marker: 'working' };
    case 'partial': return { stroke: '#a6792b', width: 1.5, dash: '7 4', opacity: 0.72, marker: 'partial' };
    case 'planned': return { stroke: '#8b968d', width: 1.5, dash: '2 5', opacity: 0.65, marker: 'planned' };
    case 'reference': default: return { stroke: '#9bad9f', width: 1.25, dash: '5 5', opacity: 0.5, marker: 'reference' };
  }
}

const EDGE_LEGEND = [
  { key: 'primary', label: 'Primary operational path', stroke: '#175652', dash: null, width: 2.3 },
  { key: 'working', label: 'Recorded working', stroke: '#5b7a72', dash: null, width: 1.5 },
  { key: 'partial', label: 'Needs follow-up', stroke: '#a6792b', dash: '7 4', width: 1.5 },
  { key: 'planned', label: 'Planned', stroke: '#8b968d', dash: '2 5', width: 1.5 },
  { key: 'reference', label: 'Reference', stroke: '#9bad9f', dash: '5 5', width: 1.25 },
];

function ArrowIcon({ size = 16 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function StatusBadge({ status }) {
  return <span className="gsm-node-status"><span className={`gsm-status-dot is-${status}`} aria-hidden="true" />{statusInfo(status).label}</span>;
}

function ResourceLinks({ links, print = false }) {
  if (!links?.length) return null;
  return <ul className="gsm-resource-links">{links.map((link, index) => {
    const href = safeHref(link.url);
    return <li key={`${link.label}-${index}`}>{href
      ? <a href={href} {...(/^https?:\/\//i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{link.label}{!print && <ArrowIcon size={14} />}</a>
      : <span>{link.label}</span>}{print && asText(link.url) && <small>{link.url}</small>}</li>;
  })}</ul>;
}

function PrintCatalog({ data, model }) {
  return <section className="gsm-print-catalog" aria-label="Complete printable system catalog">
    <p>Saved snapshot: {displayDate(data?.updatedAt)}. Status describes recorded evidence, not a live check.</p>
    {model.nodes.map((node) => <article className="gsm-print-node" key={node.id}>
      <h2>{node.label}</h2>
      <p><strong>{node.category} · {statusInfo(node.status).label}</strong>{node.owner ? ` · Responsible: ${node.owner}` : ''}</p>
      <p>{node.summary}</p>
      {node.details.length > 0 && <ul>{node.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
      {node.nextStep && <p><strong>Next step:</strong> {node.nextStep}</p>}
      {model.edges.some((edge) => edge.from === node.id || edge.to === node.id) && <ul>{model.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge, index) => <li key={index}>{model.byId.get(edge.from).label} → {model.byId.get(edge.to).label}{edge.label ? `: ${edge.label}` : ''} ({statusInfo(edge.status).label})</li>)}</ul>}
      <ResourceLinks links={node.links} print />
    </article>)}
    {model.workflows.length > 0 && <section><h2>How work moves</h2>{model.workflows.map((workflow) => <article className="gsm-print-node" key={workflow.id}><h3>{workflow.title}</h3><p>{workflow.summary}</p><p>{workflow.steps.map((id) => model.byId.get(id).label).join(' → ')}</p></article>)}</section>}
    {model.openItems.length > 0 && <section><h2>Needs attention</h2><ul>{model.openItems.map((item, index) => <li key={index}><strong>{asText(item.title)}</strong> — {asText(item.detail)}{model.byId.has(item.nodeId) ? ` (${model.byId.get(item.nodeId).label})` : ''}</li>)}</ul></section>}
  </section>;
}

export default function SystemMapExplorer({ data }) {
  const model = useMemo(() => normalizeData(data), [data]);
  const layers = useMemo(() => buildLayers(model), [model]);
  const layoutData = useMemo(() => layout(layers), [layers]);
  const primaryEdges = useMemo(() => buildPrimaryEdges(model.workflows), [model.workflows]);
  const { positions, layerBoxes, width: canvasWidth, height: canvasHeight } = layoutData;

  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef(null);
  const reactId = useId().replace(/:/g, '');
  const detailId = `${reactId}-details`;
  const search = query.trim();
  const matchIds = useMemo(() => (search ? new Set(model.nodes.filter((n) => matchesSearch(n, search)).map((n) => n.id)) : null), [search, model.nodes]);
  const selected = (selectedId && model.byId.get(selectedId)) || null;
  const relatedEdges = selected ? model.edges.filter((e) => e.from === selected.id || e.to === selected.id) : [];
  const relatedIds = new Set(relatedEdges.flatMap((e) => [e.from, e.to]));

  const fit = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const scale = Math.min(el.clientWidth / canvasWidth, el.clientHeight / canvasHeight);
    setZoom(Math.max(0.3, Math.min(1, Number(scale.toFixed(3)))));
  }, [canvasWidth, canvasHeight]);

  useEffect(() => { fit(); }, [fit]); // fit on first mount / data change

  function revealDetails() {
    window.requestAnimationFrame(() => {
      const panel = document.getElementById(detailId);
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function selectNode(id) {
    setSelectedId(id);
    revealDetails();
  }

  function jumpToNode(id) {
    if (!model.byId.has(id)) return;
    setSelectedId(id);
    revealDetails();
  }

  return <div className="gf-system-map">
    <header className="gsm-header">
      <div><p className="gsm-eyebrow">GLASS FORGE · THE BIG PICTURE</p><h1 className="gsm-title">Your business, connected.</h1><p className="gsm-intro">{asText(data?.intro) || 'See what each system does, how work moves between them, and what needs attention next.'}</p></div>
      <div className="gsm-header-actions"><span className="gsm-snapshot"><span aria-hidden="true">◷</span> Saved snapshot · {displayDate(data?.updatedAt)}</span><button type="button" className="gsm-print-button" onClick={() => window.print()}>Print full map</button></div>
    </header>

    <div className="gsm-toolbar">
      <div className="gsm-search"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg><input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }} placeholder="Search every system…" aria-label="Search all systems, details, and next steps" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</div>
      <p className="gsm-toolbar-meta">{model.nodes.length} systems · {model.edges.length} connections · {model.workflows.length} workflows</p>
    </div>

    <div className="gsm-legend" aria-label="Connection and status legend">
      {EDGE_LEGEND.map((item) => <span className="gsm-legend-item" key={item.key}><svg width="28" height="10" viewBox="0 0 28 10" aria-hidden="true"><line x1="1" y1="5" x2="24" y2="5" stroke={item.stroke} strokeWidth={item.width} strokeDasharray={item.dash || undefined} /><path d="M24 1 L28 5 L24 9" fill="none" stroke={item.stroke} strokeWidth={item.width} /></svg>{item.label}</span>)}
      <span className="gsm-legend-divider" aria-hidden="true" />
      {Object.entries(STATUS).map(([status, item]) => <span className="gsm-legend-item" key={status}><span className={`gsm-status-dot is-${status}`} aria-hidden="true" />{item.label}</span>)}
    </div>

    <section className="gsm-workspace">
      <div className="gsm-diagram-shell">
        <div className="gsm-diagram-header">
          <div><h2 className="gsm-diagram-title">{search ? 'Search results' : 'Glass Forge architecture'}</h2><p className="gsm-diagram-meta">{search ? `${matchIds.size} of ${model.nodes.length} systems match “${search}”.` : 'Top-to-bottom: people → hub → modules → sources → devices. Select a card to explore.'}</p></div>
          <div className="gsm-controls" role="group" aria-label="Diagram zoom controls">
            <button type="button" onClick={() => setZoom((z) => Math.min(2, Number((z * 1.2).toFixed(3))))} aria-label="Zoom in"><ZoomIcon size={16} plus /></button>
            <button type="button" onClick={() => setZoom((z) => Math.max(0.3, Number((z / 1.2).toFixed(3))))} aria-label="Zoom out"><ZoomIcon size={16} /></button>
            <button type="button" onClick={fit} aria-label="Fit diagram to view"><Maximize size={16} /></button>
            <button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom to 100%"><RotateCcw size={16} /></button>
            <span className="gsm-zoom-readout">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <div className="gsm-diagram-scroll" ref={scrollRef} tabIndex={0} role="region" aria-label="Interactive architecture diagram. Scroll or drag to explore; select a card for details.">
          <div className="gsm-diagram-spacer" style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}>
            <div className="gsm-diagram-canvas" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
              <svg className="gsm-connectors" width={canvasWidth} height={canvasHeight} viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} aria-hidden="true">
                <defs>
                  {EDGE_LEGEND.map((item) => <marker key={item.key} id={`${reactId}-${item.key}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={item.stroke} /></marker>)}
                </defs>
                {model.edges.map((edge, index) => {
                  const a = positions.get(edge.from);
                  const b = positions.get(edge.to);
                  if (!a || !b) return null;
                  const isPrimary = primaryEdges.has(`${edge.from}→${edge.to}`);
                  const style = edgeStyle(edge, isPrimary);
                  const active = selected && (edge.from === selected.id || edge.to === selected.id);
                  const dim = matchIds && !(matchIds.has(edge.from) && matchIds.has(edge.to));
                  return <path key={`${edge.from}-${edge.to}-${index}`} d={routeEdge(a, b, index, canvasWidth)} fill="none" stroke={style.stroke} strokeWidth={active ? style.width + 0.6 : style.width} strokeOpacity={dim ? style.opacity * 0.25 : style.opacity} strokeDasharray={style.dash || undefined} strokeLinejoin="round" strokeLinecap="round" markerEnd={`url(#${reactId}-${style.marker})`} className={active ? 'gsm-edge is-active' : ''} />;
                })}
              </svg>
              {layerBoxes.map((box) => <div className="gsm-layer" key={box.id} style={{ left: box.x, top: box.y, width: box.width, height: box.height }}><span className="gsm-layer-title">{box.title}<span className="gsm-layer-count">{box.nodes.length}</span></span></div>)}
              {model.nodes.map((node) => {
                const p = positions.get(node.id);
                if (!p) return null;
                const isMatch = !matchIds || matchIds.has(node.id);
                const isActive = selected?.id === node.id;
                const isRelated = relatedIds.has(node.id);
                return <button type="button" key={node.id} className={`gsm-node${isActive ? ' is-selected' : ''}${isRelated ? ' is-related' : ''}`} data-status={node.status} style={{ left: p.x, top: p.y, width: p.width, height: p.height }} aria-pressed={isActive} aria-controls={detailId} aria-label={`${node.label}. ${statusInfo(node.status).label}. ${node.summary}`} onClick={() => selectNode(node.id)} data-dim={isMatch ? null : 'true'}>
                  <span className="gsm-node-top"><span className="gsm-node-category">{node.category}</span><span className={`gsm-status-dot is-${node.status}`} aria-hidden="true" /></span>
                  <strong className="gsm-node-label">{node.label}</strong>
                  <span className="gsm-node-summary">{node.summary}</span>
                </button>;
              })}
            </div>
          </div>
        </div>
      </div>

      <aside className="gsm-details" id={detailId} tabIndex={-1} aria-label="Selected system details" aria-live="polite">
        {selected ? <>
          <p className="gsm-detail-kicker">{selected.category}</p>
          <h2 className="gsm-detail-title">{selected.label}</h2>
          <StatusBadge status={selected.status} />
          <p className="gsm-detail-summary">{selected.summary}</p>
          {selected.owner && <div className="gsm-detail-meta"><span>Responsible</span><strong>{selected.owner}</strong></div>}
          {selected.details.length > 0 && <section className="gsm-detail-section"><h3>What to know</h3><ul className="gsm-detail-list">{selected.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></section>}
          {selected.nextStep && <section className="gsm-next-step"><h3>Next step</h3><p>{selected.nextStep}</p></section>}
          {relatedEdges.length > 0 && <section className="gsm-detail-section"><h3>Connected to this system</h3><div className="gsm-related-links">{relatedEdges.map((edge, index) => {
            const outgoing = edge.from === selected.id;
            const other = model.byId.get(outgoing ? edge.to : edge.from);
            return <button type="button" key={`${other.id}-${index}`} onClick={() => jumpToNode(other.id)}><span><small>{outgoing ? 'To' : 'From'} · {asText(edge.label) || 'Connected system'}</small><strong>{other.label}</strong></span><ArrowIcon /></button>;
          })}</div></section>}
          {selected.links.length > 0 && <section className="gsm-detail-section"><h3>Open a reference</h3><ResourceLinks links={selected.links} /></section>}
        </> : <div className="gsm-details-empty"><h2>Explore a system</h2><p>Select a card in the diagram to see its purpose, owner, connections, and next step.</p></div>}
      </aside>
    </section>

    <div className="gsm-bottom-grid">
      <section className="gsm-section"><div className="gsm-section-heading"><p className="gsm-eyebrow">FROM START TO FINISH</p><h2>How work moves</h2></div><div className="gsm-workflows">{model.workflows.length ? model.workflows.map((workflow) => <article key={workflow.id} className="gsm-workflow"><h3>{workflow.title}</h3><p>{workflow.summary}</p><div className="gsm-workflow-steps" aria-label={`${workflow.title} steps`}>{workflow.steps.map((id, index) => <React.Fragment key={`${id}-${index}`}>{index > 0 && <ArrowIcon size={14} />}<button type="button" className="gsm-workflow-step" onClick={() => jumpToNode(id)}><span>{index + 1}</span>{model.byId.get(id).label}</button></React.Fragment>)}</div></article>) : <p className="gsm-diagram-meta">No workflows are included in this snapshot.</p>}</div></section>
      <section className="gsm-section"><div className="gsm-section-heading"><p className="gsm-eyebrow">THE NEXT CONVERSATION</p><h2>Needs attention <span>{model.openItems.length}</span></h2></div><ul className="gsm-attention-list">{model.openItems.map((item, index) => <li className="gsm-attention-item" key={`${asText(item.title)}-${index}`}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3>{asText(item.title) || 'Follow-up'}</h3><p>{asText(item.detail)}</p>{model.byId.has(item.nodeId) && <button type="button" onClick={() => jumpToNode(item.nodeId)}>Explore {model.byId.get(item.nodeId).label}<ArrowIcon size={14} /></button>}</div></li>)}</ul>{!model.openItems.length && <p className="gsm-diagram-meta">No open items are recorded in this snapshot.</p>}</section>
    </div>
    <PrintCatalog data={data} model={model} />
    <p className="gsm-source-note">{asText(data?.sourceNote) || 'This map describes a saved snapshot. Recorded working means supported by the available notes; it is not a live health check.'}</p>
  </div>;
}

function ZoomIcon({ size, plus }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.7" /><path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />{plus ? <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> : <path d="M8 11h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />}</svg>;
}