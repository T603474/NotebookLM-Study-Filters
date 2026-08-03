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
const SITE_ACCESS_SRC = fs.readFileSync(path.join(__dirname, 'site-access.js'), 'utf8');

function buildPopupDom(store, tabUrl, availableResponse) {
  const html = `<!doctype html><html><body>
    <div id="status"></div>
    <div id="studyTypes"></div>
    <div id="sourceTypes"></div>
    <div id="siteAccessStatus"></div>
    <div id="siteAccessPresets"></div>
    <div id="siteAccessCustom"></div>
    <input id="siteAccessInput" type="text">
    <button type="button" id="siteAccessAdd">Añadir</button>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'https://notebooklm.google.com/popup.html' });
  const window = dom.window;
  const grantedOrigins = new Set();
  const requestCalls = [];
  const sentMessages = [];
  window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.chrome = {
    runtime: {
      id: 'test-extension-id',
      getManifest: () => ({ version: '0.0.0-test' }),
      lastError: null,
      sendMessage: (msg, cb) => {
        sentMessages.push(msg);
        if (cb) cb(msg.type === 'forward-to-tab' ? availableResponse : { ok: true });
      },
    },
    tabs: { query: (_q, cb) => { cb([{ id: 1, url: tabUrl }]); } },
    permissions: {
      contains: ({ origins }, cb) => cb(origins.every((origin) => grantedOrigins.has(origin))),
      request: ({ origins }, cb) => {
        requestCalls.push(origins.slice());
        origins.forEach((origin) => grantedOrigins.add(origin));
        cb(true);
      },
      remove: ({ origins }, cb) => {
        const removed = origins.every((origin) => grantedOrigins.has(origin));
        origins.forEach((origin) => grantedOrigins.delete(origin));
        cb(removed);
      },
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          const requested = keys == null
            ? Object.keys(store)
            : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
          requested.forEach((k) => {
            if (k in store) out[k] = store[k];
            else if (keys && typeof keys === 'object' && !Array.isArray(keys)) out[k] = keys[k];
          });
          cb(out);
        },
        set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
      },
    },
  };
  window.__popupTest = { grantedOrigins, requestCalls, sentMessages };
  return dom;
}

function loadPopup(dom) {
  vm.createContext(dom.window);
  vm.runInContext(SITE_ACCESS_SRC, dom.window, { filename: 'site-access.js' });
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

test('al primer open del popup pide los tres presets y marca siteAccessPrompted', async () => {
  const store = {};
  const window = loadPopup(buildPopupDom(
    store,
    'https://notebooklm.google.com/notebook/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    { sources: [], studyTypes: [] }
  ));

  await tick(60);

  assert.deepEqual(
    Array.from(window.__popupTest.requestCalls[0] || []),
    [
      'https://notebook.google.com/*',
      'https://notebooklm.google.com/*',
      'https://accounts.google.com/*',
    ]
  );
  assert.equal(store.siteAccessPrompted, true);
});

test('isNotebookTab acepta notebook.google.com', async () => {
  const store = { siteAccessPrompted: true };
  const window = loadPopup(buildPopupDom(
    store,
    'https://notebook.google.com/notebook/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    { sources: [], studyTypes: ['quiz'] }
  ));

  await tick(60);

  assert.notEqual(window.document.getElementById('status').textContent, 'Abre un notebook en Gemini Notebook');
  assert.ok(window.document.querySelector('button[data-study="quiz"]'));
});

test('normalize + Añadir guarda customHostPatterns y llama sync-custom-scripts', async () => {
  const store = { siteAccessPrompted: true };
  const window = loadPopup(buildPopupDom(
    store,
    'https://notebook.google.com/notebook/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    { sources: [], studyTypes: [] }
  ));

  await tick(60);
  const input = window.document.getElementById('siteAccessInput');
  input.value = 'Ejemplo.COM';
  window.document.getElementById('siteAccessAdd')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(60);

  assert.deepEqual(Array.from(store.customHostPatterns || []), ['https://ejemplo.com/*']);
  assert.ok(window.__popupTest.sentMessages.some((msg) => msg.type === 'sync-custom-scripts'));
});

test('un fallo sincrono al conceder permiso (add-handler) muestra un mensaje en vez de fallar en silencio', async () => {
  // Revision final v1.1.0 (Important 5): chrome.permissions.request() puede
  // lanzar de forma sincrona en el navegador real (p. ej. "may only be
  // called from a user gesture" o contexto invalidado). Antes, eso dejaba
  // una promesa rechazada sin manejar dentro del listener async del boton
  // "Añadir": el usuario no recibia ningun mensaje ("permission failures
  // silent"). Forzamos ese throw y comprobamos que ahora se informa.
  const store = { siteAccessPrompted: true };
  const window = loadPopup(buildPopupDom(
    store,
    'https://notebook.google.com/notebook/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    { sources: [], studyTypes: [] }
  ));

  await tick(60);
  window.chrome.permissions.request = () => {
    throw new Error('Permissions.request may only be called from a user gesture');
  };

  const input = window.document.getElementById('siteAccessInput');
  input.value = 'otroejemplo.com';
  window.document.getElementById('siteAccessAdd')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(60);

  assert.equal(
    window.document.getElementById('siteAccessStatus').textContent,
    'No se pudo conceder el acceso',
    'un fallo sincrono al conceder el permiso debe mostrarse al usuario, no fallar en silencio'
  );
  assert.deepEqual(Array.from(store.customHostPatterns || []), [],
    'no debe guardarse el host si no se pudo conceder el permiso');
});

test('Quitar elimina un custom sin permiso y llama sync-custom-scripts', async () => {
  const origin = 'https://ejemplo.com/*';
  const store = { siteAccessPrompted: true, customHostPatterns: [origin] };
  const dom = buildPopupDom(
    store,
    'https://notebook.google.com/notebook/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    { sources: [], studyTypes: [] }
  );
  const window = loadPopup(dom);

  await tick(60);
  const removeButton = window.document
    .querySelector(`[data-custom-origin="${origin}"] button`);
  assert.ok(removeButton, 'debe renderizar el custom guardado');
  removeButton.dispatchEvent(new window.Event('click', { bubbles: true }));
  await tick(60);

  assert.deepEqual(Array.from(store.customHostPatterns || []), []);
  assert.ok(window.__popupTest.sentMessages.some((msg) => msg.type === 'sync-custom-scripts'));
});
