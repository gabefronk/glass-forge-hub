import React, { useId, useMemo, useState } from 'react';
import './system-map.css';

const STATUS = {
  working: { label: 'Recorded working', color: '#175652' },
  partial: { label: 'Needs follow-up', color: '#a6792b' },
  planned: { label: 'Planned', color: '#748878' },
  reference: { label: 'Reference', color: '#858786' },
};
const ALL_VIEW_ID = '__gf_all_systems__';
const CARD_WIDTH = 214;
const CARD_HEIGHT = 166;
const COLUMN_GAP = 66;
const ROW_GAP = 42;
const PADDING = 38;

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
    ...(node.details || []), ...(node.links || []).map(link => link.label),
  ].join(' ').toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function normalizeData(data) {
  const seen = new Set();
  const nodes = (Array.isArray(data?.nodes) ? data.nodes : []).filter(node => {
    if (!node || typeof node.id !== 'string' || !node.id || seen.has(node.id)) return false;
    seen.add(node.id);
    return true;
  }).map(node => ({
    ...node,
    label: asText(node.label) || node.id,
    category: asText(node.category) || 'System',
    status: Object.hasOwn(STATUS, node.status) ? node.status : 'reference',
    summary: asText(node.summary),
    owner: asText(node.owner),
    nextStep: asText(node.nextStep),
    details: Array.isArray(node.details) ? node.details.filter(item => typeof item === 'string') : [],
    links: Array.isArray(node.links) ? node.links.filter(link => link && typeof link.label === 'string') : [],
  }));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const viewIds = new Set();
  const views = (Array.isArray(data?.views) ? data.views : []).filter(view => {
    if (!view || typeof view.id !== 'string' || !view.id || view.id === ALL_VIEW_ID || viewIds.has(view.id)) return false;
    viewIds.add(view.id);
    return true;
  }).map(view => ({
    id: view.id,
    title: asText(view.title) || 'View',
    description: asText(view.description),
    nodeIds: [...new Set(Array.isArray(view.nodeIds) ? view.nodeIds.filter(id => byId.has(id)) : [])],
  }));
  if (!views.length) views.push({
    id: 'overview', title: 'Overview', description: 'The main parts of the business and how they connect.',
    nodeIds: nodes.slice(0, 9).map(node => node.id),
  });
  views.push({ id: ALL_VIEW_ID, title: 'All systems', description: 'Every system and reference in this saved snapshot.', nodeIds: nodes.map(node => node.id) });
  const edges = (Array.isArray(data?.edges) ? data.edges : []).filter(edge => edge && byId.has(edge.from) && byId.has(edge.to));
  const workflows = (Array.isArray(data?.workflows) ? data.workflows : []).filter(Boolean).map((workflow, index) => ({
    ...workflow,
    id: asText(workflow.id) || `workflow-${index}`,
    title: asText(workflow.title) || 'Workflow',
    summary: asText(workflow.summary),
    steps: Array.isArray(workflow.steps) ? workflow.steps.filter(id => byId.has(id)) : [],
  }));
  const openItems = (Array.isArray(data?.openItems) ? data.openItems : []).filter(Boolean);
  return { nodes, byId, views, edges, workflows, openItems };
}

/** A compact hub for small views; a stable column layout for larger catalogs. */
function layoutNodes(nodes, edges) {
  if (!nodes.length) return { positions: new Map(), width: 708, height: 330 };
  const degree = new Map(nodes.map(node => [node.id, 0]));
  edges.forEach(edge => {
    degree.set(edge.from, (degree.get(edge.from) || 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) || 0) + 1);
  });
  const hub = [...nodes].sort((a, b) => degree.get(b.id) - degree.get(a.id))[0];
  let columns;
  if (nodes.length >= 4 && nodes.length <= 9 && degree.get(hub.id) >= 3) {
    const left = [];
    const right = [];
    nodes.filter(node => node.id !== hub.id).forEach(node => {
      const towardHub = edges.some(edge => edge.from === node.id && edge.to === hub.id);
      const fromHub = edges.some(edge => edge.from === hub.id && edge.to === node.id);
      if (towardHub && !fromHub) left.push(node);
      else if (fromHub && !towardHub) right.push(node);
      else (left.length <= right.length ? left : right).push(node);
    });
    while (Math.abs(left.length - right.length) > 1) {
      const larger = left.length > right.length ? left : right;
      const smaller = larger === left ? right : left;
      smaller.push(larger.pop());
    }
    columns = [left, [hub], right];
  } else {
    const count = Math.min(3, nodes.length);
    const rows = Math.ceil(nodes.length / count);
    columns = Array.from({ length: count }, (_, index) => nodes.slice(index * rows, (index + 1) * rows));
  }
  const rows = Math.max(...columns.map(column => column.length), 1);
  const innerHeight = rows * CARD_HEIGHT + Math.max(0, rows - 1) * ROW_GAP;
  const height = innerHeight + PADDING * 2;
  const width = columns.length * CARD_WIDTH + (columns.length - 1) * COLUMN_GAP + PADDING * 2;
  const positions = new Map();
  columns.forEach((column, columnIndex) => {
    const columnHeight = column.length * CARD_HEIGHT + Math.max(0, column.length - 1) * ROW_GAP;
    const top = PADDING + (innerHeight - columnHeight) / 2;
    column.forEach((node, index) => positions.set(node.id, {
      x: PADDING + columnIndex * (CARD_WIDTH + COLUMN_GAP),
      y: top + index * (CARD_HEIGHT + ROW_GAP),
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      column: columnIndex,
    }));
  });
  return { positions, width, height };
}

function connectionPath(from, to, index) {
  const offset = 18 + (index % 3) * 7;
  const fromY = from.y + from.height / 2;
  const toY = to.y + to.height / 2;
  if (from.column === to.column) {
    const x = from.x + from.width;
    const lane = x + 24 + (index % 3) * 5;
    if (from.y === to.y) {
      return `M ${x} ${fromY - 22} C ${x + 32} ${fromY - 22}, ${x + 32} ${fromY + 22}, ${x + 3} ${fromY + 22}`;
    }
    return `M ${x} ${fromY} C ${lane} ${fromY}, ${lane} ${fromY}, ${lane} ${fromY + (toY > fromY ? 20 : -20)} L ${lane} ${toY + (toY > fromY ? -20 : 20)} Q ${lane} ${toY}, ${x + 3} ${toY}`;
  }
  const forward = to.x > from.x;
  const startX = forward ? from.x + from.width : from.x;
  const endX = forward ? to.x - 3 : to.x + to.width + 3;
  if (Math.abs(from.column - to.column) > 1) {
    const laneY = 13 + (index % 3) * 7;
    const outX = startX + (forward ? offset : -offset);
    const inX = endX + (forward ? -offset : offset);
    return `M ${startX} ${fromY} L ${outX} ${fromY} L ${outX} ${laneY} L ${inX} ${laneY} L ${inX} ${toY} L ${endX} ${toY}`;
  }
  const middle = (startX + endX) / 2;
  return `M ${startX} ${fromY} C ${middle} ${fromY}, ${middle} ${toY}, ${endX} ${toY}`;
}

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
    {model.nodes.map(node => <article className="gsm-print-node" key={node.id}>
      <h2>{node.label}</h2>
      <p><strong>{node.category} · {statusInfo(node.status).label}</strong>{node.owner ? ` · Responsible: ${node.owner}` : ''}</p>
      <p>{node.summary}</p>
      {node.details.length > 0 && <ul>{node.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>}
      {node.nextStep && <p><strong>Next step:</strong> {node.nextStep}</p>}
      {model.edges.some(edge => edge.from === node.id || edge.to === node.id) && <ul>{model.edges.filter(edge => edge.from === node.id || edge.to === node.id).map((edge, index) => <li key={index}>{model.byId.get(edge.from).label} → {model.byId.get(edge.to).label}{edge.label ? `: ${edge.label}` : ''} ({statusInfo(edge.status).label})</li>)}</ul>}
      <ResourceLinks links={node.links} print />
    </article>)}
    {model.workflows.length > 0 && <section><h2>How work moves</h2>{model.workflows.map(workflow => <article className="gsm-print-node" key={workflow.id}><h3>{workflow.title}</h3><p>{workflow.summary}</p><p>{workflow.steps.map(id => model.byId.get(id).label).join(' → ')}</p></article>)}</section>}
    {model.openItems.length > 0 && <section><h2>Needs attention</h2><ul>{model.openItems.map((item, index) => <li key={index}><strong>{asText(item.title)}</strong> — {asText(item.detail)}{model.byId.has(item.nodeId) ? ` (${model.byId.get(item.nodeId).label})` : ''}</li>)}</ul></section>}
  </section>;
}

export default function SystemMapExplorer({ data }) {
  const model = useMemo(() => normalizeData(data), [data]);
  const [viewId, setViewId] = useState(() => model.views[0]?.id);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const reactId = useId().replace(/:/g, '');
  const detailId = `${reactId}-details`;
  const searchId = `${reactId}-search`;
  const activeView = model.views.find(view => view.id === viewId) || model.views[0];
  const search = query.trim();
  const visibleNodes = useMemo(() => search
    ? model.nodes.filter(node => matchesSearch(node, search))
    : (activeView?.nodeIds || []).map(id => model.byId.get(id)).filter(Boolean), [search, model, activeView]);
  const visibleIds = useMemo(() => new Set(visibleNodes.map(node => node.id)), [visibleNodes]);
  const selected = (visibleIds.has(selectedId) && model.byId.get(selectedId)) || visibleNodes[0] || null;
  const visibleEdges = useMemo(() => model.edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to)), [model.edges, visibleIds]);
  const layout = useMemo(() => layoutNodes(visibleNodes, visibleEdges), [visibleNodes, visibleEdges]);
  const relatedEdges = selected ? model.edges.filter(edge => edge.from === selected.id || edge.to === selected.id) : [];
  const relatedIds = new Set(relatedEdges.flatMap(edge => [edge.from, edge.to]));
  const hiddenConnections = model.edges.filter(edge => visibleIds.has(edge.from) !== visibleIds.has(edge.to)).length;

  function chooseView(id) {
    setViewId(id);
    setQuery('');
    setSelectedId(null);
  }

  function revealDetails(onlyWhenStacked = false) {
    window.requestAnimationFrame(() => {
      const panel = document.getElementById(detailId);
      const workspace = document.getElementById(`${reactId}-view`);
      if (!panel || !workspace) return;
      const stacked = Math.abs(panel.getBoundingClientRect().left - workspace.getBoundingClientRect().left) < 12;
      if (!onlyWhenStacked || stacked) {
        panel.focus({ preventScroll: true });
        panel.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
    });
  }

  function selectNode(id) {
    setSelectedId(id);
    revealDetails(true);
  }

  function jumpToNode(id) {
    if (!model.byId.has(id)) return;
    const nextView = activeView?.nodeIds.includes(id)
      ? activeView
      : model.views.find(view => view.id !== ALL_VIEW_ID && view.nodeIds.includes(id)) || model.views.find(view => view.id === ALL_VIEW_ID);
    setViewId(nextView.id);
    setQuery('');
    setSelectedId(id);
    revealDetails();
  }

  function handleTabKey(event, index) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? model.views.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + model.views.length) % model.views.length;
    chooseView(model.views[next].id);
    const tab = event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[next];
    tab?.focus();
  }

  return <div className="gf-system-map">
    <header className="gsm-header">
      <div><p className="gsm-eyebrow">GLASS FORGE · THE BIG PICTURE</p><h1 className="gsm-title">Your business, connected.</h1><p className="gsm-intro">{asText(data?.intro) || 'See what each system does, how work moves between them, and what needs attention next.'}</p></div>
      <div className="gsm-header-actions"><span className="gsm-snapshot"><span aria-hidden="true">◷</span> Saved snapshot · {displayDate(data?.updatedAt)}</span><button type="button" className="gsm-print-button" onClick={() => window.print()}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>Print full map</button></div>
    </header>

    <div className="gsm-toolbar">
      <div className="gsm-view-tabs" role="tablist" aria-label="System map views">{model.views.map((view, index) => <button type="button" key={view.id} id={`${reactId}-tab-${index}`} className="gsm-view-tab" role="tab" aria-selected={activeView.id === view.id} aria-controls={`${reactId}-view`} tabIndex={activeView.id === view.id ? 0 : -1} onClick={() => chooseView(view.id)} onKeyDown={event => handleTabKey(event, index)}>{view.title}<span>{view.nodeIds.length}</span></button>)}</div>
      <div className="gsm-search"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg><input id={searchId} type="search" value={query} onChange={event => { setQuery(event.target.value); setSelectedId(null); }} placeholder="Search every system…" aria-label="Search all systems, details, and next steps" />{query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button>}</div>
    </div>
    <div className="gsm-view-description"><p aria-live="polite">{search ? `${visibleNodes.length} ${visibleNodes.length === 1 ? 'match' : 'matches'} across all ${model.nodes.length} systems for “${search}”.` : activeView.description}</p><p>Snapshot only · select a card to explore</p></div>
    <div className="gsm-legend" aria-label="Recorded status legend">{Object.entries(STATUS).map(([status, item]) => <span className="gsm-legend-item" key={status}><span className={`gsm-status-dot is-${status}`} aria-hidden="true" />{item.label}</span>)}</div>

    <section className="gsm-workspace" id={`${reactId}-view`} role="tabpanel" aria-labelledby={`${reactId}-tab-${model.views.findIndex(view => view.id === activeView.id)}`}>
      <div className="gsm-diagram-shell">
        <div className="gsm-diagram-header"><div><h2 className="gsm-diagram-title">{search ? 'Search results' : activeView.title}</h2><p className="gsm-diagram-meta">{visibleNodes.length} systems · {visibleEdges.length} connections{hiddenConnections ? ` · ${hiddenConnections} connections outside this view` : ''}</p></div><span className="gsm-diagram-meta">Arrows show direction <ArrowIcon /></span></div>
        <div className="gsm-mobile-list" aria-label="Systems in this view">{visibleNodes.map(node => <button type="button" key={node.id} className="gsm-mobile-node" aria-pressed={selected?.id === node.id} aria-controls={detailId} onClick={() => selectNode(node.id)}><span><strong>{node.label}</strong><small>{node.category}</small></span><StatusBadge status={node.status} /></button>)}</div>
        {visibleNodes.length === 0 ? <div className="gsm-empty"><h3>{search ? 'No systems found' : 'This view is empty'}</h3><p>{search ? 'Try a system name, person, or a word from the work you want to find.' : 'Select another view to explore the snapshot.'}</p>{search && <button type="button" className="gsm-print-button" onClick={() => setQuery('')}>Clear search</button>}</div> : <div className="gsm-diagram-scroll" tabIndex={0} role="region" aria-label="Interactive system diagram. Scroll to explore, then select a system card.">
          <div className="gsm-diagram-canvas" style={{ width: layout.width, height: layout.height }}>
            <svg className="gsm-connectors" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              <defs><marker id={`${reactId}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9bad9f" /></marker><marker id={`${reactId}-arrow-active`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#175652" /></marker></defs>
              {visibleEdges.map((edge, index) => {
                const active = edge.from === selected?.id || edge.to === selected?.id;
                return <path key={`${edge.from}-${edge.to}-${index}`} d={connectionPath(layout.positions.get(edge.from), layout.positions.get(edge.to), index)} fill="none" stroke={active ? '#175652' : '#9bad9f'} strokeWidth={active ? 2.2 : 1.5} strokeOpacity={active ? 0.85 : 0.62} strokeDasharray={edge.status === 'planned' || edge.status === 'partial' ? '5 5' : edge.status === 'reference' ? '2 5' : undefined} strokeLinejoin="round" markerEnd={`url(#${reactId}-arrow${active ? '-active' : ''})`} />;
              })}
            </svg>
            {visibleNodes.map((node, index) => {
              const position = layout.positions.get(node.id);
              return <button type="button" key={node.id} className={`gsm-node${selected?.id === node.id ? ' is-selected' : ''}${relatedIds.has(node.id) ? ' is-related' : ''}`} data-status={node.status} style={{ left: position.x, top: position.y, width: position.width, height: position.height }} aria-pressed={selected?.id === node.id} aria-controls={detailId} aria-label={`${node.label}. ${statusInfo(node.status).label}. ${node.summary}`} onClick={() => selectNode(node.id)}><span className="gsm-node-top"><span className="gsm-node-category">{node.category}</span><span className="gsm-node-index">{String(index + 1).padStart(2, '0')}</span></span><strong className="gsm-node-label">{node.label}</strong><span className="gsm-node-summary">{node.summary}</span><StatusBadge status={node.status} /></button>;
            })}
          </div>
        </div>}
      </div>

      <aside className="gsm-details" id={detailId} tabIndex={-1} aria-label="Selected system details" aria-live="polite">
        {selected ? <><p className="gsm-detail-kicker">{selected.category}</p><h2 className="gsm-detail-title">{selected.label}</h2><StatusBadge status={selected.status} /><p className="gsm-detail-summary">{selected.summary}</p>{selected.owner && <div className="gsm-detail-meta"><span>Responsible</span><strong>{selected.owner}</strong></div>}
          {selected.details.length > 0 && <section className="gsm-detail-section"><h3>What to know</h3><ul className="gsm-detail-list">{selected.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul></section>}
          {selected.nextStep && <section className="gsm-next-step"><h3>Next step</h3><p>{selected.nextStep}</p></section>}
          {relatedEdges.length > 0 && <section className="gsm-detail-section"><h3>Connected to this system</h3><div className="gsm-related-links">{relatedEdges.map((edge, index) => {
            const outgoing = edge.from === selected.id;
            const other = model.byId.get(outgoing ? edge.to : edge.from);
            return <button type="button" key={`${other.id}-${index}`} onClick={() => jumpToNode(other.id)}><span><small>{outgoing ? 'To' : 'From'} · {asText(edge.label) || 'Connected system'}</small><strong>{other.label}</strong>{!visibleIds.has(other.id) && <small>Open in another view</small>}</span><ArrowIcon /></button>;
          })}</div></section>}
          {selected.links.length > 0 && <section className="gsm-detail-section"><h3>Open a reference</h3><ResourceLinks links={selected.links} /></section>}
        </> : <div className="gsm-details-empty"><h2>Explore a system</h2><p>Select a card to see its purpose, owner, connections, and next step.</p></div>}
      </aside>
    </section>

    <div className="gsm-bottom-grid">
      <section className="gsm-section"><div className="gsm-section-heading"><p className="gsm-eyebrow">FROM START TO FINISH</p><h2>How work moves</h2></div><div className="gsm-workflows">{model.workflows.length ? model.workflows.map(workflow => <article key={workflow.id} className="gsm-workflow"><h3>{workflow.title}</h3><p>{workflow.summary}</p><div className="gsm-workflow-steps" aria-label={`${workflow.title} steps`}>{workflow.steps.map((id, index) => <React.Fragment key={`${id}-${index}`}>{index > 0 && <ArrowIcon size={14} />}<button type="button" className="gsm-workflow-step" onClick={() => jumpToNode(id)}><span>{index + 1}</span>{model.byId.get(id).label}</button></React.Fragment>)}</div></article>) : <p className="gsm-diagram-meta">No workflows are included in this snapshot.</p>}</div></section>
      <section className="gsm-section"><div className="gsm-section-heading"><p className="gsm-eyebrow">THE NEXT CONVERSATION</p><h2>Needs attention <span>{model.openItems.length}</span></h2></div><ul className="gsm-attention-list">{model.openItems.map((item, index) => <li className="gsm-attention-item" key={`${asText(item.title)}-${index}`}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><h3>{asText(item.title) || 'Follow-up'}</h3><p>{asText(item.detail)}</p>{model.byId.has(item.nodeId) && <button type="button" onClick={() => jumpToNode(item.nodeId)}>Explore {model.byId.get(item.nodeId).label}<ArrowIcon size={14} /></button>}</div></li>)}</ul>{!model.openItems.length && <p className="gsm-diagram-meta">No open items are recorded in this snapshot.</p>}</section>
    </div>
    <PrintCatalog data={data} model={model} />
    <p className="gsm-source-note">{asText(data?.sourceNote) || 'This map describes a saved snapshot. Recorded working means supported by the available notes; it is not a live health check.'}</p>
  </div>;
}
