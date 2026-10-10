// site-access.js se carga ANTES que este fichero en la misma entrada de
// content_scripts (igual que filter-core.js). Mismo bug que FILTER_CORE en
// 0.1.6: si se captura `globalThis.NotebookSiteAccess` en un `const` de
// nivel superior, y esa global aun no esta definida en ese instante en el
// navegador real, se queda `undefined` para siempre y `isNotebookPage()`
// devolveria `false` de por vida (el content script se autodesmontaria en
// cada runOnce). Por eso se resuelve dentro del helper, en cada llamada, con
// un fallback inline si la global no esta disponible.
function isNotebookPage() {
  const SA = globalThis.NotebookSiteAccess;
  if (SA && typeof SA.isNotebookHost === 'function') {
    return SA.isNotebookHost(location.hostname);
  }
  const host = String(location.hostname || '').toLowerCase();
  return host === 'notebook.google.com' || host === 'notebooklm.google.com';
}
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
  function extractSourceKeys(text) {
    const keys = new Set();
    if (!text) return keys;
    const coreKey = sourceKeyFromTitle(text);
    if (coreKey) keys.add(coreKey);
    const tema = String(text).match(/\btema[\s_]*0*(\d{2,3})(?!\d)/i);
    if (tema) {
      const key = normalizeSourceQuery(tema[1]);
      if (key) keys.add(key);
    }
    return keys;
  }
  function shortId(id) {
    return String(id).slice(0, 4);
  }
  function buildStudyModel(domItems, dict) {
    const artifactDict = (dict && dict.artifacts) || new Map();
    const sourceTitles = (dict && dict.sourceTitles) || new Map();
    const byKind = {};
    const bySourceId = {};
    const titleKeysBySource = new Map();
    const sourceOrder = [];
    const artifacts = [];
    let unlinked = 0;

    for (const item of domItems || []) {
      const meta = item.id ? artifactDict.get(item.id) : null;
      if (!meta) unlinked += 1;
      const sourceIds = meta ? Array.from(new Set(meta.sourceIds || [])) : [];
      const titleKeys = extractSourceKeys((meta && meta.title) || item.title);
      for (const sourceId of sourceIds) {
        bySourceId[sourceId] = (bySourceId[sourceId] || 0) + 1;
        if (!titleKeysBySource.has(sourceId)) {
          titleKeysBySource.set(sourceId, new Set());
          sourceOrder.push(sourceId);
        }
        titleKeys.forEach((key) => titleKeysBySource.get(sourceId).add(key));
      }
      const kind = item.kind || 'other';
      byKind[kind] = (byKind[kind] || 0) + 1;
      artifacts.push({ id: item.id || '', title: item.title || '', kind, sourceIds });
    }

    const sources = sourceOrder.map((id) => {
      const name = sourceTitles.get(id) || '';
      const keys = new Set(extractSourceKeys(name));
      titleKeysBySource.get(id).forEach((key) => keys.add(key));
      const sortedKeys = Array.from(keys).sort();
      const label = name
        || (sortedKeys[0] ? sortedKeys[0].replace(/^T/, '') : '')
        || 'Fuente sin nombre · ' + shortId(id);
      return { id, name, nameKnown: Boolean(name), keys: sortedKeys, label };
    });

    const labelUses = new Map();
    sources.forEach((source) => labelUses.set(source.label, (labelUses.get(source.label) || 0) + 1));
    sources.forEach((source) => {
      if (labelUses.get(source.label) > 1) source.label += ' · ' + shortId(source.id);
    });
    sources.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

    const sourceById = new Map(sources.map((source) => [source.id, source]));
    for (const artifact of artifacts) {
      const keys = new Set();
      const names = [];
      for (const sourceId of artifact.sourceIds) {
        const source = sourceById.get(sourceId);
        source.keys.forEach((key) => keys.add(key));
        if (source.name) names.push(source.name);
      }
      artifact.sourceKeys = Array.from(keys).sort();
      artifact.sourceNames = names;
    }

    return {
      artifacts,
      sources,
      counts: { byKind, bySourceId, total: artifacts.length },
      complete: artifacts.length > 0 && unlinked === 0,
    };
  }
  function reconcileSourceFilter(model, saved) {
    const current = saved || {};
    if (!model || !model.complete) return { filter: { ...current }, changed: false };
    const knownIds = new Set(model.sources.map((source) => (SOURCE_ID_PREFIX + source.id).toLowerCase()));
    const filter = {};
    let changed = false;
    for (const [src, pressed] of Object.entries(current)) {
      if (src.startsWith(SOURCE_ID_PREFIX)) {
        if (knownIds.has(src.toLowerCase())) filter[src] = Boolean(pressed);
        else changed = true;
        continue;
      }
      changed = true; // clave antigua: se traduce o se descarta
      const normalized = normalizeSourceQuery(src);
      if (!pressed || !normalized) continue;
      model.sources
        .filter((source) => source.keys.includes(normalized))
        .forEach((source) => { filter[SOURCE_ID_PREFIX + source.id] = true; });
    }
    return { filter, changed };
  }
  return {
    isContextInvalidatedError,
    normalizeSourceQuery,
    sourceKeyFromTitle,
    artifactMatchesFilters,
    extractSourceKeys,
    buildStudyModel,
    reconcileSourceFilter,
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
      cursor: pointer;
      user-select: none;
    }
    .nl-collapse-arrow {
      display: inline-block;
      width: 10px;
      font-size: 9px;
      opacity: 0.8;
    }
    #nl-filter-body.nl-collapsed { display: none; }
    .nl-result-count {
      font-weight: 400;
      opacity: 0.7;
      font-size: 10px;
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
    .nl-empty-state {
      font-size: 11px;
      color: #9aa0a6;
      font-style: italic;
      padding: 6px 2px 2px;
    }
    .nl-empty-state[hidden] { display: none !important; }
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
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      appearance: none;
      border: 1px solid #8ab4f8;
      background: transparent;
      color: #e8eaed;
      padding: 3px 8px;
      border-radius: 16px;
      cursor: pointer;
      font-size: 11px;
    }
    .nl-select-wrap {
      position: absolute;
      left: 2px;
      top: 2px;
      z-index: 3;
      display: flex;
      align-items: center;
      cursor: pointer;
    }
    .nl-select { margin: 0; cursor: pointer; accent-color: #8ab4f8; }
    .nl-btn {
      appearance: none;
      border: 1px solid #8ab4f8;
      background: transparent;
      color: #e8eaed;
      padding: 3px 8px;
      border-radius: 16px;
      cursor: pointer;
      font-size: 11px;
    }
    .nl-btn:disabled { opacity: 0.4; cursor: default; }
    .nl-btn-danger { border-color: #f28b82; color: #f28b82; }
    .nl-bulk-status { font-size: 11px; color: #9aa0a6; padding: 2px; min-height: 14px; }
    .nl-modal-backdrop {
      position: fixed; inset: 0; z-index: 2147483000;
      background: rgba(0, 0, 0, 0.6);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
    }
    .nl-modal {
      background: #202124; color: #e8eaed; border: 1px solid #3c4043;
      border-radius: 12px; padding: 16px 20px; max-width: 420px; width: calc(100% - 32px);
    }
    .nl-modal-title { font-size: 15px; margin: 0 0 8px; font-weight: 500; }
    .nl-modal-list { margin: 0 0 8px; padding-left: 18px; font-size: 12px; max-height: 40vh; overflow: auto; }
    .nl-modal-warning { font-size: 12px; color: #f28b82; margin: 0 0 12px; }
    .nl-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
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
let studyModel = FILTER_CORE.buildStudyModel([], {});
const selectedArtifactIds = new Set();
let bulkDeleteRunning = false;
let bulkStatusText = '';
// Tiempos del borrado en bloque (ms). Constantes con nombre; los tests los reducen.
const BULK_DELETE = { menuMs: 2000, dialogMs: 2000, goneMs: 8000, stepMs: 50 };

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function extractSourceKeysFromText(text) {
  return FILTER_CORE.extractSourceKeys(text);
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
      title: artifact.title || '',
      typeCode: artifact.typeCode,
    });
  });

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
  const sourcePanel = document.querySelector(
    '.source-panel, [class*="source-panel"], [class*="sources-panel"], [class*="source-list"], [class*="sources-list"]'
  );
  if (!sourcePanel) return;
  const rows = sourcePanel.querySelectorAll(
    '.single-source-container, [class*="source-item"], [class*="source-card"], [class*="source-row"], mat-list-item, [class*="mat-list-item"]'
  );
  rows.forEach((row) => {
    const titleEl = row.querySelector('[title], [class*="source-title"], .source-title, [class*="source-name"], [class*="title"]');
    let title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
    if (!title) title = (row.textContent || '').trim();
    if (!title) return;

    // UUID del row: atributos data-*, href, aria-label, o texto.
    const uuidCandidates = [
      row.getAttribute('data-source-id'),
      row.getAttribute('data-id'),
      row.getAttribute('source-id'),
      row.getAttribute('href'),
      row.getAttribute('aria-label'),
      row.querySelector('[data-source-id]')?.getAttribute('data-source-id'),
      row.querySelector('[data-id]')?.getAttribute('data-id'),
    ].filter(Boolean);
    const textUuid = (row.textContent || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (textUuid) uuidCandidates.push(textUuid[0]);
    const sourceId = uuidCandidates.find(isUuid);

    if (sourceId) {
      registerSourceId(sourceId, title);
      return;
    }
    // Sin UUID en el row: enlazar por clave. Si "063.md" -> clave "T063" y
    // esa clave ya esta mapeada a un sourceId via los titulos de artefactos,
    // registramos el titulo real para ese sourceId. Si no hay mapeo, al menos
    // reservamos la clave para futuros enlaces.
    extractSourceKeysFromText(title).forEach((key) => {
      const ids = sourceKeyToIds.get(key);
      if (ids && ids.size) {
        ids.forEach((id) => registerSourceId(id, title));
      } else if (!sourceKeyToIds.has(key)) {
        sourceKeyToIds.set(key, new Set());
      }
    });
  });
}

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Dos titulos son compatibles si alguno falta (no hay evidencia en contra) o
// coinciden salvo espacios y mayusculas. Un titulo presente en ambos lados que
// los contradice indica un nodo reciclado o un artefacto distinto.
function titlesCompatible(meta, item) {
  const metaTitle = normalizeTitle(meta.title);
  const domTitle = normalizeTitle(getTitle(item));
  return !metaTitle || !domTitle || metaTitle === domTitle;
}

function getArtifactId(item) {
  if (!item) return '';
  const linked = item.dataset.nlArtifactId;
  if (linked) {
    const meta = isUuid(linked) ? artifactMetaCache.get(linked) : null;
    if (meta && titlesCompatible(meta, item)) return linked;
    // Enlace obsoleto: el artefacto ya no esta en la cache o Angular reciclo
    // este nodo para otro artefacto. Se descarta y se vuelve a resolver.
    delete item.dataset.nlArtifactId;
  }
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
  // Las casillas que inyecta la extension llevan el id del artefacto que
  // vieron por ultima vez: no son evidencia del artefacto que muestra el nodo.
  const candidates = [item, ...item.querySelectorAll('*')].filter((el) => !el.closest('.nl-select-wrap'));
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
  const used = new Set();
  const pending = [];

  // Fase 1: enlace fuerte (dataset validado / atributos) o coincidencia unica
  // por titulo con un artefacto aun no reclamado por otro item.
  items.forEach((item, index) => {
    let artifactId = getArtifactId(item);
    if (!artifactId) {
      const title = normalizeTitle(getTitle(item));
      const titleMatches = title
        ? Array.from(artifactMetaCache.entries())
          .filter(([id, meta]) => normalizeTitle(meta.title) === title && !used.has(id))
        : [];
      if (titleMatches.length === 1) artifactId = titleMatches[0][0];
    }
    if (artifactId) {
      item.dataset.nlArtifactId = artifactId;
      used.add(artifactId);
    } else {
      delete item.dataset.nlArtifactId;
      pending.push([item, index]);
    }
  });

  // Fase 2, ultimo recurso: la posicion en la ultima respuesta de red, solo si
  // el titulo del candidato no contradice al del DOM y ningun otro item lo usa.
  // Con titulos repetidos la posicion solo sirve si hay tantos items en el DOM
  // como artefactos con ese titulo en la cache; si no (p. ej. se borro uno de
  // los gemelos) no hay forma de saber cual queda y es mas seguro no enlazar.
  const countByTitle = (titles) => {
    const counts = new Map();
    titles.forEach((title) => counts.set(title, (counts.get(title) || 0) + 1));
    return counts;
  };
  const domTitleCounts = countByTitle(items.map((item) => normalizeTitle(getTitle(item))));
  const cacheTitleCounts = countByTitle(Array.from(artifactMetaCache.values()).map((meta) => normalizeTitle(meta.title)));
  pending.forEach(([item, index]) => {
    const candidate = lastArtifactIdOrder[index];
    const meta = candidate ? artifactMetaCache.get(candidate) : null;
    if (!meta || used.has(candidate) || !titlesCompatible(meta, item)) return;
    const title = normalizeTitle(getTitle(item));
    if (title && domTitleCounts.get(title) !== cacheTitleCounts.get(title)) return;
    item.dataset.nlArtifactId = candidate;
    used.add(candidate);
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
  selectedArtifactIds.clear();
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

function getTitle(item) {
  const titleEl = item.querySelector('.artifact-title, [class*="artifact-title"]');
  return titleEl ? titleEl.textContent.trim() : '';
}

function getDetails(item) {
  const detailsEl = item.querySelector('.artifact-details, [class*="artifact-details"]');
  return detailsEl ? detailsEl.textContent.trim() : '';
}

function getDisplayStudyTypes(model) {
  const merged = new Set([...DEFAULT_STUDY_TYPES, ...Object.keys(model.counts.byKind)]);
  return [ALL_TYPES_KEY, ...Array.from(merged).filter((t) => t !== ALL_TYPES_KEY).sort()];
}

// Reconstruye el modelo desde lo que hay AHORA en el DOM. La cache de red solo
// aporta las fuentes de cada artefacto y los titulos de fuente.
function refreshStudyModel(items) {
  const domItems = items.map((item) => ({
    id: getArtifactId(item),
    title: getTitle(item),
    kind: getArtifactKind(item),
  }));
  studyModel = FILTER_CORE.buildStudyModel(domItems, {
    artifacts: artifactMetaCache,
    sourceTitles: sourceTitleById,
  });
  return studyModel;
}

function sourceChipsFromModel(model) {
  return model.sources.map((source) => ({
    src: FILTER_CORE.SOURCE_ID_PREFIX + source.id,
    id: source.id,
    display: source.label,
  }));
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
  const model = refreshStudyModel(items);

  const activeStudyTypes = Object.keys(studyFilter).filter((k) => studyFilter[k]);
  const activeSources = Object.keys(sourceFilter).filter((k) => sourceFilter[k]);
  const query = (searchText || '').trim().toLowerCase();
  const sourceQuery = (sourceSearchText || '').trim().toLowerCase();

  let visibleCount = 0;
  items.forEach((item, index) => {
    const artifact = model.artifacts[index];
    const matchesMetadata = FILTER_CORE.artifactMatchesFilters(
      {
        kind: artifact.kind,
        sourceKeys: artifact.sourceKeys,
        sourceNames: artifact.sourceNames,
        sourceIds: artifact.sourceIds,
      },
      { activeTypes: activeStudyTypes, activeSources, sourceQuery }
    );
    const title = getTitle(item);
    const details = getDetails(item);
    const matchesSearch = !query || title.toLowerCase().includes(query) || details.toLowerCase().includes(query);

    if (!matchesMetadata || !matchesSearch) {
      hideElement(item);
    } else {
      showElement(item);
      visibleCount++;
    }
  });

  // Sin elementos no hay nada que filtrar: ni estado vacio ni contador.
  const hasActiveFilter = Boolean(activeStudyTypes.length || activeSources.length || query || sourceQuery);
  updateEmptyState(visibleCount, items.length > 0 && hasActiveFilter);
  updateResultCount(visibleCount, items.length);
  syncSelection(items, model);
}

function selectionChanged() {
  if (typeof syncBulkUI === 'function') syncBulkUI();
}

function makeSelectBox(artifactId) {
  const wrap = document.createElement('label');
  wrap.className = 'nl-select-wrap';
  wrap.title = 'Seleccionar para borrar';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'nl-select';
  box.setAttribute('data-nl-select', artifactId);
  box.setAttribute('aria-label', 'Seleccionar elemento de estudio');
  // El clic de la casilla no debe llegar al elemento nativo (lo abriria).
  wrap.addEventListener('click', (event) => event.stopPropagation());
  box.addEventListener('change', () => {
    if (box.checked) selectedArtifactIds.add(artifactId);
    else selectedArtifactIds.delete(artifactId);
    selectionChanged();
  });
  wrap.appendChild(box);
  return wrap;
}

// Una casilla por elemento visible y enlazado a un artefacto; idempotente (no
// toca el DOM si ya esta bien) para no realimentar al MutationObserver. Los
// ids seleccionados que ya no estan visibles se descartan: lo oculto por un
// filtro nunca se borra por accidente.
function syncSelection(items, model) {
  const visible = new Set();
  items.forEach((item, index) => {
    const artifactId = model.artifacts[index].id;
    const eligible = Boolean(artifactId) && artifactMetaCache.has(artifactId) && !item.hasAttribute('hidden');
    let wrap = item.querySelector(':scope > .nl-select-wrap');
    if (!eligible) {
      if (wrap) wrap.remove();
      return;
    }
    visible.add(artifactId);
    if (wrap && wrap.firstChild.getAttribute('data-nl-select') !== artifactId) {
      wrap.remove();
      wrap = null;
    }
    if (!wrap) {
      wrap = makeSelectBox(artifactId);
      if (!item.style.position) item.style.position = 'relative';
      item.appendChild(wrap);
    }
    const box = wrap.firstChild;
    const checked = selectedArtifactIds.has(artifactId);
    if (box.checked !== checked) box.checked = checked;
    if (box.disabled !== bulkDeleteRunning) box.disabled = bulkDeleteRunning;
  });
  for (const id of Array.from(selectedArtifactIds)) {
    if (!visible.has(id)) selectedArtifactIds.delete(id);
  }
  selectionChanged();
}

function updateEmptyState(visibleCount, hasActiveFilter) {
  const filterPanel = document.getElementById('nl-filter-panel');
  if (!filterPanel) return;
  let empty = filterPanel.querySelector('#nl-empty-state');
  const shouldShow = visibleCount === 0 && hasActiveFilter;
  if (!empty) {
    empty = document.createElement('div');
    empty.id = 'nl-empty-state';
    empty.className = 'nl-empty-state';
    empty.textContent = 'Ningún resultado con estos filtros';
    empty.setAttribute('hidden', '');
    filterPanel.appendChild(empty);
  }
  // Idempotente: solo se muta si el estado cambia, para no realimentar al
  // MutationObserver (el panel de filtros esta dentro del subarbol observado).
  const isShown = !empty.hasAttribute('hidden');
  if (shouldShow !== isShown) {
    if (shouldShow) empty.removeAttribute('hidden');
    else empty.setAttribute('hidden', '');
  }
}

function updateResultCount(visibleCount, total) {
  const el = document.getElementById('nl-result-count');
  if (!el) return;
  const newText = total > 0 ? ('Mostrando ' + visibleCount + ' de ' + total) : '';
  if (el.textContent !== newText) el.textContent = newText;
}

function typeChipLabel(type, typeCounts) {
  return type === ALL_TYPES_KEY ? typeLabel(type) : typeLabel(type) + ' (' + (typeCounts[type] || 0) + ')';
}

function sourceChipLabel(entry, sourceCounts) {
  return entry.display + ' (' + (sourceCounts[entry.src] || 0) + ')';
}

function chipCountsForView(model, sourceChips) {
  const sourceCounts = {};
  for (const entry of sourceChips) sourceCounts[entry.src] = model.counts.bySourceId[entry.id] || 0;
  return { typeCounts: model.counts.byKind, sourceCounts };
}

// Actualiza en sitio el texto (nombre + recuento) de los chips existentes, sin
// reconstruir el panel: conserva foco y texto de los buscadores.
function syncChipLabels(container, sourceChips, typeCounts, sourceCounts) {
  const setText = (chip, text) => { if (chip.textContent !== text) chip.textContent = text; };
  container.querySelectorAll('[data-nl-row] .nl-chip').forEach((chip) => {
    const type = chip.getAttribute('data-nl-type');
    if (type) setText(chip, typeChipLabel(type, typeCounts));
  });
  const entries = new Map(sourceChips.map((entry) => [entry.src, entry]));
  container.querySelectorAll('[data-nl-source-row] .nl-chip').forEach((chip) => {
    const entry = entries.get(chip.getAttribute('data-nl-source'));
    if (entry) setText(chip, sourceChipLabel(entry, sourceCounts));
  });
}

function makeElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function createChip(attribute, key, label, pressed, tooltip) {
  const chip = makeElement('button', 'nl-chip', label);
  chip.type = 'button';
  chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  chip.setAttribute(attribute, key);
  if (tooltip) chip.title = tooltip;
  return chip;
}

// Construye el panel solo con nodos DOM y textContent: los nombres de fuente
// son datos de terceros (nombres de fichero, titulos web) y nunca deben
// interpretarse como HTML.
function buildFilterContent(container, view) {
  container.textContent = '';

  const title = makeElement('div', 'nl-filter-title');
  const heading = makeElement('span');
  const arrow = makeElement('span', 'nl-collapse-arrow', '▼');
  arrow.id = 'nl-collapse-arrow';
  const count = makeElement('span', 'nl-result-count');
  count.id = 'nl-result-count';
  heading.append(arrow, ' Filtros' + (EXTENSION_VERSION ? ' · v' + EXTENSION_VERSION : '') + ' ', count);
  const clear = makeElement('span', '', 'Limpiar');
  clear.style.opacity = '0.7';
  clear.style.cursor = 'pointer';
  clear.setAttribute('data-nl-action', 'clear');
  title.append(heading, clear);

  const body = makeElement('div');
  body.id = 'nl-filter-body';

  const search = makeElement('input', 'nl-search');
  search.type = 'search';
  search.placeholder = 'Buscar guías...';
  search.setAttribute('data-nl-search', '');

  const studyRow = makeElement('div', 'nl-filter-row');
  studyRow.setAttribute('data-nl-row', '');
  view.studyTypes.forEach((type) => {
    studyRow.appendChild(createChip('data-nl-type', type, typeChipLabel(type, view.typeCounts), view.studyFilter[type]));
  });

  const sourceSearch = makeElement('input', 'nl-search');
  sourceSearch.type = 'search';
  sourceSearch.placeholder = 'Buscar fuente (ej: 047.md)...';
  sourceSearch.setAttribute('data-nl-source-search', '');

  body.append(
    makeElement('div', 'nl-filter-label', 'Tipo de contenido'),
    search,
    studyRow,
    makeElement('hr', 'nl-filter-divider'),
    makeElement('div', 'nl-filter-label', 'Fuentes'),
    sourceSearch
  );

  if (view.sourceChips.length) {
    const sourceRow = makeElement('div', 'nl-filter-row');
    sourceRow.setAttribute('data-nl-source-row', '');
    view.sourceChips.forEach((entry) => {
      sourceRow.appendChild(createChip(
        'data-nl-source', entry.src, sourceChipLabel(entry, view.sourceCounts), view.sourceFilter[entry.src], entry.display
      ));
    });
    body.appendChild(sourceRow);
  }

  const actions = makeElement('div', 'nl-filter-row');
  actions.setAttribute('data-nl-actions-row', '');
  [['select-visible', 'Seleccionar visibles'], ['select-none', 'Ninguno'], ['delete-selected', 'Borrar (0)']].forEach(([action, label]) => {
    const button = makeElement('button', action === 'delete-selected' ? 'nl-btn nl-btn-danger' : 'nl-btn', label);
    button.type = 'button';
    button.setAttribute('data-nl-action', action);
    actions.appendChild(button);
  });
  // El texto de estado sobrevive a la reconstruccion del panel (p. ej. cuando
  // desaparece un chip de fuente tras borrar).
  const status = makeElement('div', 'nl-bulk-status', bulkStatusText);
  status.id = 'nl-bulk-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  body.append(
    makeElement('hr', 'nl-filter-divider'),
    makeElement('div', 'nl-filter-label', 'Elementos'),
    actions,
    status
  );

  container.append(title, body);
}

function setBulkStatus(text) {
  bulkStatusText = text;
  const status = document.getElementById('nl-bulk-status');
  if (status && status.textContent !== text) status.textContent = text;
}

// Recalcula el modelo y repinta casillas y botones (p. ej. al empezar o
// terminar un borrado, o al marcar "Seleccionar visibles").
function resyncSelection() {
  const panel = findStudioPanel();
  if (!panel) return;
  const items = getArtifactItems(panel);
  syncSelection(items, refreshStudyModel(items));
}

function syncBulkUI() {
  const container = document.getElementById('nl-filter-panel');
  if (!container) return;
  const count = selectedArtifactIds.size;
  const button = container.querySelector('[data-nl-action="delete-selected"], [data-nl-action="cancel-delete"]');
  if (button) {
    const action = bulkDeleteRunning ? 'cancel-delete' : 'delete-selected';
    const label = bulkDeleteRunning ? 'Cancelar' : 'Borrar (' + count + ')';
    if (button.getAttribute('data-nl-action') !== action) button.setAttribute('data-nl-action', action);
    if (button.textContent !== label) button.textContent = label;
    const disabled = !bulkDeleteRunning && count === 0;
    if (button.disabled !== disabled) button.disabled = disabled;
  }
  container.querySelectorAll('[data-nl-action="select-visible"], [data-nl-action="select-none"]').forEach((other) => {
    if (other.disabled !== bulkDeleteRunning) other.disabled = bulkDeleteRunning;
  });
}

function visibleSelectableIds() {
  const items = getArtifactItems(findStudioPanel() || document);
  const ids = [];
  items.forEach((item) => {
    const box = item.querySelector(':scope > .nl-select-wrap > .nl-select');
    if (box && !item.hasAttribute('hidden')) ids.push(box.getAttribute('data-nl-select'));
  });
  return ids;
}

function handleBulkAction(action) {
  if (action === 'select-visible') {
    visibleSelectableIds().forEach((id) => selectedArtifactIds.add(id));
  } else if (action === 'select-none') {
    selectedArtifactIds.clear();
  } else {
    return;
  }
  resyncSelection();
}

// Confirmacion propia antes de un borrado irreversible. Foco inicial en
// Cancelar; Esc, clic fuera o Cancelar devuelven false.
function confirmBulkDelete(titles) {
  return new Promise((resolve) => {
    const total = titles.length;
    const backdrop = makeElement('div', 'nl-modal-backdrop');
    backdrop.id = 'nl-confirm';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    const card = makeElement('div', 'nl-modal');
    const list = makeElement('ul', 'nl-modal-list');
    titles.slice(0, 10).forEach((title) => list.appendChild(makeElement('li', '', title || '(sin título)')));
    if (total > 10) list.appendChild(makeElement('li', '', 'y ' + (total - 10) + ' más'));
    const cancel = makeElement('button', 'nl-btn', 'Cancelar');
    cancel.type = 'button';
    cancel.setAttribute('data-nl-confirm', 'no');
    const ok = makeElement('button', 'nl-btn nl-btn-danger', 'Borrar ' + total);
    ok.type = 'button';
    ok.setAttribute('data-nl-confirm', 'yes');
    const buttons = makeElement('div', 'nl-modal-actions');
    buttons.append(cancel, ok);
    card.append(
      makeElement('h2', 'nl-modal-title', '¿Borrar ' + total + (total === 1 ? ' elemento' : ' elementos') + ' de estudio?'),
      list,
      makeElement('p', 'nl-modal-warning', 'Esta acción es irreversible: Gemini Notebook no permite deshacerla.'),
      buttons
    );
    backdrop.appendChild(card);

    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(result);
    }
    function onKey(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(false);
      }
    }
    cancel.addEventListener('click', () => close(false));
    ok.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    cancel.focus();
  });
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
  const model = refreshStudyModel(items);

  // Migra claves antiguas (Tnnn) a UUID y poda selecciones de fuentes que ya
  // no existen. Solo actua con el modelo completo (ver reconcileSourceFilter).
  const reconciled = FILTER_CORE.reconcileSourceFilter(model, sourceFilter);
  if (reconciled.changed) {
    sourceFilter = reconciled.filter;
    saveStudyFilter({ studyTypes: studyFilter, sourceTypes: sourceFilter });
  }

  const studyTypes = getDisplayStudyTypes(model);
  const sourceChips = sourceChipsFromModel(model);
  // Una fuente seleccionada que el modelo no conoce (p. ej. con el modelo
  // incompleto no se poda) se muestra como chip marcado: si no, el filtro
  // ocultaria elementos sin ningun chip que desmarcar.
  const knownSrc = new Set(sourceChips.map((entry) => entry.src.toLowerCase()));
  Object.keys(sourceFilter).forEach((src) => {
    if (!sourceFilter[src] || !src.startsWith(FILTER_CORE.SOURCE_ID_PREFIX) || knownSrc.has(src.toLowerCase())) return;
    const id = src.slice(FILTER_CORE.SOURCE_ID_PREFIX.length);
    sourceChips.push({ src, id, display: 'Fuente no disponible · ' + id.slice(0, 4) });
  });
  const normalizedStudyFilter = normalizeStudyFilter(studyFilter);

  const container = ensureFilterPanelExists();
  if (!container) return null;

  const chipSetKey = studyTypesKey(studyTypes) + '#' + sourceChips.map((entry) => entry.src).join('|');
  const needsBuild = chipSetKey !== container.getAttribute('data-nl-chip-set')
    || !container.querySelector('[data-nl-row]');
  const { typeCounts, sourceCounts } = chipCountsForView(model, sourceChips);

  if (needsBuild) {
    const savedSearch = searchText;
    const savedSourceSearch = sourceSearchText;
    buildFilterContent(container, {
      studyTypes,
      studyFilter: normalizedStudyFilter,
      sourceChips,
      sourceFilter,
      typeCounts,
      sourceCounts,
    });
    const searchInput = container.querySelector('[data-nl-search]');
    const sourceSearchInput = container.querySelector('[data-nl-source-search]');
    if (searchInput) searchInput.value = savedSearch;
    if (sourceSearchInput) sourceSearchInput.value = savedSourceSearch;
    attachSearch(container);
    attachChipListeners(container);
    container.setAttribute('data-nl-chip-set', chipSetKey);
  } else {
    syncFilterUI(container, normalizedStudyFilter, sourceFilter);
    syncChipLabels(container, sourceChips, typeCounts, sourceCounts);
  }

  applyFilters(normalizedStudyFilter, sourceFilter, searchText, sourceSearchText);
  const body = container.querySelector('#nl-filter-body');
  if (body) body.classList.toggle('nl-collapsed', collapsed);
  updateCollapseArrow();
  return container;
}

function cleanupFilterPanel() {
  const panel = document.getElementById('nl-filter-panel');
  if (panel) panel.remove();
  const styles = document.getElementById('nl-filter-styles');
  if (styles) styles.remove();
  searchText = '';
  sourceSearchText = '';
}

function notebookId() {
  const match = String(location.pathname).match(NB_ID_REGEX);
  return match ? match[0].slice(1) : '';
}

// Claves de almacenamiento aisladas por notebook: si estamos en una ruta de
// notebook, la clave incluye su ID, de modo que un filtro guardado en un
// notebook (p.ej. fuente "041") no se herede al cambiar a otro donde esa
// fuente no existe y oculte todo. Si no hay ID (no es ruta de notebook), se
// cae a las claves globales legacy. La migracion legacy (leer las claves
// globales antiguas una vez y replicarlas por notebook) se hace en
// loadStudyFilter.
function notebookStorageKeys() {
  const id = notebookId();
  if (!id) return { studyKey: 'studyTypes', sourceKey: 'sourceTypes' };
  return { studyKey: 'studyTypes:' + id, sourceKey: 'sourceTypes:' + id };
}

function collapsedStorageKey() {
  const id = notebookId();
  return id ? 'collapsed:' + id : 'collapsed';
}

function saveCollapsed(value) {
  return new Promise((resolve) => {
    if (!hasValidExtensionContext() || !chrome.storage?.local) {
      resolve();
      return;
    }
    try {
      const key = collapsedStorageKey();
      chrome.storage.local.set({ [key]: !!value }, resolve);
    } catch {
      resolve();
    }
  });
}

async function loadStudyFilter() {
  return new Promise((resolve) => {
    if (!hasValidExtensionContext() || !chrome.storage?.local) {
      resolve({ studyTypes: {}, sourceTypes: {}, collapsed: false });
      return;
    }
    try {
      const { studyKey, sourceKey } = notebookStorageKeys();
      const collapsedKey = collapsedStorageKey();
      const keys = [studyKey, sourceKey, 'studyTypes', 'sourceTypes', collapsedKey];
      chrome.storage.local.get(keys, (res) => {
        let study = res?.[studyKey];
        let source = res?.[sourceKey];
        const toMigrate = {};
        if (study === undefined) {
          const legacy = res?.studyTypes;
          study = legacy || {};
          if (legacy) toMigrate[studyKey] = legacy;
        }
        if (source === undefined) {
          const legacy = res?.sourceTypes;
          source = legacy || {};
          if (legacy) toMigrate[sourceKey] = legacy;
        }
        if (Object.keys(toMigrate).length) {
          try { chrome.storage.local.set(toMigrate, () => {}); } catch {}
        }
        resolve({ studyTypes: study || {}, sourceTypes: source || {}, collapsed: !!res?.[collapsedKey] });
      });
    } catch {
      resolve({ studyTypes: {}, sourceTypes: {}, collapsed: false });
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
      const { studyKey, sourceKey } = notebookStorageKeys();
      const payload = {
        [studyKey]: data?.studyTypes || {},
        [sourceKey]: data?.sourceTypes || {},
      };
      chrome.storage.local.set(payload, resolve);
    } catch {
      resolve();
    }
  });
}

let searchText = '';
let sourceSearchText = '';
let collapsed = false;
let initRetryTimer = null;
let scanObserver = null;
let observedRoot = null;

let scanScheduled = false;
function scheduleScan() {
  if (scanScheduled) return;
  scanScheduled = true;
  requestAnimationFrame(() => {
    scanScheduled = false;
    runOnce().catch(handleRunOnceFailure);
  });
}

function isInsideFilterPanel(node) {
  const fp = document.getElementById('nl-filter-panel');
  return !!(fp && node && (node === fp || fp.contains(node)));
}

// El callback del observer ignora las mutaciones que se originan dentro del
// propio panel de filtros (#nl-filter-panel). Como ese panel vive dentro del
// subarbol observado (esta montado en el panel de Studio), sin este filtro
// cualquier actualizacion del panel (contador, estado vacio, aria-pressed)
// realimentaria al observer y entraria en bucle infinito: applyFilters muta
// el panel -> observer -> runOnce -> applyFilters -> muta el panel -> ...
function isOwnNode(node) {
  return node.nodeType === 1 && (node.classList.contains('nl-select-wrap') || node.id === 'nl-confirm');
}

function observerCallback(records) {
  for (const record of records) {
    if (isInsideFilterPanel(record.target)) continue;
    // Las casillas y el modal los inyecta esta extension: no son un cambio de la SPA.
    const changed = [...record.addedNodes, ...record.removedNodes];
    if (changed.length && changed.every(isOwnNode)) continue;
    scheduleScan();
    return;
  }
}

function initObserver() {
  if (document.getElementById('nl-observer-root')) return;
  const sentinel = document.createElement('div');
  sentinel.id = 'nl-observer-root';
  sentinel.style.display = 'none';
  document.documentElement.appendChild(sentinel);

  scanObserver = new MutationObserver(observerCallback);
  observedRoot = document.documentElement;
  scanObserver.observe(observedRoot, { childList: true, subtree: true });
}

// Re-ancla el observer al panel de Studio cuando se localiza, para no
// disparar scheduleScan por cada mutacion del resto de la SPA de Angular.
// Si el panel no esta (p. ej. al cambiar de ruta), se vuelve a observar
// document.documentElement para detectar cuando reaparece. Si el panel se
// reemplaza en sitio, su contenedor padre sigue notificando al estar en
// subtree; como salvaguarda, startInitRetries y el propio runOnce reanclan.
function reanchorObserver() {
  if (!scanObserver) return;
  const panel = findStudioPanel();
  const target = panel || document.documentElement;
  if (target === observedRoot) return;
  scanObserver.disconnect();
  scanObserver.observe(target, { childList: true, subtree: true });
  observedRoot = target;
  window.__nlFilterObserverTarget = target;
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
  if (!isNotebookPage()) {
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
  collapsed = !!stored.collapsed;

  updateFilterPanel(studyFilter, sourceFilter);
  reanchorObserver();
}

function toggleCollapse() {
  const container = document.getElementById('nl-filter-panel');
  if (!container) return;
  const body = container.querySelector('#nl-filter-body');
  if (!body) return;
  collapsed = !collapsed;
  body.classList.toggle('nl-collapsed', collapsed);
  updateCollapseArrow();
  saveCollapsed(collapsed);
}

function updateCollapseArrow() {
  const arrow = document.getElementById('nl-collapse-arrow');
  if (arrow) arrow.textContent = collapsed ? '▶' : '▼';
}

// Herramienta de diagnostico invocable desde la consola de DevTools
// (contexto de la extension/isolated world) con:
//   __nlFilterDebug()
// Muestra cuantas fuentes y artefactos se han capturado via batchexecute
// y cuales quedarian como chip de respaldo por UUID en la seccion FUENTE.
window.__nlFilterCoreSource = FILTER_CORE_SOURCE;
window.__nlFilterModel = function () {
  return refreshStudyModel(getArtifactItems(findStudioPanel() || document));
};
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
  const model = window.__nlFilterModel();
  console.log('[NL Filter] modelo:', model.artifacts.length, 'elementos,', model.sources.length, 'fuentes, completo =', model.complete);
  console.table(model.sources.map((s) => ({
    id: s.id,
    label: s.label,
    nameKnown: s.nameKnown,
    keys: s.keys.join(', '),
    elementos: model.counts.bySourceId[s.id],
  })));
  return { sources, artifacts, activeTypes, activeSourceChips, searchText, sourceSearchText, model };
};

function main() {
  if (!isNotebookPage()) return;
  handleBridgeMetadata();
  initObserver();
  runOnce().catch(handleRunOnceFailure);
  startInitRetries();
}

document.addEventListener('click', (event) => {
  const target = event.target;
  const actionEl = target.closest && target.closest('[data-nl-action]');
  const bulkAction = actionEl ? actionEl.getAttribute('data-nl-action') : '';

  if (bulkAction && bulkAction !== 'clear') {
    event.preventDefault();
    if (!actionEl.disabled) handleBulkAction(bulkAction);
    return;
  }

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

  const titleEl = target.closest && target.closest('.nl-filter-title');
  if (titleEl) {
    event.preventDefault();
    toggleCollapse();
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
    const model = refreshStudyModel(items);
    sendResponse({
      sources: sourceChipsFromModel(model).map(({ src, display }) => ({ src, display })),
      studyTypes: Object.keys(model.counts.byKind).sort(),
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
else if (isNotebookPage()) main();
