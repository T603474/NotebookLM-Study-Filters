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

function buildDom() {
  const itemsHtml = REAL_ARTIFACTS.map(artifactItemHtml).join('\n');
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

  const dom = new JSDOM(html, {
    url: 'https://notebooklm.google.com/notebook/66d41b00-97bc-4f4c-a871-ba9f634f8b78',
  });
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
        get: (_keys, cb) => cb({}),
        set: (_obj, cb) => { if (cb) cb(); },
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
