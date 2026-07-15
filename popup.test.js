// Pruebas de integracion del popup (popup.js) con jsdom.
//
// Verifican que el popup lee y escribe los filtros con claves por notebook
// (studyTypes:<id> / sourceTypes:<id>), consistente con content.js, y que usa
// las etiquetas en español. Antes el popup usaba claves globales, lo cual
// quedaba desincronizado con content.js tras el aislamiento por notebook.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const POPUP_SRC = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');

function buildPopupDom(store, tabUrl, availableResponse) {
  const html = `<!doctype html><html><body>
    <div id="status"></div>
    <div id="studyTypes"></div>
    <div id="sourceTypes"></div>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://notebooklm.google.com/popup.html' });
  const window = dom.window;
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '0.0.0-test' }),
      lastError: null,
      sendMessage: (_msg, cb) => { cb(availableResponse); },
    },
    tabs: { query: (_q, cb) => { cb([{ id: 1, url: tabUrl }]); } },
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

function loadPopup(dom) {
  vm.createContext(dom.window);
  vm.runInContext(POPUP_SRC, dom.window, { filename: 'popup.js' });
  // jsdom ya disparo DOMContentLoaded al construir; lo redispatchamos para
  // que el listener registrado por popup.js se ejecute.
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom.window;
}

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

test('el popup lee los filtros con claves por notebook y usa etiquetas en español', async () => {
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const tabUrl = 'https://notebooklm.google.com/notebook/' + id;
  const store = { ['studyTypes:' + id]: { quiz: true } };
  const window = loadPopup(buildPopupDom(store, tabUrl, { sources: [{ src: 'T063', display: '063' }], studyTypes: ['quiz', 'audio'] }));

  await tick(60);

  const quizBtn = Array.from(window.document.querySelectorAll('button[data-study]'))
    .find((b) => b.getAttribute('data-study') === 'quiz');
  assert.ok(quizBtn, 'debe renderizar el chip Test');
  assert.equal(quizBtn.getAttribute('aria-pressed'), 'true',
    'el popup debe reflejar el filtro guardado por notebook (quiz activo)');
  assert.equal(quizBtn.textContent, 'Test',
    'el chip debe usar la etiqueta en español (Test), no el identificador interno (quiz)');
});

test('el popup escribe los filtros con claves por notebook al hacer clic', async () => {
  const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const tabUrl = 'https://notebooklm.google.com/notebook/' + id;
  const store = {};
  const window = loadPopup(buildPopupDom(store, tabUrl, { sources: [], studyTypes: ['audio'] }));

  await tick(60);
  const audioBtn = Array.from(window.document.querySelectorAll('button[data-study]'))
    .find((b) => b.getAttribute('data-study') === 'audio');
  assert.ok(audioBtn, 'debe renderizar el chip Audio');
  audioBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(60);

  const saved = store['studyTypes:' + id];
  assert.ok(saved, 'el popup debe guardar con clave por notebook (studyTypes:<id>)');
  assert.equal(saved.audio, true, 'el filtro Audio debe quedar guardado para ese notebook');
});

test('el popup no hereda filtros de otro notebook (aislamiento)', async () => {
  const idB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const tabUrl = 'https://notebooklm.google.com/notebook/' + idB;
  // El store tiene un filtro guardado para OTRO notebook (A); el popup (en B)
  // no debe heredarlo.
  const store = { 'studyTypes:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': { quiz: true } };
  const window = loadPopup(buildPopupDom(store, tabUrl, { sources: [], studyTypes: ['quiz', 'audio'] }));

  await tick(60);
  const quizBtn = Array.from(window.document.querySelectorAll('button[data-study]'))
    .find((b) => b.getAttribute('data-study') === 'quiz');
  assert.equal(quizBtn.getAttribute('aria-pressed'), 'false',
    'el popup en el notebook B no debe heredar el filtro guardado en el notebook A');
});
