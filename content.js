const PAGE_HOST = 'notebooklm.google.com';
const NB_ROUTE_REGEX = /\/notebook\/[A-Za-z0-9-]+/;
const NB_ID_REGEX = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALL_TYPES_KEY = '__all__';
const DEFAULT_STUDY_TYPES = ['audio', 'briefing', 'guide', 'map', 'quiz', 'cards', 'video', 'report', 'presentation', 'infographic', 'datatable'];
// filter-core.js se carga ANTES que este fichero en la misma entrada de
// content_scripts del manifest (mundo ISOLATED) y deberia dejar
// `globalThis.NotebookFilterCore` disponible aqui. Pero en Edge/Chrome real
// hemos verificado (v0.1.5) que, en el navegador del usuario, esa global NO
// estaba definida al llegar a este punto; al capturarla con `const`, se
// quedaba undefined para siempre. Con FILTER_CORE undefined, `matchesMetadata`
// cae al `: true` y NI el filtro por tipo NI el filtro por fuente hacen nada
// (la busqueda de texto, que no usa FILTER_CORE, seguia funcionando: justo el
// sintoma reportado). No se pudo reproducir en jsdom/Node (alli las dos
// scripts comparten global), por eso los tests no lo cazaban.
//
// Para que el filtrado funcione SIEMPRE, independientemente de si la global
// esta o no, se resuelve con un fallback inline que duplica las funciones
// puras de filter-core.js. Si la global esta disponible se usa esa (unica
// fuente de verdad); si no, se usa el fallback. Un test jsdom carga este
// fichero SIN filter-core.js para garantizar que el fallback funciona solo.
const INLINE_FILTER_CORE = (function () {
  const SOURCE_ID_PREFIX = 'ID:';
  function isContextInvalidatedError(err) {
    const message = (err && err.message) ? String(err.message) : String(err || '');
    return message.includes('Extension context invalidated');
  }
  function normalizeSourceQuery(raw) {
    if (raw === null || raw === undefined) return '';
    const match = String(raw).trim().toUpperCase().match(/(?:^|[^0-9A-Z]|T)0*(\d{2,3})(?!\d)/);
    return match ? 'T' + match[1].padStart(3, '0') : '';
  }
  function sourceKeyFromTitle(title) {
    if (!title) return '';
    const match = String(title).match(/(?:^|[^0-9])0*(\d{2,3})(?!\d)/);
    return match ? normalizeSourceQuery(match[1]) : '';
  }
  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .trim();
  }
  function matchesSourceQuery(sourceKeys, query, sourceNames, sourceIds) {
    const raw = String(query || '').trim();
    if (!raw) return true;
    if (raw.startsWith(SOURCE_ID_PREFIX)) {
      const targetId = raw.slice(SOURCE_ID_PREFIX.length).toLowerCase();
      return Array.from(sourceIds || []).some((id) => String(id).toLowerCase() === targetId);
    }
    const normalized = normalizeSourceQuery(raw);
    const matchesKey = normalized
      && Array.from(sourceKeys || []).some((key) => normalizeSourceQuery(key) === normalized);
    const textQuery = normalizeText(raw);
    const matchesName = Array.from(sourceNames || [])
      .some((name) => normalizeText(name).includes(textQuery));
    return Boolean(matchesKey || matchesName);
  }
  function artifactMatchesFilters(artifact, filters) {
    const activeTypes = filters.activeTypes || [];
    const activeSources = filters.activeSources || [];
    const sourceKeys = artifact.sourceKeys || new Set();
    const sourceNames = artifact.sourceNames || [];
    const sourceIds = artifact.sourceIds || [];
    const matchesType = activeTypes.length === 0
      || activeTypes.includes('__all__')
      || activeTypes.includes(artifact.kind);
    const matchesSelectedSource = activeSources.length === 0
      || activeSources.some((source) => matchesSourceQuery(sourceKeys, source, sourceNames, sourceIds));
    const matchesTypedSource = matchesSourceQuery(sourceKeys, filters.sourceQuery || '', sourceNames, sourceIds);
    return matchesType && matchesSelectedSource && matchesTypedSource;
  }
  return {
    isContextInvalidatedError,
    normalizeSourceQuery,
    sourceKeyFromTitle,
    artifactMatchesFilters,
    SOURCE_ID_PREFIX,
  };
})();

const FILTER_CORE = globalThis.NotebookFilterCore || INLINE_FILTER_CORE;
const FILTER_CORE_SOURCE = globalThis.NotebookFilterCore ? 'global' : 'inline';

let extensionContextLost = false;

function hasValidExtensionContext() {
  if (extensionContextLost) return false;
  try {
    return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function getExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '';
  }
}

const EXTENSION_VERSION = getExtensionVersion();

// Si la extension se recarga/actualiza desde edge://extensions sin refrescar
// la pestana de NotebookLM, esta instancia del content script queda "huerfana":
// chrome.runtime sigue existiendo como objeto pero cualquier llamada real lanza
// "Extension context invalidated". El motor de extensiones puede emitir ese
// error de forma asincrona (promesa no controlada) aunque el codigo que lo
// origina ya este protegido con try/catch. En vez de dejar que ensucie el
// panel de "Errores", lo detectamos aqui, lo silenciamos y desactivamos esta
// instancia de forma limpia (sin timers ni observers activos de por vida).
function isContextInvalidatedError(err) {
  if (FILTER_CORE) return FILTER_CORE.isContextInvalidatedError(err);
  const message = (err && err.message) ? String(err.message) : String(err || '');
  return message.includes('Extension context invalidated');
}

function teardownExtension() {
  if (extensionContextLost) return;
  extensionContextLost = true;
  if (scanObserver) {
    scanObserver.disconnect();
    scanObserver = null;
  }
  if (initRetryTimer) {
    clearInterval(initRetryTimer);
    initRetryTimer = null;
  }
  cleanupFilterPanel();
  console.info('[Filtro de Estudio] Extension recargada: refresca esta pestana para reactivar el filtro.');
}

function handleRunOnceFailure(err) {
  if (isContextInvalidatedError(err)) {
    teardownExtension();
    return;
  }
  console.error('[Filtro de Estudio] Error inesperado en runOnce:', err);
}

window.addEventListener('error', (event) => {
  if (isContextInvalidatedError(event.error)) {
    event.preventDefault();
    teardownExtension();
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (isContextInvalidatedError(event.reason)) {
    event.preventDefault();
    teardownExtension();
  }
});

const TYPE_LABELS = {
  [ALL_TYPES_KEY]: 'Todos',
  audio: 'Audio',
  briefing: 'Briefing',
  guide: 'Guía',
  map: 'Mapa',
  quiz: 'Test',
  cards: 'Tarjetas',
  video: 'Vídeo',
  report: 'Informes',
  presentation: 'Presentación',
  infographic: 'Infografía',
  datatable: 'Tabla de datos',
  other: 'Otro',
};

function isNotebookRoute() {
  return NB_ROUTE_REGEX.test(location.pathname) || NB_ID_REGEX.test(location.pathname);
}

function injectStyles() {
  if (document.getElementById('nl-filter-styles')) return;
  const style = document.createElement('style');
  style.id = 'nl-filter-styles';
  style.textContent = `
    .nl-hidden[hidden] { display: none !important; }
    .nl-filter-container {
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
      font-size: 12px;
      color: #e8eaed;
      background: #1f1f1f;
      border: 1px solid #3c4043;
      border-radius: 8px;
      padding: 8px 10px;
      margin: 8px 0;
      z-index: 2;
      position: relative;
      display: block;
    }
    .nl-filter-title {
      font-weight: 500;
      margin-bottom: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #f1f3f4;
    }
    .nl-filter-label {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #9aa0a6;
      margin-bottom: 4px;
    }
    .nl-filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 6px;
    }
    .nl-filter-divider {
      border: none;
      border-top: 1px solid #3c4043;
      margin: 8px 0 10px;
      width: 100%;
    }
    .nl-search {
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 6px;
      padding: 5px 8px;
      border-radius: 8px;
      border: 1px solid #8ab4f8;
      background: #202124;
      color: #e8eaed;
      font-size: 11px;
      outline: none;
    }
    .nl-search:focus {
      border-color: #aecbfa;
    }
    .nl-chip {
      appearance: none;
      border: 1px solid #8ab4f8;
      background: transparent;
      color: #e8eaed;
      padding: 3px 8px;
      border-radius: 16px;
      cursor: pointer;
      font-size: 11px;
    }
    .nl-chip[aria-pressed="true"] {
      background: #8ab4f8;
      color: #202124;
      border-color: #8ab4f8;
    }
  `;
  document.head.appendChild(style);
}

function resetElement(el) {
  if (!el) return;
  el.removeAttribute('hidden');
  el.classList.remove('nl-hidden');
}

function hideElement(el) {
  if (!el || el.getAttribute('hidden') === '') return;
  el.setAttribute('hidden', '');
  el.classList.add('nl-hidden');
}

function showElement(el) {
  resetElement(el);
}

function typeLabel(type) {
  return TYPE_LABELS[type] || (type.charAt(0).toUpperCase() + type.slice(1));
}

const ICON_TYPE_FALLBACK = {
  audio_magic_eraser: 'audio',
  subscriptions: 'video',
  co_present: 'presentation',
  slideshow: 'presentation',
  account_tree: 'map',
  hub: 'map',
  quiz: 'quiz',
  contact_support: 'quiz',
  help: 'quiz',
  style: 'cards',
  cards_star: 'cards',
  bar_chart: 'infographic',
  insert_chart: 'infographic',
  table_chart: 'datatable',
  grid_on: 'datatable',
  find_in_page: 'report',
  description: 'report',
  auto_awesome: 'briefing',
  menu_book: 'guide',
};

const IGNORED_ICONS = new Set(['more_vert', 'more_horiz', 'play_arrow', 'pause', 'arrow_forward', 'expand_more']);

let iconTypeMap = { ...ICON_TYPE_FALLBACK };
let artifactMetaCache = new Map();
let sourceTitleById = new Map();
let sourceKeyToIds = new Map();
let lastArtifactIdOrder = [];
let lastBridgePayload = '';

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function normalizeSourceKey(raw) {
  return FILTER_CORE ? FILTER_CORE.normalizeSourceQuery(raw) : '';
}

function extractSourceKeysFromText(text) {
  const keys = new Set();
  if (!text) return keys;
  // Delegamos en FILTER_CORE.sourceKeyFromTitle porque acepta el numero de
  // fuente con o sin ".md" y con o sin prefijo "T" (mas laxo que las
  // regex antiguas, que exigian literalmente ".md" o "T047").
  const coreKey = FILTER_CORE ? FILTER_CORE.sourceKeyFromTitle(text) : '';
  if (coreKey) keys.add(coreKey);
  const tema = String(text).match(/\btema[\s_]*0*(\d{2,3})(?!\d)/i);
  if (tema) {
    const key = normalizeSourceKey(tema[1]);
    if (key) keys.add(key);
  }
  return keys;
}

function registerSourceId(sourceId, title) {
  if (!isUuid(sourceId)) return;
  sourceTitleById.set(sourceId, title || '');
  const keys = extractSourceKeysFromText(title);
  keys.forEach((key) => {
    if (!sourceKeyToIds.has(key)) sourceKeyToIds.set(key, new Set());
    sourceKeyToIds.get(key).add(sourceId);
  });
}

function sourceKeysForIds(sourceIds) {
  const keys = new Set();
  (sourceIds || []).forEach((sourceId) => {
    const title = sourceTitleById.get(sourceId);
    if (title) extractSourceKeysFromText(title).forEach((key) => keys.add(key));
    for (const [key, ids] of sourceKeyToIds.entries()) {
      if (ids.has(sourceId)) keys.add(key);
    }
  });
  return keys;
}

function refreshIconTypeMap() {
  iconTypeMap = { ...ICON_TYPE_FALLBACK };
  const labelRules = [
    [/audio/i, 'audio'],
    [/v[ií]deo|video overview/i, 'video'],
    [/slide|presentaci/i, 'presentation'],
    [/mapa|mind map/i, 'map'],
    [/informe|report/i, 'report'],
    [/tarjeta|flashcard/i, 'cards'],
    [/cuestionario|quiz/i, 'quiz'],
    [/infograf/i, 'infographic'],
    [/tabla|data table/i, 'datatable'],
  ];
  document.querySelectorAll('.create-artifact-button-container[aria-label]').forEach((tile) => {
    const label = tile.getAttribute('aria-label') || '';
    const icon = tile.querySelector('mat-icon');
    const iconName = icon ? icon.textContent.trim() : '';
    if (!iconName) return;
    for (const [rule, type] of labelRules) {
      if (rule.test(label)) {
        iconTypeMap[iconName] = type;
        break;
      }
    }
  });
}

function getItemIcons(item) {
  return Array.from(item.querySelectorAll('mat-icon'))
    .map((el) => el.textContent.trim())
    .filter((name) => name && !IGNORED_ICONS.has(name));
}

function kindFromDetails(details) {
  const d = ' ' + (details || '').toLowerCase() + ' ';
  if (d.includes('briefing doc')) return 'briefing';
  if (d.includes('study guide')) return 'guide';
  if (d.includes('blog post')) return 'report';
  if (d.includes('flashcard') || d.includes('tarjeta')) return 'cards';
  if (d.includes('quiz') || d.includes('cuestionario')) return 'quiz';
  if (d.includes('mind map') || d.includes('mapa mental')) return 'map';
  if (d.includes('slide deck') || d.includes('presentación')) return 'presentation';
  if (d.includes('infographic') || d.includes('infografía')) return 'infographic';
  if (d.includes('data table') || d.includes('tabla de datos')) return 'datatable';
  return null;
}

function kindFromIcon(item) {
  const icons = getItemIcons(item);
  for (const icon of icons) {
    if (iconTypeMap[icon]) return iconTypeMap[icon];
  }
  if (item.querySelector('button[aria-label*="Play"], button[aria-label*="Reproducir"], .artifact-play-button')) {
    const iconsJoined = icons.join(' ');
    if (iconsJoined.includes('subscriptions')) return 'video';
    return 'audio';
  }
  return null;
}

function typeCodeToKind(code) {
  switch (code) {
    case 1: return 'audio';
    case 2: return 'report';
    case 3: return 'video';
    case 4: return 'quiz';
    case 5: return 'map';
    case 7: return 'infographic';
    case 8: return 'presentation';
    case 9: return 'datatable';
    default: return 'other';
  }
}

// Registra una clave tipo "T064" para sourceId aunque nunca lleguemos a
// conocer el titulo real de la fuente ("064.md"). NotebookLM parece cargar
// el listado de fuentes de forma distinta a como carga los artefactos del
// Studio (posiblemente ya incrustado en el HTML inicial en vez de via una
// llamada batchexecute interceptable), por lo que sourceTitleById puede
// quedarse vacio para una fuente aunque su UUID SI llegue correctamente
// enlazado desde una fila de artefacto. En ese caso, el propio titulo del
// artefacto ("T064 - Audio - Test") ya contiene el numero de tema, asi que
// lo usamos como fuente adicional (no exclusiva) de la clave.
function deriveSourceKeyFromArtifactTitle(title, sourceIds) {
  if (!title || !sourceIds || !sourceIds.length) return;
  const derivedKeys = Array.from(extractSourceKeysFromText(title));
  derivedKeys.forEach((key) => {
    if (!sourceKeyToIds.has(key)) sourceKeyToIds.set(key, new Set());
    const ids = sourceKeyToIds.get(key);
    sourceIds.forEach((sourceId) => ids.add(sourceId));
  });
}

function ingestBridgePayload(payload) {
  if (!payload || typeof payload !== 'object') return;

  (payload.sources || []).forEach(([sourceId, title]) => {
    registerSourceId(sourceId, title);
  });

  const artifactOrder = [];
  (payload.artifacts || []).forEach((artifact) => {
    if (!artifact || !isUuid(artifact.id)) return;
    artifactOrder.push(artifact.id);
    deriveSourceKeyFromArtifactTitle(artifact.title, artifact.sourceIds);
    artifactMetaCache.set(artifact.id, {
      kind: typeCodeToKind(artifact.typeCode),
      sourceIds: artifact.sourceIds || [],
      sourceKeys: sourceKeysForIds(artifact.sourceIds || []),
      title: artifact.title || '',
      typeCode: artifact.typeCode,
    });
  });

  for (const meta of artifactMetaCache.values()) {
    meta.sourceKeys = sourceKeysForIds(meta.sourceIds);
  }

  const domItemCount = getArtifactItems(document).length;
  if (artifactOrder.length > 1 || domItemCount === artifactOrder.length) {
    lastArtifactIdOrder = artifactOrder;
  }
  scheduleScan();
}

function handleBridgeMetadata() {
  const root = document.documentElement;
  if (!root) return;
  const serialized = root.getAttribute('data-nl-filter-api-payload');
  if (!serialized || serialized === lastBridgePayload) return;
  try {
    ingestBridgePayload(JSON.parse(serialized));
    lastBridgePayload = serialized;
  } catch {}
}

document.addEventListener('nl-filter-api-metadata', handleBridgeMetadata);

function scanSourcesPanel() {
  const sourcePanel = document.querySelector('.source-panel, [class*="source-panel"]');
  if (!sourcePanel) return;
  sourcePanel.querySelectorAll('.single-source-container, [class*="source-item"], mat-list-item').forEach((row) => {
    const titleEl = row.querySelector('[class*="source-title"], .source-title, .title, span');
    const title = titleEl ? titleEl.textContent.trim() : row.textContent.trim();
    if (!title) return;
    extractSourceKeysFromText(title).forEach((key) => {
      if (!sourceKeyToIds.has(key)) sourceKeyToIds.set(key, new Set());
    });
    const candidates = [
      row.getAttribute('data-source-id'),
      row.querySelector('[data-source-id]')?.getAttribute('data-source-id'),
    ];
    const uuidInRow = title.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuidInRow) candidates.push(uuidInRow[0]);
    const sourceId = candidates.find(isUuid);
    if (sourceId) registerSourceId(sourceId, title);
  });
}

function getArtifactId(item) {
  if (!item) return '';
  if (item.dataset.nlArtifactId && isUuid(item.dataset.nlArtifactId)) return item.dataset.nlArtifactId;
  for (const attr of ['artifact-id', 'artifactid', 'data-artifact-id']) {
    const value = item.getAttribute(attr);
    if (isUuid(value)) return value;
  }
  const button = item.querySelector('.artifact-item-button, .artifact-stretched-button, button[class*="artifact"]');
  if (button) {
    for (const attr of ['artifact-id', 'data-artifact-id']) {
      const value = button.getAttribute(attr);
      if (isUuid(value)) return value;
    }
  }
  const candidates = [item, ...item.querySelectorAll('*')];
  for (const element of candidates) {
    for (const attribute of element.attributes || []) {
      const matches = attribute.value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig) || [];
      const artifactId = matches.find((candidate) => artifactMetaCache.has(candidate));
      if (artifactId) return artifactId;
    }
  }
  return '';
}

function linkDomArtifactsToMetadata() {
  const items = getArtifactItems();
  items.forEach((item, index) => {
    let artifactId = getArtifactId(item);
    if (!artifactId) {
      const title = getTitle(item);
      const titleMatches = Array.from(artifactMetaCache.entries())
        .filter(([, meta]) => meta.title === title);
      if (titleMatches.length === 1) artifactId = titleMatches[0][0];
    }
    if (!artifactId && lastArtifactIdOrder[index]) artifactId = lastArtifactIdOrder[index];
    if (artifactId) item.dataset.nlArtifactId = artifactId;
  });
}

let lastNotebookPath = location.pathname;

function maybeResetMetadataCache() {
  if (location.pathname === lastNotebookPath) return;
  lastNotebookPath = location.pathname;
  artifactMetaCache.clear();
  sourceTitleById.clear();
  sourceKeyToIds.clear();
  lastArtifactIdOrder = [];
}

function refreshArtifactMetadata() {
  refreshIconTypeMap();
  scanSourcesPanel();
  linkDomArtifactsToMetadata();
}

function getArtifactKind(item) {
  const detailsKind = kindFromDetails(getDetails(item));
  if (detailsKind) return detailsKind;

  // El icono (y el boton de reproducir para audio) es una senal que la
  // propia UI de NotebookLM renderiza a partir del tipo real, y no depende
  // de que hayamos interpretado correctamente el campo numerico "typeCode"
  // de la respuesta batchexecute (una suposicion nuestra, nunca verificada
  // contra una captura de red real). Se prioriza sobre la cache de la RPC;
  // esta solo se usa como ultimo recurso si el icono no da una respuesta.
  const iconKind = kindFromIcon(item);
  if (iconKind) return iconKind;

  const artifactId = getArtifactId(item);
  const cached = artifactId ? artifactMetaCache.get(artifactId) : null;
  if (cached?.kind) return cached.kind;

  return 'other';
}

function getArtifactSourceKeys(item) {
  const artifactId = getArtifactId(item);
  const keys = new Set();
  const cached = artifactId ? artifactMetaCache.get(artifactId) : null;
  if (cached && cached.sourceKeys) cached.sourceKeys.forEach((key) => keys.add(key));
  if (cached && cached.sourceIds) sourceKeysForIds(cached.sourceIds).forEach((key) => keys.add(key));
  return keys;
}

function getArtifactSourceNames(item) {
  const artifactId = getArtifactId(item);
  const cached = artifactId ? artifactMetaCache.get(artifactId) : null;
  if (!cached?.sourceIds) return [];
  return cached.sourceIds
    .map((sourceId) => sourceTitleById.get(sourceId))
    .filter(Boolean);
}

function getArtifactSourceIds(item) {
  const artifactId = getArtifactId(item);
  const cached = artifactId ? artifactMetaCache.get(artifactId) : null;
  return (cached && cached.sourceIds) || [];
}

function sourceDisplayLabel(sourceId) {
  const title = sourceTitleById.get(sourceId);
  if (title) return title.replace(/\.[a-z0-9]{1,5}$/i, '');
  return 'Fuente ' + sourceId.slice(0, 8);
}

function getTitle(item) {
  const titleEl = item.querySelector('.artifact-title, [class*="artifact-title"]');
  return titleEl ? titleEl.textContent.trim() : '';
}

function getDetails(item) {
  const detailsEl = item.querySelector('.artifact-details, [class*="artifact-details"]');
  return detailsEl ? detailsEl.textContent.trim() : '';
}

function getDisplayStudyTypes(items) {
  const discovered = new Set();
  for (const item of items) {
    const kind = getArtifactKind(item);
    if (kind) discovered.add(kind);
  }
  const merged = new Set([...DEFAULT_STUDY_TYPES, ...discovered]);
  return [ALL_TYPES_KEY, ...Array.from(merged).filter((t) => t !== ALL_TYPES_KEY).sort()];
}

function addSourceFallbackEntries(set, sourceIds) {
  const prefix = FILTER_CORE ? FILTER_CORE.SOURCE_ID_PREFIX : 'ID:';
  (sourceIds || []).forEach((sourceId) => {
    const key = prefix + sourceId;
    if (!set.has(key)) set.set(key, sourceDisplayLabel(sourceId));
  });
}

function getSourcesWithArtifacts(items) {
  const set = new Map();
  for (const meta of artifactMetaCache.values()) {
    const keys = meta.sourceKeys?.size ? meta.sourceKeys : sourceKeysForIds(meta.sourceIds);
    if (keys.size) {
      keys.forEach((key) => set.set(key, key.replace(/^T/i, '')));
    } else {
      // No se pudo derivar una clave tipo "T047" del titulo de la fuente
      // (p.ej. nombres sin numero, o titulo aun no capturado). En vez de
      // omitir la fuente en silencio, se muestra un chip identificado por
      // su UUID real para que siga siendo seleccionable.
      addSourceFallbackEntries(set, meta.sourceIds);
    }
  }
  for (const item of items) {
    const itemKeys = getArtifactSourceKeys(item);
    if (itemKeys.size) {
      itemKeys.forEach((key) => set.set(key, key.replace(/^T/i, '')));
    } else {
      addSourceFallbackEntries(set, getArtifactSourceIds(item));
    }
  }
  return Array.from(set.entries())
    .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
    .map(([src, display]) => ({ src, display }));
}

function getAllSources(items) {
  return getSourcesWithArtifacts(items);
}

function getArtifactItems(root) {
  // "root" es opcional: linkDomArtifactsToMetadata() lo llama sin
  // argumento a proposito (necesita TODOS los items del documento, no solo
  // los de un panel concreto). Antes, "if (!root) return [];" hacia que
  // esa llamada devolviese siempre 0 elementos, por lo que dataset.
  // nlArtifactId nunca se rellenaba y getArtifactId() se quedaba sin la via
  // mas fiable para enlazar el DOM con los metadatos capturados via RPC
  // (typeCode real, sourceIds) -- de ahi que el filtrado por tipo y por
  // fuente pareciera no hacer nada.
  if (root) {
    const inRoot = Array.from(root.querySelectorAll('artifact-library-item'));
    if (inRoot.length) return inRoot;
  }
  return Array.from(document.querySelectorAll('artifact-library-item'));
}

function applyFilters(studyFilter, sourceFilter, searchText, sourceSearchText) {
  const panel = findStudioPanel();
  if (!panel) return;

  linkDomArtifactsToMetadata();
  const items = getArtifactItems(panel);
  if (!items.length) return;

  const activeStudyTypes = Object.keys(studyFilter).filter((k) => studyFilter[k]);
  const activeSources = Object.keys(sourceFilter).filter((k) => sourceFilter[k]);
  const query = (searchText || '').trim().toLowerCase();
  const sourceQuery = (sourceSearchText || '').trim().toLowerCase();

  for (const item of items) {
    const title = getTitle(item);
    const details = getDetails(item);
    const kind = getArtifactKind(item);
    const sourceKeys = getArtifactSourceKeys(item);
    const sourceNames = getArtifactSourceNames(item);
    const sourceIds = getArtifactSourceIds(item);
    const matchesMetadata = FILTER_CORE
      ? FILTER_CORE.artifactMatchesFilters(
        { kind, sourceKeys, sourceNames, sourceIds },
        {
          activeTypes: activeStudyTypes,
          activeSources,
          sourceQuery,
        }
      )
      : true;
    const matchesSearch = !query || title.toLowerCase().includes(query) || details.toLowerCase().includes(query);

    if (!matchesMetadata || !matchesSearch) {
      hideElement(item);
    } else {
      showElement(item);
    }
  }
}

function buildFilterHTML(studyTypes, selectedStudyMap, sourceTypes, selectedSourceMap) {
  const studyChips = studyTypes.map((type) => {
    const pressed = selectedStudyMap[type] ? 'true' : 'false';
    return '<button class="nl-chip" type="button" aria-pressed="' + pressed + '" data-nl-type="' + type + '">' + typeLabel(type) + '</button>';
  }).join('');

  const sourceChips = (sourceTypes || []).map((entry) => {
    const src = typeof entry === 'string' ? entry : (entry && entry.src) ? entry.src : String(entry);
    const display = typeof entry === 'object' && entry && entry.display ? entry.display : src.replace(/^T/i, '');
    const pressed = selectedSourceMap[src] ? 'true' : 'false';
    return '<button class="nl-chip" type="button" aria-pressed="' + pressed + '" data-nl-source="' + src + '">' + display + '</button>';
  }).join('');

  const sourceRow = sourceChips
    ? '<div class="nl-filter-row" data-nl-source-row>' + sourceChips + '</div>'
    : '';

  return (
    '<div class="nl-filter-title">' +
    '<span>Filtros' + (EXTENSION_VERSION ? ' · v' + EXTENSION_VERSION : '') + '</span>' +
    '<span style="opacity:0.7;cursor:pointer;" data-nl-action="clear">Limpiar</span>' +
    '</div>' +
    '<div class="nl-filter-label">Tipo de contenido</div>' +
    '<input type="search" class="nl-search" data-nl-search placeholder="Buscar guías..." />' +
    '<div class="nl-filter-row" data-nl-row>' + studyChips + '</div>' +
    '<hr class="nl-filter-divider" />' +
    '<div class="nl-filter-label">Fuentes</div>' +
    '<input type="search" class="nl-search" data-nl-source-search placeholder="Buscar fuente (ej: 047.md)..." />' +
    sourceRow
  );
}

function syncFilterUI(container, selectedStudyMap, selectedSourceMap) {
  const studyRow = container.querySelector('[data-nl-row]');
  if (studyRow) {
    studyRow.querySelectorAll('.nl-chip').forEach((chip) => {
      const type = chip.getAttribute('data-nl-type');
      if (!type) return;
      chip.setAttribute('aria-pressed', selectedStudyMap[type] ? 'true' : 'false');
    });
  }
  const sourceRow = container.querySelector('[data-nl-source-row]');
  if (sourceRow) {
    sourceRow.querySelectorAll('.nl-chip').forEach((chip) => {
      const src = chip.getAttribute('data-nl-source');
      if (!src) return;
      chip.setAttribute('aria-pressed', selectedSourceMap[src] ? 'true' : 'false');
    });
  }
}

function readPressedFilters(container) {
  const studyRow = container.querySelector('[data-nl-row]');
  const sourceRow = container.querySelector('[data-nl-source-row]');
  const pressedStudy = {};
  const pressedSource = {};
  if (studyRow) {
    studyRow.querySelectorAll('.nl-chip').forEach((chip) => {
      const k = chip.getAttribute('data-nl-type');
      if (!k) return;
      pressedStudy[k] = chip.getAttribute('aria-pressed') === 'true';
    });
  }
  if (sourceRow) {
    sourceRow.querySelectorAll('.nl-chip').forEach((chip) => {
      const k = chip.getAttribute('data-nl-source');
      if (!k) return;
      pressedSource[k] = chip.getAttribute('aria-pressed') === 'true';
    });
  }
  return { pressedStudy, pressedSource };
}

function persistAndApplyFilters(pressedStudy, pressedSource) {
  saveStudyFilter({ studyTypes: pressedStudy, sourceTypes: pressedSource });
  applyFilters(pressedStudy, pressedSource, searchText, sourceSearchText);
}

function attachSearch(container) {
  const input = container.querySelector('[data-nl-search]');
  if (!input || input.getAttribute('data-nl-search-attached') === 'true') return;
  input.setAttribute('data-nl-search-attached', 'true');
  let searchTimer = null;
  input.addEventListener('input', () => {
    searchText = input.value || '';
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      const { pressedStudy, pressedSource } = readPressedFilters(container);
      persistAndApplyFilters(pressedStudy, pressedSource);
    }, 120);
  });

  const sourceInput = container.querySelector('[data-nl-source-search]');
  if (!sourceInput || sourceInput.getAttribute('data-nl-source-search-attached') === 'true') return;
  sourceInput.setAttribute('data-nl-source-search-attached', 'true');
  let sourceTimer = null;
  sourceInput.addEventListener('input', () => {
    sourceSearchText = sourceInput.value || '';
    if (sourceTimer) clearTimeout(sourceTimer);
    sourceTimer = setTimeout(() => {
      sourceTimer = null;
      const { pressedStudy, pressedSource } = readPressedFilters(container);
      persistAndApplyFilters(pressedStudy, pressedSource);
    }, 120);
  });
}

function attachChipListeners(container) {
  const studyRow = container.querySelector('[data-nl-row]');
  const sourceRow = container.querySelector('[data-nl-source-row]');
  [studyRow, sourceRow].forEach((row) => {
    if (!row) return;
    row.querySelectorAll('.nl-chip').forEach((chip) => {
      if (chip.getAttribute('data-nl-filter') === 'true') return;
      chip.setAttribute('data-nl-filter', 'true');
      chip.setAttribute('type', 'button');
      chip.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const type = chip.getAttribute('data-nl-type');
        const source = chip.getAttribute('data-nl-source');
        const root = document.getElementById('nl-filter-panel');
        if (!root) return;

        const { pressedStudy, pressedSource } = readPressedFilters(root);
        const current = type ? (pressedStudy[type] || false) : (pressedSource[source] || false);
        const next = !current;

        if (type) {
          if (type === ALL_TYPES_KEY && next) {
            Object.keys(pressedStudy).forEach((k) => { pressedStudy[k] = false; });
            pressedStudy[ALL_TYPES_KEY] = true;
          } else if (type !== ALL_TYPES_KEY && next) {
            pressedStudy[ALL_TYPES_KEY] = false;
            pressedStudy[type] = true;
          } else {
            pressedStudy[type] = next;
          }
        } else if (source) {
          pressedSource[source] = next;
        }

        syncFilterUI(root, pressedStudy, pressedSource);
        await saveStudyFilter({ studyTypes: pressedStudy, sourceTypes: pressedSource });
        applyFilters(pressedStudy, pressedSource, searchText, sourceSearchText);
      });
    });
  });
}

function studyTypesKey(types) {
  return types.join('|');
}

function sourceTypesKey(types) {
  return types.map((entry) => (typeof entry === 'string' ? entry : entry.src)).join('|');
}

function findStudioPanel() {
  const items = document.querySelectorAll('artifact-library-item');
  if (items.length) {
    let node = items[0].parentElement;
    while (node) {
      if (node.classList && node.classList.contains('panel-content-scrollable')) return node;
      node = node.parentElement;
    }
  }

  const panels = Array.from(document.querySelectorAll('.panel-content-scrollable'));
  const withArtifacts = panels.find((panel) => panel.querySelector('.artifact-library-container, artifact-library-item, [class*="artifact-library"]'));
  if (withArtifacts) return withArtifacts;

  const studioPanel = panels.find((panel) => {
    if (/studio/i.test(panel.className)) return true;
    const text = (panel.textContent || '').toLowerCase();
    return text.includes('resumen de audio') && text.includes('mapa mental');
  });
  if (studioPanel) return studioPanel;

  return panels[panels.length - 1] || document.querySelector('[class*="studio"], [class*="Studio"]') || null;
}

function findFilterAnchor(panel) {
  if (!panel) return null;

  const library = panel.querySelector('.artifact-library-container, [class*="artifact-library"]');
  if (library) return library;

  const firstItem = panel.querySelector('artifact-library-item') || document.querySelector('artifact-library-item');
  if (firstItem) {
    let node = firstItem.parentElement;
    while (node && node !== panel && node !== document.body) {
      const itemCount = node.querySelectorAll(':scope > artifact-library-item').length;
      if (itemCount > 0) return node;
      node = node.parentElement;
    }
    return firstItem.parentElement;
  }

  if (panel.children.length >= 2) {
    return panel.children[panel.children.length - 1];
  }

  return null;
}

function mountFilterPanel(container, anchor, panel) {
  if (anchor) {
    if (container.nextElementSibling !== anchor) {
      anchor.insertAdjacentElement('beforebegin', container);
    }
    return;
  }
  if (panel && container.parentElement !== panel) {
    panel.appendChild(container);
  }
}

function ensureFilterPanelExists() {
  const panel = findStudioPanel();
  if (!panel) return null;
  const anchor = findFilterAnchor(panel);

  let container = document.getElementById('nl-filter-panel');
  if (!container) {
    container = document.createElement('div');
    container.id = 'nl-filter-panel';
    container.className = 'nl-filter-container';
  }

  mountFilterPanel(container, anchor, panel);
  return container;
}

function normalizeStudyFilter(studyFilter) {
  const filter = { ...(studyFilter || {}) };
  const hasActive = Object.keys(filter).some((k) => filter[k]);
  if (!hasActive) {
    filter[ALL_TYPES_KEY] = true;
  }
  return filter;
}

function updateFilterPanel(studyFilter, sourceFilter) {
  const panel = findStudioPanel();
  if (!panel) return null;

  refreshArtifactMetadata();
  const items = getArtifactItems(panel);
  const studyTypes = getDisplayStudyTypes(items);
  const sourceTypes = getAllSources(items);
  const normalizedStudyFilter = normalizeStudyFilter(studyFilter);

  const newStudyKey = studyTypesKey(studyTypes);
  const newSourceKey = sourceTypesKey(sourceTypes);

  const container = ensureFilterPanelExists();
  if (!container) return null;

  const chipsChanged = newStudyKey !== cachedStudyTypesKey || newSourceKey !== cachedSourceTypesKey;
  const needsBuild = chipsChanged || !container.querySelector('[data-nl-row]');

  if (needsBuild) {
    const savedSearch = searchText;
    const savedSourceSearch = sourceSearchText;
    container.innerHTML = buildFilterHTML(studyTypes, normalizedStudyFilter, sourceTypes, sourceFilter);
    const searchInput = container.querySelector('[data-nl-search]');
    const sourceSearchInput = container.querySelector('[data-nl-source-search]');
    if (searchInput) searchInput.value = savedSearch;
    if (sourceSearchInput) sourceSearchInput.value = savedSourceSearch;
    attachSearch(container);
    attachChipListeners(container);
    cachedStudyTypesKey = newStudyKey;
    cachedSourceTypesKey = newSourceKey;
  } else {
    syncFilterUI(container, normalizedStudyFilter, sourceFilter);
  }

  applyFilters(normalizedStudyFilter, sourceFilter, searchText, sourceSearchText);
  return container;
}

function cleanupFilterPanel() {
  const panel = document.getElementById('nl-filter-panel');
  if (panel) panel.remove();
  const styles = document.getElementById('nl-filter-styles');
  if (styles) styles.remove();
  cachedStudyTypesKey = '';
  cachedSourceTypesKey = '';
  searchText = '';
  sourceSearchText = '';
}

async function loadStudyFilter() {
  return new Promise((resolve) => {
    if (!hasValidExtensionContext() || !chrome.storage?.local) {
      resolve({ studyTypes: {}, sourceTypes: {} });
      return;
    }
    try {
      chrome.storage.local.get(['studyTypes', 'sourceTypes'], (res) => resolve({
        studyTypes: res?.studyTypes || {},
        sourceTypes: res?.sourceTypes || {},
      }));
    } catch {
      resolve({ studyTypes: {}, sourceTypes: {} });
    }
  });
}

function saveStudyFilter(data) {
  return new Promise((resolve) => {
    if (!hasValidExtensionContext() || !chrome.storage?.local) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set(data, resolve);
    } catch {
      resolve();
    }
  });
}

let searchText = '';
let sourceSearchText = '';
let cachedStudyTypesKey = '';
let cachedSourceTypesKey = '';
let initRetryTimer = null;
let scanObserver = null;

let scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    runOnce().catch(handleRunOnceFailure);
  });
}

function initObserver() {
  if (document.getElementById('nl-observer-root')) return;
  const sentinel = document.createElement('div');
  sentinel.id = 'nl-observer-root';
  sentinel.style.display = 'none';
  document.documentElement.appendChild(sentinel);

  scanObserver = new MutationObserver(() => scheduleScan());
  scanObserver.observe(document.documentElement, { childList: true, subtree: true });
}

function startInitRetries() {
  if (initRetryTimer) return;
  let attempts = 0;
  initRetryTimer = setInterval(() => {
    attempts += 1;
    if (!isNotebookRoute() || attempts > 120) {
      clearInterval(initRetryTimer);
      initRetryTimer = null;
      return;
    }
    const container = document.getElementById('nl-filter-panel');
    const anchor = findFilterAnchor(findStudioPanel());
    if (container && anchor && container.nextElementSibling === anchor) {
      clearInterval(initRetryTimer);
      initRetryTimer = null;
      return;
    }
    runOnce().catch(handleRunOnceFailure);
  }, 500);
}

async function runOnce() {
  if (!hasValidExtensionContext()) {
    cleanupFilterPanel();
    return;
  }
  if (location.hostname !== PAGE_HOST) {
    cleanupFilterPanel();
    return;
  }
  if (!isNotebookRoute()) {
    cleanupFilterPanel();
    return;
  }

  maybeResetMetadataCache();
  injectStyles();

  const stored = await loadStudyFilter();
  const studyFilter = stored.studyTypes || {};
  const sourceFilter = stored.sourceTypes || {};

  updateFilterPanel(studyFilter, sourceFilter);
}

// Herramienta de diagnostico invocable desde la consola de DevTools
// (contexto de la extension/isolated world) con:
//   __nlFilterDebug()
// Muestra cuantas fuentes y artefactos se han capturado via batchexecute
// y cuales quedarian como chip de respaldo por UUID en la seccion FUENTE.
window.__nlFilterCoreSource = FILTER_CORE_SOURCE;
window.__nlFilterDebug = function () {
  const sources = Array.from(sourceTitleById.entries()).map(([id, title]) => ({
    id,
    title,
    key: extractSourceKeysFromText(title).size ? Array.from(extractSourceKeysFromText(title)).join(',') : '(sin clave, se usara ID)',
  }));
  const artifacts = Array.from(artifactMetaCache.entries()).map(([id, meta]) => ({
    id,
    title: meta.title,
    kind: meta.kind,
    typeCode: meta.typeCode,
    sourceIds: (meta.sourceIds || []).join(', '),
    sourceKeys: Array.from(meta.sourceKeys || []).join(', '),
    domLinked: Array.from(document.querySelectorAll('artifact-library-item'))
      .some((item) => item.dataset.nlArtifactId === id),
  }));
  const container = document.getElementById('nl-filter-panel');
  const activeFilters = container ? readPressedFilters(container) : { pressedStudy: {}, pressedSource: {} };
  const activeTypes = Object.keys(activeFilters.pressedStudy).filter((k) => activeFilters.pressedStudy[k]);
  const activeSourceChips = Object.keys(activeFilters.pressedSource).filter((k) => activeFilters.pressedSource[k]);
  console.log('[NL Filter] fuentes capturadas:', sources.length, '| artefactos capturados:', artifacts.length);
  console.log('[NL Filter] tipos activos:', activeTypes.join(', ') || '(ninguno)');
  console.log('[NL Filter] fuentes activas (chips):', activeSourceChips.join(', ') || '(ninguna)');
  console.log('[NL Filter] busqueda texto:', JSON.stringify(searchText), '| busqueda fuente:', JSON.stringify(sourceSearchText));
  console.log('[NL Filter] items del DOM sin enlazar a metadatos:', Array.from(document.querySelectorAll('artifact-library-item')).filter((item) => !item.dataset.nlArtifactId).length);
  console.log('[NL Filter] FILTER_CORE:', FILTER_CORE_SOURCE, '(' + (FILTER_CORE ? 'definido' : 'INDEFINIDO - el filtrado no funcionara') + ')');
  console.table(sources);
  console.table(artifacts);
  return { sources, artifacts, activeTypes, activeSourceChips, searchText, sourceSearchText };
};

function main() {
  if (location.hostname !== PAGE_HOST) return;
  handleBridgeMetadata();
  initObserver();
  runOnce().catch(handleRunOnceFailure);
  startInitRetries();
}

document.addEventListener('click', (event) => {
  const target = event.target;

  if (target.hasAttribute && target.hasAttribute('data-nl-action')) {
    event.preventDefault();
    const container = document.getElementById('nl-filter-panel');
    if (!container) return;
    const studyRow = container.querySelector('[data-nl-row]');
    const sourceRow = container.querySelector('[data-nl-source-row]');
    const searchInput = container.querySelector('[data-nl-search]');
    const sourceSearchInput = container.querySelector('[data-nl-source-search]');
    if (studyRow) {
      studyRow.querySelectorAll('.nl-chip').forEach((chip) => {
        const type = chip.getAttribute('data-nl-type');
        chip.setAttribute('aria-pressed', type === ALL_TYPES_KEY ? 'true' : 'false');
      });
    }
    if (sourceRow) sourceRow.querySelectorAll('.nl-chip').forEach((chip) => chip.setAttribute('aria-pressed', 'false'));
    if (searchInput) searchInput.value = '';
    if (sourceSearchInput) sourceSearchInput.value = '';
    searchText = '';
    sourceSearchText = '';
    const clearedStudy = { [ALL_TYPES_KEY]: true };
    saveStudyFilter({ studyTypes: clearedStudy, sourceTypes: {} });
    applyFilters(clearedStudy, {}, '', '');
    return;
  }
});

if (!window.__nlMessageListenerInstalled) {
  window.__nlMessageListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'nl-get-available-sources') return;
    const panel = findStudioPanel();
    if (!panel) {
      sendResponse({ sources: [], studyTypes: [] });
      return;
    }
    refreshArtifactMetadata();
    const items = getArtifactItems(panel);
    const studyTypeSet = new Set();
    for (const item of items) {
      const kind = getArtifactKind(item);
      if (kind) studyTypeSet.add(kind);
    }
    sendResponse({
      sources: getSourcesWithArtifacts(items),
      studyTypes: Array.from(studyTypeSet).sort(),
    });
  });
}

if (!window.__nlApplyListenerInstalled) {
  window.__nlApplyListenerInstalled = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'nl-apply') return;
    const studyFilter = normalizeStudyFilter(message.studyFilter || {});
    const sourceFilter = message.sourceFilter || {};
    const stored = { studyTypes: studyFilter, sourceTypes: sourceFilter };
    saveStudyFilter(stored);
    updateFilterPanel(studyFilter, sourceFilter);
    sendResponse({ ok: true });
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
else if (location.hostname === PAGE_HOST) main();
