// Pruebas de integracion DOM para content.js usando jsdom.
//
// filter-core.test.js solo cubre la logica pura (parsing, matching). La
// canalizacion clic -> readPressedFilters -> applyFilters -> hideElement
// vive en content.js y depende de document/chrome/location, por lo que
// nunca se habia ejecutado de verdad en ningun test: solo se habia
// revisado leyendo el codigo. Este archivo la ejecuta contra un DOM
// simulado con datos reales (titulos, UUIDs y typeCode) de un notebook de
// NotebookLM, obtenidos via el MCP notebook-lm, para poder afirmar con
// evidencia si el pipeline de filtrado por tipo funciona o no.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const SITE_ACCESS_SRC = fs.readFileSync(path.join(__dirname, 'site-access.js'), 'utf8');
const FILTER_CORE_SRC = fs.readFileSync(path.join(__dirname, 'filter-core.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');

// Los 6 artefactos reales del notebook "Infraestructura y Tecnologia
// (52-85)" (T063/T64/T65/T66), obtenidos con studio_status via MCP.
const REAL_ARTIFACTS = [
  { id: 'b45be210-8a5b-4497-a0a7-db3e2e75bd8b', title: 'T063 - Test - Test', typeCode: 4, sourceIds: ['7b104fef-2fc0-431e-89c1-5bb86477541f'] },
  { id: '2be6230f-34b2-4e2c-8491-800daeec4cbe', title: 'T64 - Test - Test', typeCode: 4, sourceIds: ['ea0a4122-c95a-4db3-a09d-d78439d5ccc2'] },
  { id: '2524cd6f-d462-4586-a90e-5cd81db6ba25', title: 'T66 - Audio - Test', typeCode: 1, sourceIds: ['29e4fde1-ba03-4f8f-ad2f-3192805aeef7'] },
  { id: 'c850cfe9-d200-4425-ab9a-821394cd47d1', title: 'T64 - Audio - Test', typeCode: 1, sourceIds: ['ea0a4122-c95a-4db3-a09d-d78439d5ccc2'] },
  { id: '9af21145-dbef-4bea-a6b9-a754160e3bf7', title: 'T65 - Audio - Test', typeCode: 1, sourceIds: ['a2cef8f2-e0f7-4ef0-b071-75f98d322058'] },
  { id: 'df73f495-3b9f-4802-b037-b10dcd639b1d', title: 'T64 - Audio - Test', typeCode: 1, sourceIds: ['ea0a4122-c95a-4db3-a09d-d78439d5ccc2'] },
];

const REAL_SOURCES = [
  ['7b104fef-2fc0-431e-89c1-5bb86477541f', '063.md'],
  ['ea0a4122-c95a-4db3-a09d-d78439d5ccc2', '064.md'],
  ['a2cef8f2-e0f7-4ef0-b071-75f98d322058', '065.md'],
  ['29e4fde1-ba03-4f8f-ad2f-3192805aeef7', '066.md'],
];

function artifactItemHtml(artifact) {
  // Details generico ("Informacion detallada"), igual que en la captura
  // real: NO contiene la palabra "audio"/"quiz"/etc., para no dar pistas
  // al detector kindFromDetails y forzar el mismo camino (metadata cache /
  // icono) que se ejecuta en produccion segun lo observado por el usuario.
  return `<artifact-library-item>
    <div class="artifact-title">${artifact.title}</div>
    <div class="artifact-details">Informacion detallada · 1 fuente · Hace 5 dias</div>
    <mat-icon>${artifact.typeCode === 1 ? 'audio_magic_eraser' : 'help'}</mat-icon>
    ${artifact.typeCode === 1 ? '<button aria-label="Reproducir"></button>' : ''}
  </artifact-library-item>`;
}

// Datos reales del notebook "Grupo III - ExDesarr (41 - 65)" (obtenidos via
// MCP notebook-lm) que reprodujeron la regresion reportada tras la v0.1.4:
// los nombres de fuente reales van pegados al numero con "_" en vez de
// espacio ("Tema41_..."), y los titulos de artefacto generados por
// NotebookLM son lenguaje natural que NO siempre repite el numero de tema.
const REAL_SOURCES_TEMA = [
  ['193e656a-e19e-405a-b80c-663376b1c8ad', 'Tema41_Desarrollo_Equipos_Departamentales_Dispositivos_Personales_Madrid_ESTUDIO.md'],
  ['9bbc1678-ec54-4e1a-99d7-9cb36a4d9266', 'Tema41_Desarrollo_Equipos_Departamentales_Dispositivos_Personales_Madrid_EXAMEN.md'],
];

const REAL_ARTIFACTS_TEMA = [
  { id: '11111111-1111-1111-1111-111111111111', title: 'Claves y trampas del Tema 041 TIC', typeCode: 4, sourceIds: ['9bbc1678-ec54-4e1a-99d7-9cb36a4d9266'] },
  { id: '22222222-2222-2222-2222-222222222222', title: 'Trampas de agilidad para opositores TIC', typeCode: 1, sourceIds: ['193e656a-e19e-405a-b80c-663376b1c8ad'] },
  { id: '33333333-3333-3333-3333-333333333333', title: 'Resumen en audio del tema', typeCode: 1, sourceIds: ['193e656a-e19e-405a-b80c-663376b1c8ad'] },
];

function buildDom(opts = {}) {
  const artifacts = opts.artifacts || REAL_ARTIFACTS;
  const url = opts.url || 'https://notebooklm.google.com/notebook/66d41b00-97bc-4f4c-a871-ba9f634f8b78';
  const store = opts.store !== undefined ? opts.store : {};
  const itemsHtml = artifacts.map(artifactItemHtml).join('\n');
  const html = `<!doctype html>
  <html><body>
    <div class="create-artifact-button-container" aria-label="Cuestionario"><mat-icon>help</mat-icon></div>
    <div class="create-artifact-button-container" aria-label="Resumen de audio"><mat-icon>audio_magic_eraser</mat-icon></div>
    <div class="panel-content-scrollable">
      <div class="artifact-library-container">
        ${itemsHtml}
      </div>
    </div>
  </body></html>`;

  const dom = new JSDOM(html, { url });
  const { window } = dom;

  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '0.0.0-test' }),
      onMessage: { addListener: (listener) => { (opts.messageListeners || []).push(listener); } },
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { if (k in store) out[k] = store[k]; });
          cb(out);
        },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
      },
    },
  };

  return dom;
}

function loadContentScript(dom) {
  vm.createContext(dom.window);
  vm.runInContext(SITE_ACCESS_SRC, dom.window, { filename: 'site-access.js' });
  vm.runInContext(FILTER_CORE_SRC, dom.window, { filename: 'filter-core.js' });
  vm.runInContext(CONTENT_SRC, dom.window, { filename: 'content.js' });
  return dom.window;
}

// Reproduce el escenario real que rompio la v0.1.5 en el navegador del
// usuario: `globalThis.NotebookFilterCore` NO esta definida cuando content.js
// se evalua (en Edge/Chrome real la global compartida entre los dos ficheros
// del mismo content_scripts no estaba disponible; en jsdom/Node si lo esta,
// por eso los tests no lo cazaban). Cargar content.js SIN filter-core.js
// fuerza exactamente ese caso y demuestra que el fallback inline mantiene el
// filtrado operativo. Si este test falla, el filtrado por tipo y por fuente
// se rompe en el navegador real aunque la busqueda de texto siga funcionando.
function loadContentScriptWithoutCore(dom) {
  vm.createContext(dom.window);
  vm.runInContext(SITE_ACCESS_SRC, dom.window, { filename: 'site-access.js' });
  vm.runInContext(CONTENT_SRC, dom.window, { filename: 'content.js' });
  return dom.window;
}

// Mismo patron de bug que loadContentScriptWithoutCore, pero para
// `globalThis.NotebookSiteAccess` (revision final v1.1.0, Critical 2): antes,
// `const SITE_ACCESS = globalThis.NotebookSiteAccess` en la parte superior de
// content.js capturaba la global UNA sola vez al evaluar el fichero. Si
// site-access.js no llega a dejarla definida a tiempo (mismo riesgo ya
// observado con FILTER_CORE en el navegador real en la v0.1.5), `SITE_ACCESS`
// se queda `undefined` para siempre e `isNotebookPage()` devuelve `false` de
// por vida: `runOnce()`/`main()` cortan en el primer `if (!isNotebookPage())`
// y el panel de filtros nunca se instala. Carga content.js CON filter-core.js
// pero SIN site-access.js para demostrar que el fallback inline de
// `isNotebookPage()` mantiene la deteccion de host funcionando igualmente.
function loadContentScriptWithoutSiteAccess(dom) {
  vm.createContext(dom.window);
  vm.runInContext(FILTER_CORE_SRC, dom.window, { filename: 'filter-core.js' });
  vm.runInContext(CONTENT_SRC, dom.window, { filename: 'content.js' });
  return dom.window;
}

async function settle(window, ticks = 6) {
  for (let i = 0; i < ticks; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

function dispatchBridgeMetadata(window, payload) {
  const root = window.document.documentElement;
  root.setAttribute('data-nl-filter-api-payload', JSON.stringify(payload));
  root.dispatchEvent(new window.Event('nl-filter-api-metadata', { bubbles: true }));
}

function getItemByTitle(window, title) {
  const items = Array.from(window.document.querySelectorAll('artifact-library-item'));
  return items.find((item) => item.querySelector('.artifact-title').textContent.trim() === title);
}

function typeChipText(window, type) {
  return window.document.querySelector('[data-nl-type="' + type + '"]').textContent.trim();
}

function sourceChipLabels(window) {
  return Array.from(window.document.querySelectorAll('[data-nl-source]')).map((chip) => chip.textContent.trim());
}

function findSourceChip(window, labelPrefix) {
  return Array.from(window.document.querySelectorAll('[data-nl-source]'))
    .find((chip) => chip.textContent.trim().startsWith(labelPrefix));
}

// Maqueta de la UI nativa de Gemini Notebook: boton ⋮ por elemento, menu
// superpuesto (Compartir ... Eliminar), dialogo "Eliminar Archivo?" con
// Cancelar/Eliminar y borrado real del nodo al confirmar. Estructura tomada de
// las capturas del usuario (la estructura interna exacta es una suposicion).
function installNativeUiMock(window, opts = {}) {
  const doc = window.document;
  const log = [];
  const overlay = doc.createElement('div');
  overlay.className = 'cdk-overlay-container';
  doc.body.appendChild(overlay);
  const titleOf = (item) => item.querySelector('.artifact-title').textContent.trim();

  function attach(item) {
    if (item.querySelector('.mock-more')) return;
    const more = doc.createElement('button');
    more.className = 'mock-more';
    more.innerHTML = '<mat-icon>more_vert</mat-icon>';
    item.appendChild(more);
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const title = titleOf(item);
      if (opts.noMenuFor && opts.noMenuFor.has(title)) return;
      overlay.innerHTML = '<div role="menu" class="mat-mdc-menu-panel">'
        + '<button role="menuitem"><mat-icon>share</mat-icon><span>Compartir</span></button>'
        + '<button role="menuitem"><mat-icon>edit</mat-icon><span>Cambiar nombre</span></button>'
        + '<button role="menuitem" class="mock-delete"><mat-icon>delete</mat-icon><span>Eliminar</span></button>'
        + '</div>';
      overlay.querySelector('.mock-delete').addEventListener('click', () => {
        overlay.innerHTML = '<div role="dialog" class="mat-mdc-dialog-container"><h2>Eliminar Archivo?</h2>'
          + (opts.dialogWithoutCancel ? '' : '<button class="mock-cancel">Cancelar</button>')
          + '<button class="mock-confirm">Eliminar</button></div>';
        const cancel = overlay.querySelector('.mock-cancel');
        if (cancel) cancel.addEventListener('click', () => { overlay.innerHTML = ''; });
        overlay.querySelector('.mock-confirm').addEventListener('click', () => {
          log.push(title);
          overlay.innerHTML = '';
          if (opts.recycleNodes) {
            // Angular reutiliza el nodo para mostrar otro elemento en vez de eliminarlo.
            item.querySelector('.artifact-title').textContent = 'Otro elemento reciclado';
          } else {
            item.remove();
          }
          if (opts.onDelete) opts.onDelete(title);
        });
      });
    });
  }

  const attachAll = () => doc.querySelectorAll('artifact-library-item').forEach(attach);
  attachAll();
  return { log, overlay, attachAll };
}

function fastBulkTimeouts(window) {
  vm.runInContext('BULK_DELETE.menuMs = 250; BULK_DELETE.dialogMs = 250; BULK_DELETE.goneMs = 250;', window);
}

async function loadWithMetadata(opts = {}) {
  const window = loadContentScript(buildDom(opts));
  await window.runOnce();
  dispatchBridgeMetadata(window, {
    sources: opts.sources || REAL_SOURCES,
    artifacts: opts.artifacts || REAL_ARTIFACTS,
  });
  await settle(window);
  await window.runOnce();
  return window;
}

test('clicking the Audio chip hides quiz items when artifact metadata is captured correctly', async () => {
  const dom = buildDom({
    url: 'https://notebook.google.com/notebook/66d41b00-97bc-4f4c-a871-ba9f634f8b78',
  });
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const audioChip = window.document.querySelector('[data-nl-type="audio"]');
  assert.ok(audioChip, 'el chip de Audio deberia existir en el panel');

  audioChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  const quiz1 = getItemByTitle(window, 'T063 - Test - Test');
  const quiz2 = getItemByTitle(window, 'T64 - Test - Test');
  const audioItems = window.document.querySelectorAll('.artifact-title')
    .length; // sanity: nos asegura que el fixture se construyo

  assert.equal(audioChip.getAttribute('aria-pressed'), 'true', 'el chip Audio debe quedar marcado como activo');
  assert.equal(quiz1.hasAttribute('hidden'), true, 'T063 - Test - Test (quiz) deberia ocultarse al filtrar por Audio');
  assert.equal(quiz2.hasAttribute('hidden'), true, 'T64 - Test - Test (quiz) deberia ocultarse al filtrar por Audio');

  const audioTitles = ['T66 - Audio - Test', 'T64 - Audio - Test', 'T65 - Audio - Test'];
  audioTitles.forEach((title) => {
    const items = Array.from(window.document.querySelectorAll('artifact-library-item'))
      .filter((item) => item.querySelector('.artifact-title').textContent.trim() === title);
    items.forEach((item) => {
      assert.equal(item.hasAttribute('hidden'), false, `${title} (audio) no deberia ocultarse al filtrar por Audio`);
    });
  });
});

test('type filtering still discriminates audio vs quiz when the RPC typeCode is wrong/shared', async () => {
  // Hipotesis de causa raiz del sintoma 1: el campo que leemos como
  // "typeCode" (row[2] de la fila batchexecute) no es fiable -- podria ser
  // en realidad un flag de estado ("completado") que vale lo mismo para
  // todos los artefactos, en vez del tipo real. Simulamos justo ese caso
  // (todos con typeCode=1) y confirmamos que el filtrado por tipo sigue
  // discriminando correctamente apoyandose en el DOM (icono/boton play),
  // que es una senal que la propia UI de NotebookLM no puede falsear.
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  const artifactsWithWrongTypeCode = REAL_ARTIFACTS.map((artifact) => ({ ...artifact, typeCode: 1 }));
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: artifactsWithWrongTypeCode });
  await settle(window);
  await window.runOnce();

  const audioChip = window.document.querySelector('[data-nl-type="audio"]');
  audioChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  const quiz1 = getItemByTitle(window, 'T063 - Test - Test');
  const quiz2 = getItemByTitle(window, 'T64 - Test - Test');
  assert.equal(quiz1.hasAttribute('hidden'), true, 'con typeCode erroneo, el DOM (icono) deberia igualmente marcar T063 como no-audio');
  assert.equal(quiz2.hasAttribute('hidden'), true, 'con typeCode erroneo, el DOM (icono) deberia igualmente marcar T64-quiz como no-audio');

  const audioItem = getItemByTitle(window, 'T66 - Audio - Test');
  assert.equal(audioItem.hasAttribute('hidden'), false, 'el audio real debe seguir visible aunque el typeCode fuese el mismo para todos');
});

test('source chips show a readable key derived from the artifact title when the source title never arrives', async () => {
  // Reproduce el sintoma 2 real: el listado de fuentes ("063.md", "064.md"...)
  // nunca llega via batchexecute (posible hidratacion inicial no
  // interceptable), pero los artefactos SI llegan con sus sourceIds y con
  // titulos que incluyen el numero de tema ("T64 - Audio - Test").
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const sourceChips = Array.from(window.document.querySelectorAll('[data-nl-source]'))
    .map((chip) => ({ src: chip.getAttribute('data-nl-source'), label: chip.textContent.trim() }));

  const labels = sourceChips.map((chip) => chip.label).sort();
  assert.deepEqual(labels, ['063 (1)', '064 (3)', '065 (1)', '066 (1)'], 'deberian verse las claves de tema, no fragmentos de UUID');
  assert.ok(sourceChips.every((chip) => chip.src.startsWith('ID:')), 'cada chip de fuente se identifica por UUID (ID:<uuid>)');
});

test('clicking a resolved source chip filters by that source (symptom 4)', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const chip064 = findSourceChip(window, '064');
  assert.ok(chip064, 'deberia existir un chip para la fuente 064');

  chip064.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  // 064.md esta enlazada a: T64-Test-Test (quiz), T64-Audio-Test (x2).
  const t64Quiz = getItemByTitle(window, 'T64 - Test - Test');
  const t64AudioItems = Array.from(window.document.querySelectorAll('artifact-library-item'))
    .filter((item) => item.querySelector('.artifact-title').textContent.trim() === 'T64 - Audio - Test');
  const t65Audio = getItemByTitle(window, 'T65 - Audio - Test');
  const t63Quiz = getItemByTitle(window, 'T063 - Test - Test');

  assert.equal(t64Quiz.hasAttribute('hidden'), false, 'T64 - Test - Test usa la fuente 064 y deberia seguir visible');
  t64AudioItems.forEach((item) => assert.equal(item.hasAttribute('hidden'), false, 'los T64 - Audio - Test usan la fuente 064'));
  assert.equal(t65Audio.hasAttribute('hidden'), true, 'T65 usa la fuente 065, deberia ocultarse al filtrar por 064');
  assert.equal(t63Quiz.hasAttribute('hidden'), true, 'T063 usa la fuente 063, deberia ocultarse al filtrar por 064');
});

test('typing a source query in the text box filters correctly (symptom 3)', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const sourceInput = window.document.querySelector('[data-nl-source-search]');
  assert.ok(sourceInput, 'deberia existir el cuadro de busqueda de fuente');

  sourceInput.value = '063.md';
  sourceInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(window);
  await new Promise((resolve) => window.setTimeout(resolve, 160));

  const t63Quiz = getItemByTitle(window, 'T063 - Test - Test');
  const t64Quiz = getItemByTitle(window, 'T64 - Test - Test');
  assert.equal(t63Quiz.hasAttribute('hidden'), false, '"063.md" deberia mostrar el artefacto de la fuente 063');
  assert.equal(t64Quiz.hasAttribute('hidden'), true, '"063.md" no deberia mostrar artefactos de otras fuentes');
});

test('sanity: with no filters active every item stays visible', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const items = window.document.querySelectorAll('artifact-library-item');
  assert.equal(items.length, 6);
  items.forEach((item) => assert.equal(item.hasAttribute('hidden'), false));
});

// Regresion reportada tras la v0.1.4: en el notebook "Grupo III - ExDesarr
// (41-65)" los 14 chips de fuente aparecian TODOS como fallback de UUID
// ("Fuente 7b104fef"...), en vez de mostrar "041" etc. Causa raiz
// verificada: los nombres de fuente reales van pegados al numero con "_"
// ("Tema41_Desarrollo_..._ESTUDIO.md"), y las regex de extraccion exigian
// un limite de palabra ("\b") tras el numero -- pero "_" cuenta como
// caracter de palabra, asi que ese limite nunca se cumplia y la clave
// jamas se derivaba, para NINGUNA fuente con ese convenio de nombres.
test('resolves a readable source label from a real underscore-separated filename', async () => {
  const dom = buildDom({ artifacts: REAL_ARTIFACTS_TEMA });
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES_TEMA, artifacts: REAL_ARTIFACTS_TEMA });
  await settle(window);
  await window.runOnce();

  const sourceChips = Array.from(window.document.querySelectorAll('[data-nl-source]'))
    .map((chip) => ({ src: chip.getAttribute('data-nl-source'), label: chip.textContent.trim() }));

  assert.deepEqual(sourceChips.map((c) => c.label).sort(), [
    'Tema41_Desarrollo_Equipos_Departamentales_Dispositivos_Personales_Madrid_ESTUDIO.md (2)',
    'Tema41_Desarrollo_Equipos_Departamentales_Dispositivos_Personales_Madrid_EXAMEN.md (1)',
  ], 'ESTUDIO y EXAMEN son fuentes distintas: un chip por fuente, con su nombre real');
  assert.ok(sourceChips.every((chip) => chip.src.startsWith('ID:')), 'los chips se identifican por UUID');
});

test('only falls back to a UUID chip for the one source with no derivable number, not for its siblings', async () => {
  // 'Trampas de agilidad para opositores TIC' y 'Resumen en audio del tema'
  // no repiten el numero de tema en su propio titulo, y aqui simulamos que
  // el listado de fuentes tampoco llega (sources: []) -- ese caso SI debe
  // caer al fallback por UUID (no hay ningun texto del que derivar '041'),
  // pero sin arrastrar a 'Claves y trampas del Tema 041 TIC', que si puede
  // resolverse a partir de su propio titulo de articulo.
  const dom = buildDom({ artifacts: REAL_ARTIFACTS_TEMA });
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS_TEMA });
  await settle(window);
  await window.runOnce();

  const sourceChips = Array.from(window.document.querySelectorAll('[data-nl-source]'))
    .map((chip) => ({ src: chip.getAttribute('data-nl-source'), label: chip.textContent.trim() }));

  assert.deepEqual(sourceChips.map((c) => c.label).sort(), ['041 (1)', 'Fuente sin nombre · 193e (2)'],
    '041 se deriva del articulo "Claves y trampas del Tema 041 TIC"; la otra fuente no tiene nombre ni numero y sigue seleccionable');
});

test('type filtering still works with natural, non-templated artifact titles', async () => {
  const dom = buildDom({ artifacts: REAL_ARTIFACTS_TEMA });
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES_TEMA, artifacts: REAL_ARTIFACTS_TEMA });
  await settle(window);
  await window.runOnce();

  const audioChip = window.document.querySelector('[data-nl-type="audio"]');
  audioChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  const quiz = getItemByTitle(window, 'Claves y trampas del Tema 041 TIC');
  const audio1 = getItemByTitle(window, 'Trampas de agilidad para opositores TIC');
  const audio2 = getItemByTitle(window, 'Resumen en audio del tema');
  assert.equal(quiz.hasAttribute('hidden'), true, 'el cuestionario sin palabras clave de tipo en el titulo debe ocultarse al filtrar por Audio');
  assert.equal(audio1.hasAttribute('hidden'), false, 'el audio con titulo natural debe seguir visible al filtrar por Audio');
  assert.equal(audio2.hasAttribute('hidden'), false, 'el segundo audio con titulo natural debe seguir visible al filtrar por Audio');
});

// Regression del bug real de la v0.1.5: en el navegador del usuario,
// `globalThis.NotebookFilterCore` no estaba definida al cargar content.js, asi
// que `const FILTER_CORE = globalThis.NotebookFilterCore` capturaba undefined y
// `matchesMetadata` caia a `: true` (sin filtrado por tipo ni por fuente, pero
// la busqueda de texto seguia funcionando porque no usa FILTER_CORE). Este test
// reproduce ese escenario cargando content.js SIN filter-core.js y verifica
// que el fallback inline restaura el filtrado por tipo Y por fuente, incluido
// el filtrado por texto de fuente ("041.md") y el chip de fuente legible.
test('filtering still works when globalThis.NotebookFilterCore is unavailable (inline fallback)', async () => {
  // El contexto vm de Node delega `globalThis` al global del proceso, y otros
  // tests cargan filter-core.js (lo fijan en ese global). Para reproducir
  // fielmente "la global no esta definida" (el escenario real del navegador),
  // se elimina temporalmente y se restaura al salir.
  const savedCore = globalThis.NotebookFilterCore;
  delete globalThis.NotebookFilterCore;
  try {
    const dom = buildDom();
    const window = loadContentScriptWithoutCore(dom);

    assert.equal(window.__nlFilterCoreSource, 'inline',
      'sin filter-core.js, FILTER_CORE debe resolverse al fallback inline, no a la global');

    await window.runOnce();
    dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS });
    await settle(window);
    await window.runOnce();

    // Sintoma 1: filtrar por tipo (Test/quiz) debe ocultar los audios.
    const testChip = window.document.querySelector('[data-nl-type="quiz"]');
    assert.ok(testChip, 'debe existir el chip Test (quiz)');
    testChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await settle(window);

    const t66Audio = getItemByTitle(window, 'T66 - Audio - Test');
    const t63Quiz = getItemByTitle(window, 'T063 - Test - Test');
    assert.equal(t66Audio.hasAttribute('hidden'), true, 'con Test activo, el audio debe ocultarse (sintoma 1)');
    assert.equal(t63Quiz.hasAttribute('hidden'), false, 'con Test activo, el quiz debe seguir visible (sintoma 1)');

    // Desactivar Test antes de probar la fuente.
    testChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await settle(window);

    // Sintoma 2: los chips de fuente deben mostrar clave legible (no UUID).
    const sourceChips = Array.from(window.document.querySelectorAll('[data-nl-source]'))
      .map((chip) => ({ src: chip.getAttribute('data-nl-source'), label: chip.textContent.trim() }));
  assert.deepEqual(sourceChips.map((c) => c.label).sort(), ['063 (1)', '064 (3)', '065 (1)', '066 (1)'],
    'los chips de fuente deben mostrar claves legibles derivadas del titulo del artefacto, no UUIDs (sintoma 2)');
    assert.ok(sourceChips.every((chip) => chip.src.startsWith('ID:')),
      'los chips se identifican por UUID tambien con el fallback inline (sintoma 2)');

    // Sintoma 3: escribir "063.md" en la caja de fuente debe filtrar a la 063.
    const sourceInput = window.document.querySelector('[data-nl-source-search]');
    assert.ok(sourceInput, 'debe existir la caja de busqueda de fuente');
    sourceInput.value = '063.md';
    sourceInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle(window);
    await new Promise((resolve) => window.setTimeout(resolve, 160));

    const t63After = getItemByTitle(window, 'T063 - Test - Test');
    const t64After = getItemByTitle(window, 'T64 - Test - Test');
    assert.equal(t63After.hasAttribute('hidden'), false, '"063.md" debe mostrar el artefacto de la fuente 063 (sintoma 3)');
    assert.equal(t64After.hasAttribute('hidden'), true, '"063.md" debe ocultar los artefactos de otras fuentes (sintoma 3)');
  } finally {
    globalThis.NotebookFilterCore = savedCore;
  }
});

// Regression del bug real corregido en la revision final de v1.1.0
// (Critical 2): mismo patron que el bug de FILTER_CORE en 0.1.6, aplicado a
// `globalThis.NotebookSiteAccess`. Reproduce el escenario cargando
// content.js SIN site-access.js (pero CON filter-core.js) y comprueba que el
// panel de filtros se sigue instalando y que el filtro por tipo sigue
// funcionando en notebook.google.com gracias al fallback inline de
// `isNotebookPage()`.
test('filter panel still appears and type filter still works when globalThis.NotebookSiteAccess is unavailable', async () => {
  // Igual que en el test equivalente de FILTER_CORE: se elimina la global
  // temporalmente para reproducir fielmente "la global no esta definida",
  // y se restaura al salir para no afectar a otros tests.
  const savedSiteAccess = globalThis.NotebookSiteAccess;
  delete globalThis.NotebookSiteAccess;
  try {
    const dom = buildDom({
      url: 'https://notebook.google.com/notebook/66d41b00-97bc-4f4c-a871-ba9f634f8b78',
    });
    const window = loadContentScriptWithoutSiteAccess(dom);

    assert.equal(window.NotebookSiteAccess, undefined,
      'sanity: site-access.js no debe haberse cargado en este escenario');

    await window.runOnce();
    dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
    await settle(window);
    await window.runOnce();

    const panel = window.document.getElementById('nl-filter-panel');
    assert.ok(panel, 'el panel de filtros deberia instalarse en notebook.google.com aunque NotebookSiteAccess no este definida');

    const audioChip = window.document.querySelector('[data-nl-type="audio"]');
    assert.ok(audioChip, 'el chip de Audio deberia existir en el panel');

    audioChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await settle(window);

    const quiz1 = getItemByTitle(window, 'T063 - Test - Test');
    const audioItem = getItemByTitle(window, 'T66 - Audio - Test');
    assert.equal(quiz1.hasAttribute('hidden'), true, 'con Audio activo, el quiz deberia ocultarse (el filtro por tipo debe seguir funcionando)');
    assert.equal(audioItem.hasAttribute('hidden'), false, 'con Audio activo, el audio real deberia seguir visible');
  } finally {
    globalThis.NotebookSiteAccess = savedSiteAccess;
  }
});

test('los cuadros de busqueda aplican el filtro con debounce (no inmediato)', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const searchInput = window.document.querySelector('[data-nl-search]');
  assert.ok(searchInput, 'debe existir el cuadro de busqueda');

  // Escribir "audio": ocultaria los quiz (T063/T64 - Test - Test) y dejaria
  // los audios visibles. Con debounce, justo despues de escribir (settle solo
  // vacia microtasks de setTimeout(0), no los 120ms del debounce) el filtrado
  // todavia NO se ha aplicado.
  searchInput.value = 'audio';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(window);

  const quiz = getItemByTitle(window, 'T063 - Test - Test');
  assert.equal(quiz.hasAttribute('hidden'), false,
    'con debounce, el quiz debe seguir visible justo despues de escribir (el filtrado aun no se ha aplicado)');

  // Al superar el debounce (~120ms), el filtrado se aplica.
  await new Promise((resolve) => window.setTimeout(resolve, 160));

  const quizAfter = getItemByTitle(window, 'T063 - Test - Test');
  const audioAfter = getItemByTitle(window, 'T66 - Audio - Test');
  assert.equal(quizAfter.hasAttribute('hidden'), true,
    'tras el debounce, el quiz sin "audio" en el titulo debe ocultarse');
  assert.equal(audioAfter.hasAttribute('hidden'), false,
    'tras el debounce, el audio con "audio" en el titulo debe seguir visible');
});

test('el MutationObserver se re-ancla al panel de Studio tras runOnce', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const target = window.__nlFilterObserverTarget;
  assert.ok(target, 'runOnce debe haber expuesto el target del observer');
  assert.notEqual(target, window.document.documentElement,
    'el observer debe anclarse al panel de Studio, no seguir en documentElement');
  const panel = window.document.querySelector('.panel-content-scrollable');
  assert.equal(target, panel,
    'el target del observer debe ser el panel de Studio localizado');
});

test('los filtros guardados se aislan por notebook (no se heredan al cambiar)', async () => {
  const store = {}; // almacen compartido por los dos notebooks
  const urlA = 'https://notebooklm.google.com/notebook/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const urlB = 'https://notebooklm.google.com/notebook/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const winA = loadContentScript(buildDom({ url: urlA, store }));
  const winB = loadContentScript(buildDom({ url: urlB, store }));

  // Notebook A: activar el filtro Audio y dejar que se guarde.
  await winA.runOnce();
  dispatchBridgeMetadata(winA, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(winA);
  await winA.runOnce();
  const audioChipA = winA.document.querySelector('[data-nl-type="audio"]');
  audioChipA.dispatchEvent(new winA.Event('click', { bubbles: true, cancelable: true }));
  await settle(winA);
  assert.equal(audioChipA.getAttribute('aria-pressed'), 'true',
    'sanity: el chip Audio debe quedar activo en el notebook A');

  // Notebook B: no debe heredar el filtro de A; debe arrancar en "Todos".
  await winB.runOnce();
  dispatchBridgeMetadata(winB, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(winB);
  await winB.runOnce();
  const audioChipB = winB.document.querySelector('[data-nl-type="audio"]');
  const allChipB = winB.document.querySelector('[data-nl-type="__all__"]');
  assert.equal(audioChipB.getAttribute('aria-pressed'), 'false',
    'el notebook B no debe heredar el filtro Audio guardado en el notebook A');
  assert.equal(allChipB.getAttribute('aria-pressed'), 'true',
    'el notebook B debe arrancar en Todos por defecto');
});

test('muestra estado vacio cuando los filtros no dejan ningun resultado', async () => {
  const window = loadContentScript(buildDom());

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const emptyState = () => window.document.getElementById('nl-empty-state');

  // Sin filtros: no hay estado vacio visible.
  await settle(window);
  assert.ok(!emptyState() || emptyState().hasAttribute('hidden'),
    'con Todos activo no debe mostrarse el estado vacio');

  // Seleccionar un tipo que no tiene ningun item (video) -> 0 visibles.
  const videoChip = window.document.querySelector('[data-nl-type="video"]');
  assert.ok(videoChip, 'debe existir el chip Video (aunque no haya items)');
  videoChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  assert.ok(emptyState(), 'debe crearse el elemento de estado vacio');
  assert.equal(emptyState().hasAttribute('hidden'), false,
    'con un filtro activo que no deja resultados, el estado vacio debe mostrarse');
  assert.ok(emptyState().textContent.includes('Ningún resultado'),
    'el mensaje del estado vacio debe ser legible');

  // Deseleccionar Video -> vuelve a haber resultados -> estado vacio oculto.
  videoChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);
  assert.equal(emptyState().hasAttribute('hidden'), true,
    'al desactivar el filtro, el estado vacio debe ocultarse');
});

test('los chips de fuente muestran el nombre completo cuando scanSourcesPanel lo captura', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  // Simula el panel "Fuentes" del DOM de NotebookLM: cada fuente con su UUID
  // (data-source-id) y su titulo real ("063.md"). El bridge entrega sources:[]
  // (los titulos no vienen por batchexecute), de modo que los titulos solo
  // pueden llegar via scanSourcesPanel leyendo este panel.
  const sourcesPanel = window.document.createElement('div');
  sourcesPanel.className = 'source-panel';
  sourcesPanel.innerHTML = REAL_SOURCES.map(([id, title]) =>
    `<div class="single-source-container" data-source-id="${id}"><span class="source-title">${title}</span></div>`
  ).join('');
  window.document.body.appendChild(sourcesPanel);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const labels = Array.from(window.document.querySelectorAll('[data-nl-source]'))
    .map((chip) => chip.textContent.trim()).sort();
  assert.deepEqual(labels, ['063.md (1)', '064.md (3)', '065.md (1)', '066.md (1)'],
    'los chips deben mostrar el nombre completo de la fuente (063.md), no solo el numero ni el UUID');
});

test('el contador de resultados muestra "Mostrando X de Y" al filtrar', async () => {
  const window = loadContentScript(buildDom());

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const countEl = () => window.document.getElementById('nl-result-count');
  assert.ok(countEl(), 'debe existir el elemento contador');

  // Sin filtros: 6 de 6.
  assert.equal(countEl().textContent, 'Mostrando 6 de 6',
    'sin filtros el contador debe mostrar el total');

  // Filtrar por Test (quiz): 2 visibles de 6.
  const testChip = window.document.querySelector('[data-nl-type="quiz"]');
  testChip.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);
  assert.equal(countEl().textContent, 'Mostrando 2 de 6',
    'al filtrar por Test, el contador debe mostrar 2 de 6');
});

test('los chips muestran el recuento de items por tipo y por fuente', async () => {
  const window = loadContentScript(buildDom());

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const audioChip = window.document.querySelector('[data-nl-type="audio"]');
  const quizChip = window.document.querySelector('[data-nl-type="quiz"]');
  assert.ok(audioChip.textContent.includes('(4)'), 'el chip Audio debe mostrar (4)');
  assert.ok(quizChip.textContent.includes('(2)'), 'el chip Test debe mostrar (2)');

  const chip064 = findSourceChip(window, '064');
  assert.ok(chip064, 'debe existir el chip de la fuente 064');
  assert.ok(chip064.textContent.includes('(3)'), 'la fuente 064 (3 items) debe mostrar (3)');
});

test('el panel se colapsa al clic en la cabecera y persiste el estado por notebook', async () => {
  const window = loadContentScript(buildDom());

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const body = () => window.document.getElementById('nl-filter-body');
  const arrow = () => window.document.getElementById('nl-collapse-arrow');
  assert.ok(body(), 'debe existir el cuerpo del panel');
  assert.equal(body().classList.contains('nl-collapsed'), false, 'inicia expandido');
  assert.equal(arrow().textContent, '▼', 'inicia con flecha de expandido');

  const title = window.document.querySelector('.nl-filter-title');
  title.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  assert.equal(body().classList.contains('nl-collapsed'), true, 'tras un clic en la cabecera debe colapsar');
  assert.equal(arrow().textContent, '▶', 'la flecha debe indicar colapsado');

  // Persistencia: un nuevo runOnce debe respetar el estado guardado.
  await window.runOnce();
  assert.equal(body().classList.contains('nl-collapsed'), true, 'el estado colapsado debe persistir tras runOnce');

  title.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  assert.equal(body().classList.contains('nl-collapsed'), false, 'tras otro clic debe volver a expandirse');
  assert.equal(arrow().textContent, '▼', 'la flecha debe volver a expandido');
});

// El fallback inline (INLINE_FILTER_CORE en content.js) duplica las funciones
// puras de filter-core.js por el bug de la 0.1.6. Este test evita que
// diverjan: mismas entradas, mismas salidas.
function plain(value) {
  return JSON.parse(JSON.stringify(value, (key, v) => (
    Object.prototype.toString.call(v) === '[object Set]' ? Array.from(v).sort() : v
  )));
}

test('el fallback inline reproduce exactamente el resultado de filter-core.js', () => {
  const core = require('./filter-core');
  const window = loadContentScript(buildDom());
  const inline = vm.runInContext('INLINE_FILTER_CORE', window);

  ['Tema41_Madrid_ESTUDIO.md', 'Parte 12 del Tema 41', '047.md', 'Informe anual 2026', ''].forEach((text) => {
    assert.deepEqual(plain(inline.extractSourceKeys(text)), plain(core.extractSourceKeys(text)), text);
  });

  const artifacts = new Map(REAL_ARTIFACTS.map((a) => [a.id, { title: a.title, sourceIds: a.sourceIds }]));
  const domItems = REAL_ARTIFACTS.map((a) => ({ id: a.id, title: a.title, kind: a.typeCode === 1 ? 'audio' : 'quiz' }));
  const withNames = { artifacts, sourceTitles: new Map(REAL_SOURCES) };
  const withoutNames = { artifacts, sourceTitles: new Map() };
  [withNames, withoutNames].forEach((dict) => {
    assert.deepEqual(plain(inline.buildStudyModel(domItems, dict)), plain(core.buildStudyModel(domItems, dict)));
  });
  assert.deepEqual(plain(inline.buildStudyModel([], withNames)), plain(core.buildStudyModel([], withNames)));

  const model = core.buildStudyModel(domItems, withNames);
  [
    {},
    { T064: true, T099: true },
    { T064: false },
    { 'ID:ea0a4122-c95a-4db3-a09d-d78439d5ccc2': true, 'ID:00000000-0000-4000-8000-000000000000': true },
  ].forEach((saved) => {
    assert.deepEqual(plain(inline.reconcileSourceFilter(model, saved)), plain(core.reconcileSourceFilter(model, saved)));
  });
});

// --- Enlace DOM <-> metadatos (spec v1.2.0, H4) ------------------------------
test('un nodo reciclado por Angular se revalida y no hereda el artefacto anterior', async () => {
  const window = await loadWithMetadata();
  const t66 = getItemByTitle(window, 'T66 - Audio - Test');
  const t65 = getItemByTitle(window, 'T65 - Audio - Test');
  assert.equal(t65.dataset.nlArtifactId, '9af21145-dbef-4bea-a6b9-a754160e3bf7', 'sanity: T65 enlazado a su artefacto');

  // Se borra T66 y Angular reutiliza el nodo de T65 para mostrar T66.
  t66.remove();
  t65.querySelector('.artifact-title').textContent = 'T66 - Audio - Test';
  await window.runOnce();

  assert.equal(t65.dataset.nlArtifactId, '2524cd6f-d462-4586-a90e-5cd81db6ba25',
    'el nodo reciclado debe enlazarse al artefacto que muestra ahora (T66), no al que mostraba antes (T65)');
});

test('el fallback posicional se rechaza si el titulo del DOM contradice al de los metadatos', async () => {
  const window = loadContentScript(buildDom());
  await window.runOnce();
  const items = Array.from(window.document.querySelectorAll('artifact-library-item'));
  items[2].querySelector('.artifact-title').textContent = 'Un titulo completamente distinto';
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  assert.equal(items[2].dataset.nlArtifactId, undefined,
    'un titulo que contradice al de la red no debe enlazarse solo por estar en la misma posicion');
});

// Guardas (pasan antes y despues del cambio): fijan el comportamiento que no
// debe romperse al endurecer el enlace.
test('un titulo del DOM que solo difiere en espacios o mayusculas sigue enlazado por posicion', async () => {
  const window = loadContentScript(buildDom());
  await window.runOnce();
  const items = Array.from(window.document.querySelectorAll('artifact-library-item'));
  items[2].querySelector('.artifact-title').textContent = 'T66  -  audio - test';
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  assert.equal(items[2].dataset.nlArtifactId, '2524cd6f-d462-4586-a90e-5cd81db6ba25');
});

test('al borrar uno de dos elementos con el mismo titulo, el otro sigue enlazado a su propio artefacto', async () => {
  const window = await loadWithMetadata();
  const twins = Array.from(window.document.querySelectorAll('artifact-library-item'))
    .filter((item) => item.querySelector('.artifact-title').textContent.trim() === 'T64 - Audio - Test');
  assert.equal(twins.length, 2);
  const [first, second] = twins;
  const secondId = second.dataset.nlArtifactId;
  assert.ok(secondId, 'sanity: el segundo T64 - Audio - Test esta enlazado');
  assert.notEqual(first.dataset.nlArtifactId, secondId, 'sanity: los dos gemelos tienen ids distintos');

  first.remove();
  await window.runOnce();

  assert.equal(second.dataset.nlArtifactId, secondId);
});

// --- Panel derivado del modelo (spec v1.2.0, H1/H2/H5/H7) --------------------
test('al borrar un elemento los recuentos de tipo y el contador se actualizan sin recargar', async () => {
  const window = await loadWithMetadata();
  assert.equal(typeChipText(window, 'audio'), 'Audio (4)');
  assert.equal(window.document.getElementById('nl-result-count').textContent, 'Mostrando 6 de 6');

  getItemByTitle(window, 'T66 - Audio - Test').remove();
  await window.runOnce();

  assert.equal(typeChipText(window, 'audio'), 'Audio (3)', 'el chip Audio debe descontar el elemento borrado');
  assert.equal(typeChipText(window, 'quiz'), 'Test (2)');
  assert.equal(window.document.getElementById('nl-result-count').textContent, 'Mostrando 5 de 5');
});

test('al borrar el ultimo elemento de una fuente su chip desaparece y las demas se mantienen', async () => {
  const window = await loadWithMetadata();
  assert.ok(findSourceChip(window, '066'), 'sanity: existe el chip 066');

  getItemByTitle(window, 'T66 - Audio - Test').remove();
  await window.runOnce();

  assert.equal(findSourceChip(window, '066'), undefined, 'la fuente 066 ya no tiene elementos');
  assert.deepEqual(sourceChipLabels(window), ['063.md (1)', '064.md (3)', '065.md (1)']);
});

test('al borrar todos los elementos no quedan chips de fuente, ni contador, ni estado vacio', async () => {
  const window = await loadWithMetadata();
  window.document.querySelectorAll('artifact-library-item').forEach((item) => item.remove());
  await window.runOnce();

  assert.equal(window.document.getElementById('nl-result-count').textContent, '',
    'sin elementos no hay contador "Mostrando"');
  assert.equal(window.document.querySelectorAll('[data-nl-source]').length, 0);
  assert.equal(typeChipText(window, 'audio'), 'Audio (0)');
  const empty = window.document.getElementById('nl-empty-state');
  assert.ok(!empty || empty.hasAttribute('hidden'),
    'una biblioteca vacia no debe mostrar "Ningun resultado con estos filtros"');
});

test('el cuadro de busqueda no se reconstruye cuando solo cambian los contadores', async () => {
  const window = await loadWithMetadata();
  const input = window.document.querySelector('[data-nl-search]');
  input.value = 'texto en curso';
  const twin = Array.from(window.document.querySelectorAll('artifact-library-item'))
    .find((item) => item.querySelector('.artifact-title').textContent.trim() === 'T64 - Audio - Test');

  twin.remove(); // la fuente 064 sigue existiendo: el conjunto de chips no cambia
  await window.runOnce();

  assert.equal(window.document.querySelector('[data-nl-search]'), input, 'el input debe seguir siendo el mismo nodo');
  assert.equal(input.value, 'texto en curso');
  assert.equal(findSourceChip(window, '064').textContent.trim(), '064.md (2)');
});

test('el popup recibe las fuentes como chips por UUID con su etiqueta', async () => {
  const messageListeners = [];
  await loadWithMetadata({ messageListeners });
  const responses = [];
  messageListeners.forEach((listener) => listener({ type: 'nl-get-available-sources' }, {}, (r) => responses.push(r)));

  assert.equal(responses.length, 1);
  // La respuesta se crea dentro del contexto vm (otro realm): Array.from la
  // copia a un array del realm del test para que deepEqual compare prototipos.
  assert.deepEqual(Array.from(responses[0].sources.map((s) => s.display)).sort(), ['063.md', '064.md', '065.md', '066.md']);
  assert.ok(responses[0].sources.every((s) => s.src.startsWith('ID:')));
  assert.deepEqual(Array.from(responses[0].studyTypes), ['audio', 'quiz']);
});

test('__nlFilterDebug sigue funcionando y devuelve el modelo', async () => {
  const window = await loadWithMetadata();
  window.console = { log() {}, table() {}, info() {}, error() {}, warn() {} };
  const result = window.__nlFilterDebug();
  assert.equal(result.model.artifacts.length, 6);
  assert.equal(result.model.sources.length, 4);
});

// --- Filtro de fuentes guardado: migracion y poda (spec v1.2.0, H3) ----------
const NB_ID = '66d41b00-97bc-4f4c-a871-ba9f634f8b78';
const SOURCE_KEY = 'sourceTypes:' + NB_ID;
const SRC_064_ID = 'ea0a4122-c95a-4db3-a09d-d78439d5ccc2';
const SRC_066_ID = '29e4fde1-ba03-4f8f-ad2f-3192805aeef7';

function activeSourceKeys(store) {
  const saved = store[SOURCE_KEY] || {};
  return Object.keys(saved).filter((key) => saved[key]);
}

test('al borrar el ultimo elemento de una fuente seleccionada, el filtro guardado se poda y no se oculta todo', async () => {
  const store = {};
  const window = await loadWithMetadata({ store });
  findSourceChip(window, '066').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);
  assert.deepEqual(activeSourceKeys(store), ['ID:' + SRC_066_ID], 'sanity: la seleccion se guarda por UUID');

  getItemByTitle(window, 'T66 - Audio - Test').remove();
  await window.runOnce();

  const visible = Array.from(window.document.querySelectorAll('artifact-library-item'))
    .filter((item) => !item.hasAttribute('hidden'));
  assert.equal(visible.length, 5, 'sin la fuente 066 el filtro no debe seguir ocultando el resto');
  assert.equal(Object.keys(store[SOURCE_KEY]).includes('ID:' + SRC_066_ID), false,
    'la seleccion huerfana debe desaparecer tambien del almacenamiento');
});

test('un filtro de fuente guardado con claves antiguas (T064) se migra a UUID cuando los metadatos estan completos', async () => {
  const store = { [SOURCE_KEY]: { T064: true } };
  const window = await loadWithMetadata({ store });

  assert.equal(findSourceChip(window, '064').getAttribute('aria-pressed'), 'true',
    'el chip de la fuente 064 debe quedar marcado tras migrar');
  assert.deepEqual(plain(store[SOURCE_KEY]), { ['ID:' + SRC_064_ID]: true });
  assert.equal(getItemByTitle(window, 'T65 - Audio - Test').hasAttribute('hidden'), true);
  assert.equal(getItemByTitle(window, 'T64 - Test - Test').hasAttribute('hidden'), false);
});

// Guarda (pasa antes y despues): el DOM se pinta antes de que lleguen los
// metadatos, y en ese momento la seleccion guardada NO debe podarse.
test('no se poda la seleccion guardada mientras los metadatos no han llegado', async () => {
  const store = { [SOURCE_KEY]: { ['ID:' + SRC_066_ID]: true } };
  const window = loadContentScript(buildDom({ store }));
  await window.runOnce(); // hay elementos en el DOM pero aun no hay metadatos

  assert.deepEqual(store[SOURCE_KEY], { ['ID:' + SRC_066_ID]: true },
    'sin metadatos no se puede saber que fuentes existen');

  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  assert.deepEqual(store[SOURCE_KEY], { ['ID:' + SRC_066_ID]: true });
  assert.equal(findSourceChip(window, '066').getAttribute('aria-pressed'), 'true');
});

// --- Renderizado seguro (spec v1.2.0, H8) ------------------------------------
test('un nombre de fuente con HTML se muestra como texto y no se inyecta', async () => {
  const evil = '<img src=x onerror="window.__pwned = true">.md';
  const sources = [[REAL_SOURCES[0][0], evil], ...REAL_SOURCES.slice(1)];
  const window = await loadWithMetadata({ sources });

  const panel = window.document.getElementById('nl-filter-panel');
  assert.equal(panel.querySelector('img'), null, 'no debe crearse ningun <img> dentro del panel');
  const chip = Array.from(panel.querySelectorAll('[data-nl-source]'))
    .find((el) => el.textContent.includes('onerror'));
  assert.ok(chip, 'el nombre debe aparecer como texto literal en el chip');
  assert.ok(chip.textContent.startsWith(evil));
  assert.equal(chip.getAttribute('title'), evil, 'el nombre completo tambien va en el tooltip');
});

// --- Pase de arreglos de la revision final (I-1, I-2, I-3) -------------------
test('un nodo nuevo cuyo titulo solo difiere en espacios o mayusculas se enlaza por titulo, aunque cambie el orden', async () => {
  const window = loadContentScript(buildDom());
  await window.runOnce();
  const items = Array.from(window.document.querySelectorAll('artifact-library-item'));
  items[2].querySelector('.artifact-title').textContent = 'T66  -  audio - test';
  // La red devuelve los artefactos en otro orden: la posicion ya no ayuda.
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS.slice().reverse() });
  await settle(window);
  await window.runOnce();

  assert.equal(items[2].dataset.nlArtifactId, '2524cd6f-d462-4586-a90e-5cd81db6ba25',
    'el titulo normalizado es unico en la cache: debe enlazarse sin depender de la posicion');
});

test('al recrearse el nodo del gemelo superviviente no se enlaza al artefacto borrado', async () => {
  const ALPHA = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
  const BETA = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
  const A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const artifacts = [
    { id: A_ID, title: 'Resumen de audio', typeCode: 1, sourceIds: [ALPHA] },
    { id: B_ID, title: 'Resumen de audio', typeCode: 1, sourceIds: [BETA] },
  ];
  const window = await loadWithMetadata({ artifacts, sources: [[ALPHA, 'Alpha.md'], [BETA, 'Beta.md']] });
  const [alphaNode, betaNode] = Array.from(window.document.querySelectorAll('artifact-library-item'));
  assert.equal(betaNode.dataset.nlArtifactId, B_ID, 'sanity: cada gemelo enlazado a su artefacto');

  // Se borra el de Alpha y Angular vuelve a crear el nodo del superviviente.
  alphaNode.remove();
  const fresh = betaNode.cloneNode(true);
  fresh.removeAttribute('data-nl-artifact-id');
  betaNode.replaceWith(fresh);
  await window.runOnce();

  assert.notEqual(fresh.dataset.nlArtifactId, A_ID, 'no debe enlazarse al artefacto de Alpha, que ya no existe');
  assert.equal(findSourceChip(window, 'Alpha.md'), undefined, 'Alpha no tiene elementos: no debe haber chip');
});

test('una fuente seleccionada que ya no esta en el modelo se muestra marcada y se puede desmarcar', async () => {
  const GONE = 'ID:99999999-9999-4999-8999-999999999999';
  const store = { [SOURCE_KEY]: { [GONE]: true } };
  const extra = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Mapa Gamma renombrado', typeCode: 4, sourceIds: [] };
  const window = loadContentScript(buildDom({ store, artifacts: [...REAL_ARTIFACTS, extra] }));
  await window.runOnce();
  // El elemento extra no llega en los metadatos: queda sin enlazar y el modelo incompleto.
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const orphan = findSourceChip(window, 'Fuente no disponible');
  assert.ok(orphan, 'la seleccion huerfana debe verse como un chip para poder desmarcarla');
  assert.equal(orphan.getAttribute('aria-pressed'), 'true');

  orphan.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  const hidden = Array.from(window.document.querySelectorAll('artifact-library-item'))
    .filter((item) => item.hasAttribute('hidden'));
  assert.equal(hidden.length, 0, 'tras desmarcarla no debe quedar nada oculto por la fuente fantasma');
});

// --- Integracion con la estructura real del cuaderno "0. Metodo - Practico" --
// Sin esto, el parser descartaba los nombres de fuente y los artefactos de
// tipo 10/11, y el panel mostraba "Fuente sin nombre" con recuentos de 5.
test('del parser al panel: nombres reales de fuente y recuentos completos con artefactos de tipo 10 y 11', async () => {
  const core = require('./filter-core');
  const wrap = (rpc, payload) => `)]}'\n\n123\n${JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic']])}`;
  const names = ['_BLOQUE_CANONICO_ELICITATION.md', '_CADENA_DECISION.md', '_CHULETA_PREGUNTAS_IDENTIFICACION.md',
    '_FOLIO_EXAMEN.md', '_MAPA_MENTAL_EJ2.md', '_NOTACION_ESQUEMAS.md', '_PLANTILLAS_HERRAMIENTAS.md', '_VARIANTES_ENCARGO.md'];
  const ids = names.map((_, i) => `0000000${i}-0000-4000-8000-00000000000${i}`);
  const ENS = '658b36a6-8a6e-4def-9c1a-fa56c8ab4c80';
  const allSources = ids.map((id) => [[id], null, 1, '1700000000000']);

  const sourceRows = names.map((name, i) => [[ids[i]], name, [null, 10, [1700000000, 0], [`aaaaaaa${i}-0000-4000-8000-000000000000`, [1, 2]], 9], [null, 2]]);
  sourceRows.push([[ENS], '11_ENS_Seguridad.md', [null, 10, [1700000000, 0], ['bbbbbbbb-0000-4000-8000-000000000000', [1, 2]], 9], [null, 2]]);
  const artifactRows = [
    ['e0000000-0000-4000-8000-000000000001', 'bpmn_diagrama_tramitacion.png', 10, allSources, 3],
    ['e0000000-0000-4000-8000-000000000002', 'Control Táctico del Supuesto Práctico', 8, allSources, 3],
    ['e0000000-0000-4000-8000-000000000003', 'Oposiciones AGE Test', 4, allSources, 3],
    ['e0000000-0000-4000-8000-000000000004', 'Niveles de exigencia en examen', 7, allSources, 3],
    ['e0000000-0000-4000-8000-000000000005', 'Análisis Estructurado Tarjetas', 4, allSources, 3],
    ['e0000000-0000-4000-8000-000000000006', 'Trazabilidad Arquitectura', 5, allSources, 3],
    ['e0000000-0000-4000-8000-000000000007', 'Seguridad Cuestionario', 4, [[[ENS]]], 3],
    ['e0000000-0000-4000-8000-000000000008', 'Informe Interactivo de Dominio de la Metodología', 11, allSources, 3],
  ];

  const fromNotebook = core.parseNotebookBatchResponse(wrap('rLM1Ne', ['0. Método - Práctico', sourceRows, 'nb']));
  const fromStudio = core.parseNotebookBatchResponse(wrap('gArtLc', [artifactRows]));
  const snapshot = core.mergeMetadataSnapshot(
    { sources: Array.from(fromNotebook.sources.entries()), artifacts: [] },
    { sources: [], artifacts: fromStudio.artifacts }
  );

  const domArtifacts = artifactRows.map(([id, title, typeCode]) => ({ id, title, typeCode: typeCode === 1 ? 1 : 4 }));
  const window = loadContentScript(buildDom({ artifacts: domArtifacts }));
  await window.runOnce();
  dispatchBridgeMetadata(window, snapshot);
  await settle(window);
  await window.runOnce();

  assert.deepEqual(sourceChipLabels(window).sort(), [
    ...names.map((name) => `${name} (7)`),
    '11_ENS_Seguridad.md (1)',
  ].sort());
  assert.equal(window.__nlFilterModel().complete, true, 'los 8 elementos tienen metadatos: el modelo esta completo');
});

// --- Seleccion con casillas (hito 3) -----------------------------------------
function selectBoxes(window) {
  return Array.from(window.document.querySelectorAll('artifact-library-item .nl-select'));
}

test('cada elemento enlazado recibe una casilla y marcarla actualiza la seleccion', async () => {
  const window = await loadWithMetadata();
  const boxes = selectBoxes(window);
  assert.equal(boxes.length, 6, 'una casilla por elemento enlazado');

  boxes[0].click();
  boxes[1].click();
  await settle(window);

  assert.equal(vm.runInContext('selectedArtifactIds.size', window), 2);
  boxes[0].click();
  await settle(window);
  assert.equal(vm.runInContext('selectedArtifactIds.size', window), 1);
});

test('un elemento sin enlace a un artefacto no tiene casilla', async () => {
  const extra = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: 'Elemento sin metadatos', typeCode: 4, sourceIds: [] };
  const window = loadContentScript(buildDom({ artifacts: [...REAL_ARTIFACTS, extra] }));
  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: REAL_SOURCES, artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const unlinked = getItemByTitle(window, 'Elemento sin metadatos');
  assert.equal(unlinked.querySelector('.nl-select'), null, 'sin id resoluble no se puede borrar de forma segura');
  assert.equal(selectBoxes(window).length, 6);
});

test('pulsar la casilla no propaga el clic al elemento nativo', async () => {
  const window = await loadWithMetadata();
  let reached = 0;
  const item = window.document.querySelector('artifact-library-item');
  item.addEventListener('click', () => { reached += 1; });
  item.querySelector('.nl-select').click();
  assert.equal(reached, 0, 'el clic de la casilla no debe abrir el elemento');
});

test('inyectar casillas no realimenta al observer: en reposo no se programan escaneos', async () => {
  const window = await loadWithMetadata();
  let frames = 0;
  const original = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { frames += 1; return original(cb); };
  await new Promise((resolve) => window.setTimeout(resolve, 150));
  assert.equal(frames, 0, 'sin cambios externos no debe haber ningun escaneo pendiente');
});

// --- Barra de acciones (hito 3) ----------------------------------------------
const bulkBtn = (window, action) => window.document.querySelector('[data-nl-action="' + action + '"]');

test('la barra de acciones selecciona los visibles, deselecciona y cuenta', async () => {
  const window = await loadWithMetadata();
  assert.equal(bulkBtn(window, 'delete-selected').disabled, true, 'sin seleccion no se puede borrar');
  assert.equal(bulkBtn(window, 'delete-selected').textContent, 'Borrar (0)');

  bulkBtn(window, 'select-visible').click();
  await settle(window);
  assert.equal(bulkBtn(window, 'delete-selected').textContent, 'Borrar (6)');
  assert.equal(bulkBtn(window, 'delete-selected').disabled, false);
  assert.ok(selectBoxes(window).every((box) => box.checked));

  bulkBtn(window, 'select-none').click();
  await settle(window);
  assert.equal(bulkBtn(window, 'delete-selected').textContent, 'Borrar (0)');
  assert.ok(selectBoxes(window).every((box) => !box.checked));
});

test('"Seleccionar visibles" solo marca lo que deja pasar el filtro', async () => {
  const window = await loadWithMetadata();
  window.document.querySelector('[data-nl-type="audio"]').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  bulkBtn(window, 'select-visible').click();
  await settle(window);

  assert.equal(bulkBtn(window, 'delete-selected').textContent, 'Borrar (4)', 'hay 4 audios visibles');
});

test('lo seleccionado que un filtro posterior oculta se deselecciona y no se borrara', async () => {
  const window = await loadWithMetadata();
  bulkBtn(window, 'select-visible').click();
  await settle(window);
  assert.equal(bulkBtn(window, 'delete-selected').textContent, 'Borrar (6)');

  window.document.querySelector('[data-nl-type="quiz"]').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);

  assert.equal(bulkBtn(window, 'delete-selected').textContent, 'Borrar (2)', 'solo quedan seleccionados los 2 tests visibles');
});

test('"Limpiar" sigue limpiando los filtros y no toca la seleccion', async () => {
  const window = await loadWithMetadata();
  window.document.querySelector('[data-nl-type="audio"]').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);
  window.document.querySelector('[data-nl-action="clear"]').dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
  await settle(window);
  assert.equal(window.document.querySelector('[data-nl-type="__all__"]').getAttribute('aria-pressed'), 'true');
});

// --- Modal de confirmacion (hito 3) ------------------------------------------
test('el modal de confirmacion lista recuento y titulos, con Cancelar enfocado, y cancela por defecto', async () => {
  const window = await loadWithMetadata();
  const titles = Array.from({ length: 12 }, (_, i) => 'Elemento ' + (i + 1));
  const pending = vm.runInContext('confirmBulkDelete', window)(titles);

  const modal = window.document.getElementById('nl-confirm');
  assert.ok(modal, 'debe mostrarse el modal');
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.ok(modal.textContent.includes('12 elementos'), 'recuento');
  assert.ok(modal.textContent.includes('Elemento 10') && !modal.textContent.includes('Elemento 11'), 'maximo 10 titulos');
  assert.ok(modal.textContent.includes('y 2 más'));
  assert.ok(modal.textContent.includes('irreversible'));
  assert.equal(window.document.activeElement, modal.querySelector('[data-nl-confirm="no"]'), 'foco inicial en Cancelar');

  modal.querySelector('[data-nl-confirm="no"]').click();
  assert.equal(await pending, false);
  assert.equal(window.document.getElementById('nl-confirm'), null, 'el modal se retira al cerrar');
});

test('el modal solo devuelve true con el boton de confirmar; Esc devuelve false', async () => {
  const window = await loadWithMetadata();
  const confirm = vm.runInContext('confirmBulkDelete', window);

  const yes = confirm(['A']);
  window.document.querySelector('#nl-confirm [data-nl-confirm="yes"]').click();
  assert.equal(await yes, true);

  const esc = confirm(['A']);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(await esc, false);
});
