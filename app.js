/* ================================================================
   MapView – KMZ/KML Reader  |  app.js
   ================================================================ */
'use strict';

// ── GLOBAL STATE ─────────────────────────────────────────────────
const State = {
  files: [],          // { id, name, type, layers, featureGroup, visible, color }
  activeFileId: null,
  selectedFeature: null,
  map: null,
  tileLayer: null,
  userMarker: null,
};

const BASEMAPS = {
  osm:       { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',           attr: '© OpenStreetMap contributors' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri, Maxar, Earthstar Geographics' },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',              attr: '© OpenTopoMap contributors' },
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', attr: '© CARTO, © OpenStreetMap contributors' },
};

const FILE_COLORS = ['#4fc3f7','#81c784','#ffb74d','#f06292','#ce93d8','#80cbc4','#fff176','#ff8a65'];
let colorIdx = 0;
const nextColor = () => FILE_COLORS[colorIdx++ % FILE_COLORS.length];

// ── INIT ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initUI();
  registerSW();
  loadSavedFiles();

  // Hide splash after short delay
  setTimeout(() => document.getElementById('splash').classList.add('hidden'), 1200);
});

// ── MAP INIT ──────────────────────────────────────────────────────
function initMap() {
  State.map = L.map('map', {
    center: [-14.235, -51.925],
    zoom: 4,
    zoomControl: false,
  });

  L.control.zoom({ position: 'bottomright' }).addTo(State.map);

  State.tileLayer = L.tileLayer(BASEMAPS.osm.url, {
    attribution: BASEMAPS.osm.attr,
    maxZoom: 19,
  }).addTo(State.map);

  // Click on map → close detail
  State.map.on('click', () => {
    if (State.selectedFeature) deselectFeature();
  });
}

// ── UI INIT ───────────────────────────────────────────────────────
function initUI() {
  // Sidebar toggle
  document.getElementById('btn-sidebar').addEventListener('click', openSidebar);
  document.getElementById('btn-close-sidebar').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // File open
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-upload').addEventListener('click', () => fileInput.click());
  document.getElementById('btn-add-file').addEventListener('click', () => fileInput.click());
  document.getElementById('btn-drop-hint').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFiles(e.target.files));

  // Fit
  document.getElementById('btn-fit').addEventListener('click', fitAll);

  // Search
  document.getElementById('btn-search').addEventListener('click', toggleSearch);
  document.getElementById('btn-close-search').addEventListener('click', () => document.getElementById('search-bar').classList.add('hidden'));
  document.getElementById('search-input').addEventListener('input', onSearchInput);

  // Detail panel
  document.getElementById('btn-close-detail').addEventListener('click', closeDetail);
  document.getElementById('btn-google-maps').addEventListener('click', openGoogleMaps);
  document.getElementById('btn-copy-coords').addEventListener('click', copyCoords);
  document.getElementById('btn-go-to').addEventListener('click', goToSelected);

  // FAB location
  document.getElementById('fab-location').addEventListener('click', locateUser);

  // Collapse all
  document.getElementById('btn-collapse-all').addEventListener('click', collapseAll);

  // Basemap
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const bm = BASEMAPS[btn.dataset.basemap];
      State.tileLayer.setUrl(bm.url);
    });
  });

  // Drag & Drop
  const body = document.body;
  let dragCount = 0;
  body.addEventListener('dragenter', e => { e.preventDefault(); dragCount++; showDropOverlay(); });
  body.addEventListener('dragleave', () => { dragCount--; if (dragCount <= 0) { dragCount = 0; hideDropOverlay(); } });
  body.addEventListener('dragover', e => e.preventDefault());
  body.addEventListener('drop', e => {
    e.preventDefault(); dragCount = 0; hideDropOverlay();
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
}

function openSidebar()  { document.getElementById('sidebar').classList.remove('closed'); document.getElementById('sidebar-overlay').classList.remove('hidden'); }
function closeSidebar() { document.getElementById('sidebar').classList.add('closed'); document.getElementById('sidebar-overlay').classList.add('hidden'); }
function showDropOverlay() { document.getElementById('drop-overlay').classList.remove('hidden'); }
function hideDropOverlay() { document.getElementById('drop-overlay').classList.add('hidden'); }
function toggleSearch() {
  const sb = document.getElementById('search-bar');
  sb.classList.toggle('hidden');
  if (!sb.classList.contains('hidden')) document.getElementById('search-input').focus();
}

// ── FILE HANDLING ─────────────────────────────────────────────────
async function handleFiles(fileList) {
  for (const file of fileList) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['kml','kmz'].includes(ext)) { toast('Formato não suportado: ' + file.name, 'error'); continue; }
    toast('Carregando ' + file.name + '…');
    try {
      let kmlText;
      if (ext === 'kmz') {
        const zip = await JSZip.loadAsync(file);
        // find the main KML inside the KMZ
        const kmlFile = Object.values(zip.files).find(f => f.name.endsWith('.kml'));
        if (!kmlFile) throw new Error('KML não encontrado dentro do KMZ.');
        kmlText = await kmlFile.async('text');
      } else {
        kmlText = await file.text();
      }
      processKML(kmlText, file.name);
    } catch (err) {
      toast('Erro ao carregar ' + file.name + ': ' + err.message, 'error');
      console.error(err);
    }
  }
}

// ── KML PARSE ─────────────────────────────────────────────────────
function processKML(kmlText, fileName) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, 'text/xml');

  if (doc.querySelector('parsererror')) {
    toast('KML inválido: ' + fileName, 'error');
    return;
  }

  const color = nextColor();
  const fileId = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2);
  const featureGroup = L.featureGroup().addTo(State.map);

  const fileObj = {
    id: fileId,
    name: fileName,
    type: fileName.endsWith('.kmz') ? 'kmz' : 'kml',
    color,
    featureGroup,
    visible: true,
    layers: [],  // { id, name, type, latlng, leafletLayer, props, description, visible }
    stats: { points: 0, lines: 0, polygons: 0 },
  };

  // Parse folders and placemarks
  const root = doc.querySelector('Document') || doc.querySelector('kml');
  if (root) parseFolders(root, fileObj, null, doc);

  if (fileObj.layers.length === 0) {
    toast('Nenhuma geometria encontrada em ' + fileName, 'error');
    return;
  }

  State.files.push(fileObj);
  State.activeFileId = fileId;

  renderFileList();
  renderLayerTree();
  updateStats();
  saveToStorage();
  fitAll();
  toast(fileName + ' carregado com sucesso!', 'success');
  openSidebar();
}

function parseFolders(node, fileObj, parentFolder, doc) {
  // Placemarks in this level
  for (const pm of node.children) {
    if (pm.tagName === 'Placemark') {
      parsePlacemark(pm, fileObj, parentFolder, doc);
    } else if (pm.tagName === 'Folder' || pm.tagName === 'Document') {
      const folderName = getNodeText(pm, 'name') || 'Pasta';
      const folder = { id: 'folder_' + Math.random().toString(36).slice(2), name: folderName, type: 'folder', children: [], visible: true };
      if (parentFolder) parentFolder.children.push(folder);
      else fileObj.layers.push(folder);
      parseFolders(pm, fileObj, folder, doc);
    }
  }
}

function parsePlacemark(pm, fileObj, parentFolder, doc) {
  const name = getNodeText(pm, 'name') || 'Sem nome';
  const description = getNodeText(pm, 'description') || '';
  const props = parseExtendedData(pm);

  // Style / color
  let featureColor = fileObj.color;
  const styleUrl = getNodeText(pm, 'styleUrl');
  if (styleUrl) {
    const styleId = styleUrl.replace('#', '');
    const styleEl = doc.getElementById(styleId) || findStyle(doc, styleId);
    if (styleEl) {
      const lineColor = getNodeText(styleEl, 'color', 'LineStyle');
      const polyColor = getNodeText(styleEl, 'color', 'PolyStyle');
      const iconColor = getNodeText(styleEl, 'color', 'IconStyle');
      const raw = lineColor || polyColor || iconColor;
      if (raw) featureColor = kmlColorToHex(raw);
    }
  }

  let leafletLayer = null;
  let layerType = 'point';
  let latlng = null;

  // Point
  const pointEl = pm.querySelector('Point');
  if (pointEl) {
    latlng = parseCoords(getNodeText(pointEl, 'coordinates'))[0];
    if (latlng) {
      leafletLayer = createMarker(latlng, featureColor, name);
      layerType = 'point';
      fileObj.stats.points++;
    }
  }

  // LineString
  const lineEl = pm.querySelector('LineString');
  if (lineEl) {
    const coords = parseCoords(getNodeText(lineEl, 'coordinates'));
    if (coords.length >= 2) {
      latlng = centroid(coords);
      leafletLayer = L.polyline(coords, { color: featureColor, weight: 3, opacity: .85 });
      layerType = 'line';
      fileObj.stats.lines++;
    }
  }

  // MultiGeometry LineStrings
  const multiEl = pm.querySelector('MultiGeometry');
  if (multiEl) {
    const lines = [...multiEl.querySelectorAll('LineString')];
    const polys = [...multiEl.querySelectorAll('Polygon')];
    const allCoords = [];
    if (lines.length) {
      lines.forEach(l => { const c = parseCoords(getNodeText(l, 'coordinates')); allCoords.push(...c); });
      latlng = centroid(allCoords);
      leafletLayer = L.polyline(lines.map(l => parseCoords(getNodeText(l, 'coordinates'))), { color: featureColor, weight: 3, opacity: .85 });
      layerType = 'line';
      fileObj.stats.lines++;
    } else if (polys.length) {
      const rings = polys.map(p => {
        const outer = p.querySelector('outerBoundaryIs coordinates') || p.querySelector('coordinates');
        return outer ? parseCoords(outer.textContent) : [];
      });
      latlng = centroid(rings.flat());
      leafletLayer = L.polygon(rings, { color: featureColor, weight: 2, fillOpacity: .35 });
      layerType = 'polygon';
      fileObj.stats.polygons++;
    }
  }

  // Polygon
  const polyEl = pm.querySelector('Polygon');
  if (polyEl) {
    const outerEl = polyEl.querySelector('outerBoundaryIs');
    const outerCoords = outerEl ? parseCoords(getNodeText(outerEl, 'coordinates')) : [];
    const innerEls = polyEl.querySelectorAll('innerBoundaryIs');
    const holes = [...innerEls].map(h => parseCoords(getNodeText(h, 'coordinates')));
    if (outerCoords.length >= 3) {
      latlng = centroid(outerCoords);
      leafletLayer = L.polygon([outerCoords, ...holes], { color: featureColor, weight: 2, fillOpacity: .3 });
      layerType = 'polygon';
      fileObj.stats.polygons++;
    }
  }

  if (!leafletLayer) return;

  const layerId = 'lyr_' + Math.random().toString(36).slice(2);
  const layerObj = {
    id: layerId, name, type: layerType, latlng,
    leafletLayer, props, description, visible: true,
    color: featureColor, fileId: fileObj.id,
  };

  // Bind popup and click
  attachLayerEvents(layerObj, fileObj);
  fileObj.featureGroup.addLayer(leafletLayer);

  if (parentFolder) parentFolder.children.push(layerObj);
  else fileObj.layers.push(layerObj);
}

function attachLayerEvents(layerObj, fileObj) {
  layerObj.leafletLayer.on('click', e => {
    L.DomEvent.stopPropagation(e);
    selectFeature(layerObj);
  });
}

// ── FEATURE SELECTION ─────────────────────────────────────────────
function selectFeature(layerObj) {
  State.selectedFeature = layerObj;

  // Highlight
  if (layerObj.type === 'point') {
    layerObj.leafletLayer.setIcon(createPinIcon(layerObj.color, true));
  } else {
    layerObj.leafletLayer.setStyle({ weight: 5, opacity: 1 });
  }

  // Deselect previous selected in tree
  document.querySelectorAll('.feature-item.selected').forEach(el => el.classList.remove('selected'));
  const treeEl = document.querySelector(`[data-layer-id="${layerObj.id}"]`);
  if (treeEl) treeEl.classList.add('selected');

  showDetail(layerObj);
}

function deselectFeature() {
  if (!State.selectedFeature) return;
  const lyr = State.selectedFeature;
  if (lyr.type === 'point') {
    lyr.leafletLayer.setIcon(createPinIcon(lyr.color, false));
  } else {
    lyr.leafletLayer.setStyle({ weight: lyr.type === 'line' ? 3 : 2, opacity: .85 });
  }
  document.querySelectorAll('.feature-item.selected').forEach(el => el.classList.remove('selected'));
  State.selectedFeature = null;
  closeDetail();
}

// ── DETAIL PANEL ──────────────────────────────────────────────────
function showDetail(lyr) {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  panel.querySelector('.hidden')?.classList.remove('hidden');

  document.getElementById('detail-name').textContent = lyr.name;

  const typeLabels = { point: 'Ponto', line: 'Linha', polygon: 'Polígono' };
  document.getElementById('detail-type-label').textContent = typeLabels[lyr.type] || lyr.type;

  const icon = document.getElementById('detail-type-icon');
  const typeIcons = {
    point:   { bg: '#1565c0', html: '📍' },
    line:    { bg: '#2e7d32', html: '〰' },
    polygon: { bg: '#4a148c', html: '⬡' },
  };
  const ti = typeIcons[lyr.type] || typeIcons.point;
  icon.style.background = ti.bg + '33';
  icon.textContent = ti.html;

  // Description (strip HTML tags for safety, but keep line breaks)
  const descEl = document.getElementById('detail-description');
  const rawDesc = lyr.description || '';
  const stripped = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  descEl.textContent = stripped;
  descEl.style.display = stripped ? '' : 'none';

  // Coords
  const coordsEl = document.getElementById('detail-coords');
  if (lyr.latlng) {
    coordsEl.textContent = `${lyr.latlng.lat.toFixed(6)}, ${lyr.latlng.lng.toFixed(6)}`;
    coordsEl.style.display = '';
  } else {
    coordsEl.style.display = 'none';
  }

  // Props table
  const table = document.getElementById('detail-props');
  table.innerHTML = '';
  if (lyr.props && Object.keys(lyr.props).length) {
    for (const [k, v] of Object.entries(lyr.props)) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th>${escHtml(k)}</th><td>${escHtml(v)}</td>`;
      table.appendChild(tr);
    }
  }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
}

function openGoogleMaps() {
  if (!State.selectedFeature?.latlng) return;
  const { lat, lng } = State.selectedFeature.latlng;
  const name = encodeURIComponent(State.selectedFeature.name);
  window.open(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}&query_place_id=${name}`, '_blank');
}

function copyCoords() {
  if (!State.selectedFeature?.latlng) return;
  const { lat, lng } = State.selectedFeature.latlng;
  navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`).then(() => toast('Coordenadas copiadas!', 'success'));
}

function goToSelected() {
  if (!State.selectedFeature?.latlng) return;
  State.map.flyTo(State.selectedFeature.latlng, 15, { duration: 1.2 });
}

// ── LAYER TREE RENDER ─────────────────────────────────────────────
function renderLayerTree() {
  const container = document.getElementById('layer-tree');
  container.innerHTML = '';
  const file = State.files.find(f => f.id === State.activeFileId);
  if (!file) {
    document.getElementById('layers-section').classList.add('hidden');
    return;
  }
  document.getElementById('layers-section').classList.remove('hidden');
  file.layers.forEach(node => container.appendChild(buildTreeNode(node, file)));
}

function buildTreeNode(node, file) {
  if (node.type === 'folder') {
    return buildFolder(node, file);
  }
  return buildFeatureItem(node, file);
}

function buildFolder(folder, file) {
  const wrap = document.createElement('div');
  wrap.className = 'folder-item';

  const header = document.createElement('div');
  header.className = 'folder-header';

  const toggle = document.createElement('span');
  toggle.className = 'folder-toggle open';
  toggle.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="m9 18 6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  const vis = document.createElement('span');
  vis.className = 'folder-vis' + (folder.visible ? '' : ' hidden-layer');
  vis.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>`;
  vis.title = 'Alternar visibilidade';

  const nameEl = document.createElement('span');
  nameEl.className = 'folder-name';
  nameEl.textContent = folder.name;

  const count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = countLeaves(folder);

  header.append(toggle, vis, nameEl, count);

  const children = document.createElement('div');
  children.className = 'folder-children';
  folder.children.forEach(c => children.appendChild(buildTreeNode(c, file)));

  // Toggle open/close
  toggle.addEventListener('click', () => {
    const isOpen = toggle.classList.toggle('open');
    children.style.display = isOpen ? '' : 'none';
  });

  // Toggle visibility
  vis.addEventListener('click', e => {
    e.stopPropagation();
    folder.visible = !folder.visible;
    vis.classList.toggle('hidden-layer', !folder.visible);
    toggleFolderVisibility(folder, folder.visible);
  });

  wrap.append(header, children);
  return wrap;
}

function buildFeatureItem(lyr, file) {
  const item = document.createElement('div');
  item.className = 'feature-item';
  item.dataset.layerId = lyr.id;

  const dot = document.createElement('div');
  dot.className = 'feature-dot ' + lyr.type;
  dot.style.background = lyr.color;
  if (lyr.type === 'polygon') dot.style.border = `2px solid ${lyr.color}`;

  const vis = document.createElement('span');
  vis.className = 'feature-vis' + (lyr.visible ? '' : ' hidden-layer');
  vis.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>`;

  const nameEl = document.createElement('span');
  nameEl.className = 'feature-name';
  nameEl.textContent = lyr.name;
  nameEl.title = lyr.name;

  item.append(dot, nameEl, vis);

  item.addEventListener('click', () => {
    if (lyr.latlng) { State.map.flyTo(lyr.latlng, lyr.type === 'point' ? 15 : 13, { duration: 1 }); }
    selectFeature(lyr);
  });

  vis.addEventListener('click', e => {
    e.stopPropagation();
    lyr.visible = !lyr.visible;
    vis.classList.toggle('hidden-layer', !lyr.visible);
    if (lyr.visible) file.featureGroup.addLayer(lyr.leafletLayer);
    else file.featureGroup.removeLayer(lyr.leafletLayer);
  });

  return item;
}

// ── FILE LIST RENDER ──────────────────────────────────────────────
function renderFileList() {
  const list = document.getElementById('file-list');
  const noFiles = document.getElementById('no-files');
  list.innerHTML = '';

  if (State.files.length === 0) {
    noFiles.style.display = '';
    return;
  }
  noFiles.style.display = 'none';

  State.files.forEach(file => {
    const li = document.createElement('li');
    li.className = 'file-item' + (file.id === State.activeFileId ? ' active' : '');

    const icon = document.createElement('div');
    icon.className = 'file-item-icon';
    icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" stroke="${file.color}" stroke-width="2"/><polyline points="14 2 14 8 20 8" stroke="${file.color}" stroke-width="2"/></svg>`;

    const nameEl = document.createElement('span');
    nameEl.className = 'file-item-name';
    nameEl.textContent = file.name;
    nameEl.title = file.name;

    const del = document.createElement('button');
    del.className = 'file-item-del';
    del.title = 'Remover arquivo';
    del.innerHTML = `<svg viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    del.addEventListener('click', e => { e.stopPropagation(); removeFile(file.id); });

    li.append(icon, nameEl, del);
    li.addEventListener('click', () => switchActiveFile(file.id));
    list.appendChild(li);
  });

  document.getElementById('current-file-name').textContent =
    State.files.find(f => f.id === State.activeFileId)?.name || 'MapView';
}

function switchActiveFile(fileId) {
  State.activeFileId = fileId;
  renderFileList();
  renderLayerTree();
  updateStats();
  fitAll();
}

function removeFile(fileId) {
  const idx = State.files.findIndex(f => f.id === fileId);
  if (idx < 0) return;
  const file = State.files[idx];
  file.featureGroup.clearLayers();
  State.map.removeLayer(file.featureGroup);
  State.files.splice(idx, 1);
  if (State.activeFileId === fileId) {
    State.activeFileId = State.files[0]?.id || null;
  }
  closeDetail();
  renderFileList();
  renderLayerTree();
  updateStats();
  saveToStorage();
  toast('Arquivo removido.');
}

// ── STATS ─────────────────────────────────────────────────────────
function updateStats() {
  const file = State.files.find(f => f.id === State.activeFileId);
  const s = file?.stats || { points: 0, lines: 0, polygons: 0 };
  document.getElementById('stat-points').textContent = s.points + ' pontos';
  document.getElementById('stat-lines').textContent = s.lines + ' linhas';
  document.getElementById('stat-polygons').textContent = s.polygons + ' polígonos';
}

// ── SEARCH ────────────────────────────────────────────────────────
function onSearchInput() {
  const q = document.getElementById('search-input').value.trim().toLowerCase();
  const resultsEl = document.getElementById('search-results');
  resultsEl.innerHTML = '';
  if (!q || q.length < 2) return;

  const results = [];
  State.files.forEach(file => {
    collectLeaves(file.layers).forEach(lyr => {
      if (lyr.name.toLowerCase().includes(q)) results.push({ lyr, file });
    });
  });

  if (results.length === 0) {
    resultsEl.innerHTML = `<li class="search-no-results">Nenhum resultado para "${q}"</li>`;
    return;
  }

  results.slice(0, 30).forEach(({ lyr, file }) => {
    const li = document.createElement('li');
    li.className = 'search-result-item';
    const typeIcons = { point: '📍', line: '〰', polygon: '⬡' };
    li.innerHTML = `
      <div class="search-result-icon" style="background:${lyr.color}22">
        <span style="font-size:1rem">${typeIcons[lyr.type] || '📍'}</span>
      </div>
      <div class="search-result-text">
        <h4>${escHtml(lyr.name)}</h4>
        <p>${escHtml(file.name)}</p>
      </div>`;
    li.addEventListener('click', () => {
      document.getElementById('search-bar').classList.add('hidden');
      switchActiveFile(file.id);
      if (lyr.latlng) State.map.flyTo(lyr.latlng, lyr.type === 'point' ? 15 : 13, { duration: 1 });
      selectFeature(lyr);
    });
    resultsEl.appendChild(li);
  });
}

// ── FIT MAP ───────────────────────────────────────────────────────
function fitAll() {
  const file = State.files.find(f => f.id === State.activeFileId);
  if (!file || !file.featureGroup.getLayers().length) return;
  const bounds = file.featureGroup.getBounds();
  if (bounds.isValid()) State.map.flyToBounds(bounds, { padding: [30, 30], duration: 1 });
}

// ── COLLAPSE ALL FOLDERS ──────────────────────────────────────────
function collapseAll() {
  document.querySelectorAll('.folder-toggle.open').forEach(toggle => {
    toggle.classList.remove('open');
    toggle.nextElementSibling?.nextElementSibling?.nextElementSibling
      // navigate to children div
    const header = toggle.parentElement;
    const children = header.nextElementSibling;
    if (children?.classList.contains('folder-children')) children.style.display = 'none';
  });
}

// ── FOLDER VISIBILITY ─────────────────────────────────────────────
function toggleFolderVisibility(folder, visible) {
  const file = State.files.find(f => f.id === State.activeFileId);
  if (!file) return;
  folder.children.forEach(child => {
    if (child.type === 'folder') {
      toggleFolderVisibility(child, visible);
    } else {
      child.visible = visible;
      if (visible) file.featureGroup.addLayer(child.leafletLayer);
      else file.featureGroup.removeLayer(child.leafletLayer);
    }
  });
}

// ── GEOLOCATION ───────────────────────────────────────────────────
function locateUser() {
  if (!navigator.geolocation) { toast('Geolocalização não disponível', 'error'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    if (State.userMarker) State.map.removeLayer(State.userMarker);
    State.userMarker = L.circleMarker([lat, lng], {
      radius: 9, color: '#fff', weight: 2, fillColor: '#2196f3', fillOpacity: 1,
    }).addTo(State.map).bindPopup('Você está aqui').openPopup();
    State.map.flyTo([lat, lng], 15, { duration: 1.2 });
  }, () => toast('Não foi possível obter sua localização', 'error'));
}

// ── MARKERS ───────────────────────────────────────────────────────
function createMarker(latlng, color, title) {
  return L.marker([latlng.lat, latlng.lng], { icon: createPinIcon(color, false), title });
}

function createPinIcon(color, selected) {
  const size = selected ? 38 : 30;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="${size}" height="${Math.round(size*42/32)}">
    <path d="M16 2C9.37 2 4 7.37 4 14c0 9.22 12 26 12 26s12-16.78 12-26C28 7.37 22.63 2 16 2Z"
      fill="${color}" stroke="${selected ? '#fff' : 'rgba(0,0,0,.3)'}" stroke-width="${selected ? 2 : 1.5}"/>
    <circle cx="16" cy="14" r="5" fill="rgba(255,255,255,0.85)"/>
  </svg>`;
  return L.divIcon({
    html: svg, className: '', iconSize: [size, Math.round(size*42/32)],
    iconAnchor: [size/2, Math.round(size*42/32)], popupAnchor: [0, -Math.round(size*42/32)],
  });
}

// ── KML HELPERS ───────────────────────────────────────────────────
function getNodeText(node, tag, context) {
  const search = context ? node.querySelector(context + ' ' + tag) || node.querySelector(tag) : node.querySelector(tag);
  return search?.textContent?.trim() || '';
}

function parseCoords(coordStr) {
  if (!coordStr) return [];
  return coordStr.trim().split(/\s+/).map(c => {
    const parts = c.split(',');
    const lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
    return isNaN(lat) || isNaN(lng) ? null : { lat, lng };
  }).filter(Boolean);
}

function parseExtendedData(pm) {
  const props = {};
  pm.querySelectorAll('ExtendedData SimpleData').forEach(sd => {
    props[sd.getAttribute('name')] = sd.textContent.trim();
  });
  pm.querySelectorAll('ExtendedData Data').forEach(d => {
    const k = d.getAttribute('name');
    const v = d.querySelector('value')?.textContent?.trim() || '';
    props[k] = v;
  });
  return props;
}

function kmlColorToHex(kmlColor) {
  // KML: aabbggrr → #rrggbb
  if (!kmlColor || kmlColor.length < 8) return '#4fc3f7';
  const rr = kmlColor.slice(6, 8), gg = kmlColor.slice(4, 6), bb = kmlColor.slice(2, 4);
  return '#' + rr + gg + bb;
}

function centroid(coords) {
  if (!coords.length) return null;
  const lat = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lng = coords.reduce((s, c) => s + c.lng, 0) / coords.length;
  return { lat, lng };
}

function findStyle(doc, id) {
  return doc.querySelector(`Style[id="${id}"]`) || doc.querySelector(`StyleMap[id="${id}"]`);
}

function collectLeaves(nodes) {
  const out = [];
  nodes.forEach(n => {
    if (n.type === 'folder') out.push(...collectLeaves(n.children));
    else out.push(n);
  });
  return out;
}

function countLeaves(folder) {
  return collectLeaves(folder.children).length;
}

// ── STORAGE ───────────────────────────────────────────────────────
// We only save metadata + raw KML text; geometries are re-parsed on load
const DB_KEY = 'mapview_files_v2';

function saveToStorage() {
  try {
    const data = State.files.map(f => ({
      id: f.id, name: f.name, type: f.type, color: f.color,
      // We can't persist leaflet objects, so we save the minimal info
    }));
    localStorage.setItem(DB_KEY + '_meta', JSON.stringify(data));
  } catch (e) { console.warn('Storage error', e); }
}

function loadSavedFiles() {
  // Files themselves aren't re-loadable without the original file binary.
  // We show a welcome screen instead.
  const meta = localStorage.getItem(DB_KEY + '_meta');
  if (meta) {
    // Previously loaded file names can be shown as history (data not persisted for size)
  }
}

// ── TOAST ─────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.className = '', 3000);
}

// ── SERVICE WORKER / PWA ──────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW error', e));
  }
}

// ── UTILS ─────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
