document.addEventListener('DOMContentLoaded', () => {
  const chromeApi = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome : null;
  const studyContainer = document.getElementById('studyTypes');
  const sourceContainer = document.getElementById('sourceTypes');
  const statusEl = document.getElementById('status');

  if (!studyContainer || !sourceContainer) return;

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
        btn.textContent = type.charAt(0).toUpperCase() + type.slice(1);
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
    return new Promise((resolve) => {
      chromeApi.storage.local.set(obj, resolve);
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
        resolve(tabs && tabs[0] ? tabs[0] : null);
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
    return new Promise((resolve) => {
      chromeApi.storage.local.get(['studyTypes', 'sourceTypes'], (result) => resolve({
        studyTypes: result.studyTypes || {},
        sourceTypes: result.sourceTypes || {},
      }));
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
