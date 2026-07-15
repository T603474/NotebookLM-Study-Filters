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
      onMessage: { addListener: () => {} },
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

test('clicking the Audio chip hides quiz items when artifact metadata is captured correctly', async () => {
  const dom = buildDom();
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
  assert.deepEqual(labels, ['063', '064', '065', '066'], 'deberian verse las claves de tema, no fragmentos de UUID');
  assert.ok(sourceChips.every((chip) => !chip.src.startsWith('ID:')), 'ningun chip deberia depender del fallback por UUID');
});

test('clicking a resolved source chip filters by that source (symptom 4)', async () => {
  const dom = buildDom();
  const window = loadContentScript(dom);

  await window.runOnce();
  dispatchBridgeMetadata(window, { sources: [], artifacts: REAL_ARTIFACTS });
  await settle(window);
  await window.runOnce();

  const chip064 = Array.from(window.document.querySelectorAll('[data-nl-source]'))
    .find((el) => el.textContent.trim() === '064');
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

  assert.deepEqual(sourceChips.map((c) => c.label).sort(), ['041'],
    'el nombre real "Tema41_..._ESTUDIO.md"/"_EXAMEN.md" deberia resolver a la clave 041, no a un UUID');
  assert.ok(sourceChips.every((chip) => !chip.src.startsWith('ID:')),
    'con el nombre de fuente real disponible, no deberia hacer falta el fallback por UUID');
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

  const readable = sourceChips.filter((chip) => !chip.src.startsWith('ID:'));
  const fallback = sourceChips.filter((chip) => chip.src.startsWith('ID:'));
  assert.deepEqual(readable.map((c) => c.label), ['041'],
    'el articulo "Claves y trampas del Tema 041 TIC" deberia bastar para derivar 041 sin metadatos de fuente');
  assert.equal(fallback.length, 1,
    'la fuente sin ningun numero derivable en su unico articulo debe caer al fallback por UUID, sin desaparecer');
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
    assert.deepEqual(sourceChips.map((c) => c.label).sort(), ['063', '064', '065', '066'],
      'los chips de fuente deben mostrar claves legibles derivadas del titulo del artefacto, no UUIDs (sintoma 2)');
    assert.ok(sourceChips.every((chip) => !chip.src.startsWith('ID:')),
      'ningun chip deberia caer al fallback por UUID cuando se puede derivar clave del titulo (sintoma 2)');

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
  assert.deepEqual(labels, ['063.md', '064.md', '065.md', '066.md'],
    'los chips deben mostrar el nombre completo de la fuente (063.md), no solo el numero ni el UUID');
});
