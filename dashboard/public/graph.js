const CATEGORY_COLORS = {
  decisions: '#f26430',
  lessons: '#4ecdc4',
  people: '#ff6b6b',
  projects: '#95e1d3',
  commitments: '#f9d56e',
  research: '#a8e6cf',
  inbox: '#888888',
  root: '#666666',
  default: '#aaaaaa'
};

const HIGHLIGHT_NODE_COLOR = '#ffffff';
const HIGHLIGHT_LINK_COLOR = '#f3f4f6';
const DIMMED_NODE_COLOR = '#324055';
const DIMMED_LINK_COLOR = 'rgba(130, 145, 170, 0.2)';

const state = {
  searchTerm: '',
  category: 'all',
  nodes: [],
  links: [],
  stats: null,
  nodeById: new Map(),
  neighborsByNodeId: new Map(),
  linksByNodeId: new Map(),
  hoveredNode: null,
  selectedNode: null,
  highlightedNodeIds: new Set(),
  highlightedLinks: new Set()
};

const graphElement = document.querySelector('#graph');
const detailsElement = document.querySelector('#node-details');
const statsElement = document.querySelector('#stats');
const searchElement = document.querySelector('#search');
const categoryFilterElement = document.querySelector('#category-filter');
const refreshButtonElement = document.querySelector('#refresh');

if (typeof window.ForceGraph !== 'function') {
  statsElement.textContent = 'ForceGraph failed to load.';
  throw new Error('force-graph library unavailable');
}

const graph = window
  .ForceGraph()(graphElement)
  .backgroundColor('#0c1117')
  .nodeId('id')
  .linkSource('source')
  .linkTarget('target')
  .nodeRelSize(5)
  .nodeVal((node) => 1 + Math.sqrt((node.degree ?? 0) + 1))
  .nodeLabel((node) => `${node.title}\n${node.id}`)
  .nodeColor((node) => getNodeColor(node))
  .linkColor((link) => getLinkColor(link))
  .linkWidth((link) => (state.highlightedLinks.has(link) ? 2.6 : 1))
  .linkDirectionalParticles((link) => (state.highlightedLinks.has(link) ? 2 : 0))
  .linkDirectionalParticleWidth(2)
  .cooldownTicks(120)
  .onNodeHover((node) => {
    state.hoveredNode = node ?? null;
    syncHighlights();
  })
  .onNodeClick((node) => {
    state.selectedNode = node;
    syncHighlights();
    renderDetails(node);
  })
  .onBackgroundClick(() => {
    state.selectedNode = null;
    syncHighlights();
    renderEmptyDetails();
  });

resizeGraphToContainer();

window.addEventListener('resize', () => {
  resizeGraphToContainer();
});

function resizeGraphToContainer() {
  graph.width(graphElement.clientWidth);
  graph.height(graphElement.clientHeight);
}

searchElement.addEventListener('input', (event) => {
  state.searchTerm = String(event.target.value ?? '').trim().toLowerCase();
  applyFilters();
});

categoryFilterElement.addEventListener('change', (event) => {
  state.category = String(event.target.value ?? 'all');
  applyFilters();
});

refreshButtonElement.addEventListener('click', async () => {
  await loadGraphData({ refresh: true });
});

detailsElement.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const linkedNodeId = target.dataset.nodeId;
  if (!linkedNodeId) {
    return;
  }

  event.preventDefault();
  const linkedNode = state.nodeById.get(linkedNodeId);
  if (!linkedNode) {
    return;
  }

  state.selectedNode = linkedNode;
  syncHighlights();
  renderDetails(linkedNode);
  graph.centerAt(linkedNode.x ?? 0, linkedNode.y ?? 0, 450);
  graph.zoom(4, 350);
});

await loadGraphData();

async function loadGraphData({ refresh = false } = {}) {
  statsElement.textContent = 'Loading graph...';
  refreshButtonElement.disabled = true;
  try {
    const response = await fetch(refresh ? '/api/graph?refresh=1' : '/api/graph');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    const nodes = payload.nodes ?? [];
    const links = (payload.edges ?? []).map((edge) => ({
      source: edge.source,
      target: edge.target
    }));

    hydrateState(nodes, links, payload.stats ?? null);
    populateCategoryFilter();
    applyFilters();
    renderEmptyDetails();
    updateStats();
    graph.zoomToFit(600, 80);
  } catch (error) {
    statsElement.textContent = `Failed to load graph: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    refreshButtonElement.disabled = false;
  }
}

function hydrateState(nodes, links, stats) {
  state.nodes = nodes;
  state.links = links;
  state.stats = stats;
  state.nodeById = new Map(nodes.map((node) => [node.id, node]));
  state.neighborsByNodeId = new Map();
  state.linksByNodeId = new Map();
  state.hoveredNode = null;
  state.selectedNode = null;

  for (const node of nodes) {
    state.neighborsByNodeId.set(node.id, new Set());
    state.linksByNodeId.set(node.id, new Set());
  }

  for (const link of links) {
    const sourceId = getNodeId(link.source);
    const targetId = getNodeId(link.target);
    if (!sourceId || !targetId) {
      continue;
    }
    state.neighborsByNodeId.get(sourceId)?.add(targetId);
    state.neighborsByNodeId.get(targetId)?.add(sourceId);
    state.linksByNodeId.get(sourceId)?.add(link);
    state.linksByNodeId.get(targetId)?.add(link);
  }

  graph.graphData({ nodes: state.nodes, links: state.links });
}

function applyFilters() {
  graph.nodeVisibility((node) => isNodeVisible(node));
  graph.linkVisibility((link) => {
    const sourceNode = getNodeFromLinkEnd(link.source);
    const targetNode = getNodeFromLinkEnd(link.target);
    return Boolean(sourceNode && targetNode && isNodeVisible(sourceNode) && isNodeVisible(targetNode));
  });
  syncHighlights();
  graph.refresh();
}

function syncHighlights() {
  state.highlightedNodeIds.clear();
  state.highlightedLinks.clear();

  const focusNode = state.selectedNode ?? state.hoveredNode;
  if (!focusNode) {
    graph.refresh();
    return;
  }

  const focusNodeId = focusNode.id;
  state.highlightedNodeIds.add(focusNodeId);

  for (const neighborId of state.neighborsByNodeId.get(focusNodeId) ?? []) {
    state.highlightedNodeIds.add(neighborId);
  }
  for (const link of state.linksByNodeId.get(focusNodeId) ?? []) {
    state.highlightedLinks.add(link);
  }

  graph.refresh();
}

function renderEmptyDetails() {
  detailsElement.innerHTML = '<p>Select a node to inspect details and connections.</p>';
}

function renderDetails(node) {
  const neighbors = Array.from(state.neighborsByNodeId.get(node.id) ?? [])
    .map((id) => state.nodeById.get(id))
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title));

  const tags = Array.isArray(node.tags) && node.tags.length > 0 ? node.tags.join(', ') : 'none';
  const category = node.category || 'default';
  const degree = Number(node.degree ?? neighbors.length);
  const pathValue = node.path ?? '(unresolved link target)';

  const connectionItems = neighbors.length
    ? neighbors
        .map((neighbor) => {
          const color = colorForCategory(neighbor.category);
          return `<li><a href="#" class="connection-link" data-node-id="${escapeHtml(neighbor.id)}" style="color:${color}">${escapeHtml(neighbor.title)}</a></li>`;
        })
        .join('')
    : '<li>No direct connections</li>';

  detailsElement.innerHTML = `
    <div class="meta-label">Title</div>
    <p class="meta-value">${escapeHtml(node.title)}</p>
    <div class="meta-label">ID</div>
    <p class="meta-value">${escapeHtml(node.id)}</p>
    <div class="meta-label">Category</div>
    <p class="meta-value">${escapeHtml(category)}</p>
    <div class="meta-label">Tags</div>
    <p class="meta-value">${escapeHtml(tags)}</p>
    <div class="meta-label">Degree</div>
    <p class="meta-value">${degree}</p>
    <div class="meta-label">Path</div>
    <p class="meta-value">${escapeHtml(pathValue)}</p>
    <div class="meta-label">Connections (${neighbors.length})</div>
    <ul class="connection-list">${connectionItems}</ul>
  `;
}

function updateStats() {
  const nodeCount = state.stats?.nodeCount ?? state.nodes.length;
  const edgeCount = state.stats?.edgeCount ?? state.links.length;
  const fileCount = state.stats?.fileCount ?? state.nodes.length;
  statsElement.textContent = `${nodeCount} nodes • ${edgeCount} links • ${fileCount} files`;
}

function populateCategoryFilter() {
  const currentValue = state.category;
  const categories = new Set(['all']);
  for (const node of state.nodes) {
    categories.add(node.category || 'default');
  }

  const options = Array.from(categories).sort((a, b) => {
    if (a === 'all') return -1;
    if (b === 'all') return 1;
    return a.localeCompare(b);
  });

  categoryFilterElement.innerHTML = options
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value === 'all' ? 'All categories' : value)}</option>`)
    .join('');

  if (options.includes(currentValue)) {
    categoryFilterElement.value = currentValue;
    state.category = currentValue;
  } else {
    categoryFilterElement.value = 'all';
    state.category = 'all';
  }
}

function getNodeColor(node) {
  const nodeId = node.id;
  if (!isNodeVisible(node)) {
    return DIMMED_NODE_COLOR;
  }
  if (state.highlightedNodeIds.has(nodeId)) {
    return HIGHLIGHT_NODE_COLOR;
  }
  if ((state.selectedNode || state.hoveredNode) && !state.highlightedNodeIds.has(nodeId)) {
    return DIMMED_NODE_COLOR;
  }
  return colorForCategory(node.category);
}

function getLinkColor(link) {
  if (state.highlightedLinks.has(link)) {
    return HIGHLIGHT_LINK_COLOR;
  }
  const sourceNode = getNodeFromLinkEnd(link.source);
  const targetNode = getNodeFromLinkEnd(link.target);
  if (!sourceNode || !targetNode || !isNodeVisible(sourceNode) || !isNodeVisible(targetNode)) {
    return 'rgba(0, 0, 0, 0)';
  }
  if (state.selectedNode || state.hoveredNode) {
    return DIMMED_LINK_COLOR;
  }
  return 'rgba(157, 176, 198, 0.36)';
}

function isNodeVisible(node) {
  const matchesCategory = state.category === 'all' || (node.category || 'default') === state.category;
  if (!matchesCategory) {
    return false;
  }

  if (!state.searchTerm) {
    return true;
  }

  const haystack = [
    node.id,
    node.title,
    Array.isArray(node.tags) ? node.tags.join(' ') : '',
    node.category
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(state.searchTerm);
}

function getNodeFromLinkEnd(linkEnd) {
  if (!linkEnd) {
    return null;
  }
  if (typeof linkEnd === 'object') {
    return linkEnd;
  }
  return state.nodeById.get(linkEnd) ?? null;
}

function getNodeId(linkEnd) {
  if (!linkEnd) {
    return '';
  }
  if (typeof linkEnd === 'object') {
    return linkEnd.id || '';
  }
  return String(linkEnd);
}

function colorForCategory(category) {
  return CATEGORY_COLORS[category] ?? CATEGORY_COLORS.default;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
