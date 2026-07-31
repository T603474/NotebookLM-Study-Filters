const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, 'site-access.js'), 'utf8');
const sandbox = { globalThis: {}, URL: globalThis.URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'site-access.js' });
const SA = sandbox.globalThis.NotebookSiteAccess;

test('isNotebookHost acepta ambos hosts de producto', () => {
  assert.equal(SA.isNotebookHost('notebook.google.com'), true);
  assert.equal(SA.isNotebookHost('notebooklm.google.com'), true);
  assert.equal(SA.isNotebookHost('accounts.google.com'), false);
});

test('isNotebookUrl acepta URLs de ambos hosts', () => {
  assert.equal(SA.isNotebookUrl('https://notebook.google.com/notebook/abc'), true);
  assert.equal(SA.isNotebookUrl('https://notebooklm.google.com/notebook/abc'), true);
  assert.equal(SA.isNotebookUrl('https://accounts.google.com/'), false);
});

test('normalizeHostPattern acepta host, URL y patrón y rechaza inválidos', () => {
  assert.equal(SA.normalizeHostPattern('notebooklm.cloud.google.com'), 'https://notebooklm.cloud.google.com/*');
  assert.equal(SA.normalizeHostPattern('https://foo.example.com/path'), 'https://foo.example.com/*');
  assert.equal(SA.normalizeHostPattern('https://foo.example.com/*'), 'https://foo.example.com/*');
  assert.equal(SA.normalizeHostPattern('http://insecure.example.com'), null);
  assert.equal(SA.normalizeHostPattern(''), null);
  assert.equal(SA.normalizeHostPattern('*://*.google.com/*'), null);
});

test('isPresetOrigin reconoce los tres presets', () => {
  assert.equal(SA.isPresetOrigin('https://notebook.google.com/*'), true);
  assert.equal(SA.isPresetOrigin('https://notebooklm.google.com/*'), true);
  assert.equal(SA.isPresetOrigin('https://accounts.google.com/*'), true);
  assert.equal(SA.isPresetOrigin('https://notebooklm.cloud.google.com/*'), false);
});
