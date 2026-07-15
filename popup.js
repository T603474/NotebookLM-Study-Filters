document.addEventListener('DOMContentLoaded', () => {
  const chromeApi = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome : null;
  const studyContainer = document.getElementById('studyTypes');
  const sourceContainer = document.getElementById('sourceTypes');
  const statusEl = document.getElementById('status');

  if (!studyContainer || !sourceContainer) return;

  // Mismimas etiquetas y claves por notebook que content.js, para que el
  // popup y el panel in-page persistan y lean el mismo estado. Antes el popup
  // usaba claves globales (studyTypes/sourceTypes), que tras el aislamiento
  // por notebook de content.js quedaban desincronizadas.
  const NOTEBOOK_ID_REGEX = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const TYPE_LABELS = {
    audio: 'Audio', briefing: 'Briefing', cards: 'Tarjetas', datatable: 'Tabla de datos',
    guide: 'Guía', infographic: 'Infografía', map: 'Mapa', presentation: 'Presentación',
    quiz: 'Test', report: 'Informes', video: 'Vídeo', other: 'Otro',
  };
  const typeLabel = (t) => TYPE_LABELS[t] || (t.charAt(0).toUpperCase() + t.slice(1));
  const notebookIdFromUrl = (url) => {
    const m = String(url || '').match(NOTEBOOK_ID_REGEX);
    return m ? m[0].slice(1) : '';
  };
  let currentNotebookId = '';

  const setStatus = (message) => {
    if (statusEl) statusEl.textContent = message;
  };

  const isNotebookTab = (tab) => !!(tab && tab.url && tab.url.includes('notebooklm.google.com'));

  studyContainer.textContent = 'Carga NotebookLM...';
  sourceContainer.textContent = '';
  setStatus('Cargando...');

  const render = (data, activeStudy, activeSource) => {
    studyContainer.innerHTML = '';
    sourceContainer.innerHTML = '';

    if (!Array.isArray(data.studyTypes) || !data.studyTypes.length) {
      studyContainer.textContent = 'Sin tipos';
    } else {
      data.studyTypes.forEach((type) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = typeLabel(type);
        btn.setAttribute('data-study', type);
        btn.setAttribute('aria-pressed', activeStudy[type] ? 'true' : 'false');
        btn.addEventListener('click', async () => {
          const next = !(btn.getAttribute('aria-pressed') === 'true');
          btn.setAttribute('aria-pressed', next ? 'true' : 'false');
          const updated = {};
          studyContainer.querySelectorAll('button[data-study]').forEach((b) => {
            const k = b.getAttribute('data-study') || b.textContent.trim().toLowerCase();
            updated[k] = b.getAttribute('aria-pressed') === 'true';
          });
          const srcUpdated = {};
          sourceContainer.querySelectorAll('button[data-source]').forEach((b) => {
            const k = b.getAttribute('data-source');
            if (!k) return;
            srcUpdated[k] = b.getAttribute('aria-pressed') === 'true';
          });
          await save({ studyTypes: updated, sourceTypes: srcUpdated });
          applyToActiveTab(updated, srcUpdated);
        });
        studyContainer.appendChild(btn);
      });
    }

    if (!Array.isArray(data.sources) || !data.sources.length) {
      sourceContainer.textContent = 'Sin fuentes';
    } else {
      data.sources.forEach((entry) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const src = typeof entry === 'string' ? entry : entry.src;
        const display = typeof entry === 'object' && entry && entry.display ? entry.display : src.replace(/^T/i, '');
        btn.textContent = display;
        btn.setAttribute('data-source', src);
        btn.setAttribute('aria-pressed', activeSource[src] ? 'true' : 'false');
        btn.addEventListener('click', async () => {
          const next = !(btn.getAttribute('aria-pressed') === 'true');
          btn.setAttribute('aria-pressed', next ? 'true' : 'false');
          const updated = {};
          studyContainer.querySelectorAll('button[data-study]').forEach((b) => {
            const k = b.getAttribute('data-study') || b.textContent.trim().toLowerCase();
            updated[k] = b.getAttribute('aria-pressed') === 'true';
          });
          const srcUpdated = {};
          sourceContainer.querySelectorAll('button[data-source]').forEach((b) => {
            const k = b.getAttribute('data-source');
            if (!k) return;
            srcUpdated[k] = b.getAttribute('aria-pressed') === 'true';
          });
          await save({ studyTypes: updated, sourceTypes: srcUpdated });
          applyToActiveTab(updated, srcUpdated);
        });
        sourceContainer.appendChild(btn);
      });
    }

    setStatus('Filtro activo');
  };

  const save = (obj) => {
    if (!chromeApi) return Promise.resolve();
    const id = currentNotebookId;
    const payload = {};
    payload['studyTypes' + (id ? ':' + id : '')] = obj.studyTypes || {};
    payload['sourceTypes' + (id ? ':' + id : '')] = obj.sourceTypes || {};
    return new Promise((resolve) => {
      chromeApi.storage.local.set(payload, resolve);
    });
  };

  const getActiveTab = () => {
    return new Promise((resolve) => {
      if (!chromeApi || !chromeApi.tabs) {
        resolve(null);
        return;
      }
      chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chromeApi.runtime.lastError) {
          resolve(null);
          return;
        }
        const tab = tabs && tabs[0] ? tabs[0] : null;
        if (tab && tab.url) currentNotebookId = notebookIdFromUrl(tab.url);
        resolve(tab);
      });
    });
  };

  const applyToActiveTab = async (studyFilter, sourceFilter) => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus('No se encontró la pestaña activa');
      return;
    }
    if (!isNotebookTab(tab)) {
      setStatus('Abre un notebook en NotebookLM');
      return;
    }
    return new Promise((resolve) => {
      chromeApi.runtime.sendMessage(
        { type: 'forward-to-tab', tabId: tab.id, payload: { type: 'nl-apply', studyFilter, sourceFilter } },
        () => {
          if (chromeApi.runtime.lastError) {
            setStatus('No se pudo aplicar el filtro en la pestaña');
          }
          resolve();
        }
      );
    });
  };

  const load = () => {
    if (!chromeApi) return Promise.resolve({ studyTypes: {}, sourceTypes: {} });
    const id = currentNotebookId;
    const studyKey = 'studyTypes' + (id ? ':' + id : '');
    const sourceKey = 'sourceTypes' + (id ? ':' + id : '');
    return new Promise((resolve) => {
      chromeApi.storage.local.get([studyKey, sourceKey, 'studyTypes', 'sourceTypes'], (result) => {
        let study = result[studyKey];
        let source = result[sourceKey];
        // Migracion legacy: si no hay clave por notebook, leer la global.
        if (study === undefined) study = result.studyTypes || {};
        if (source === undefined) source = result.sourceTypes || {};
        resolve({ studyTypes: study || {}, sourceTypes: source || {} });
      });
    });
  };

  const fetchAvailable = async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      setStatus('No se encontró la pestaña activa');
      return { sources: [], studyTypes: [] };
    }
    if (!isNotebookTab(tab)) {
      setStatus('Abre un notebook en NotebookLM');
      return { sources: [], studyTypes: [] };
    }
    return new Promise((resolve) => {
      chromeApi.runtime.sendMessage(
        { type: 'forward-to-tab', tabId: tab.id, payload: { type: 'nl-get-available-sources' } },
        (response) => {
          if (chromeApi.runtime.lastError) {
            setStatus('No se pudo conectar con NotebookLM');
            resolve({ sources: [], studyTypes: [] });
            return;
          }
          resolve(response || { sources: [], studyTypes: [] });
        }
      );
    });
  };

  Promise.resolve()
    .then(() => getActiveTab())
    .then(() => load())
    .then((stored) =>
      fetchAvailable().then((available) => ({ stored, available }))
    )
    .then(({ stored, available }) =>
      render(available, stored.studyTypes, stored.sourceTypes)
    )
    .catch(() => {
      setStatus('Error al cargar el filtro');
      studyContainer.textContent = 'Error';
      sourceContainer.textContent = '';
    });
});
