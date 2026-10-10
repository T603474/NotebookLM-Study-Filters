// === Spike S1 (hito 2): de donde salen los nombres de fuente ===
// Solo lectura: no modifica la pagina, no hace peticiones, no envia nada.
// Uso: abre DevTools en la pestana de Gemini Notebook, contexto "top" (el
// predeterminado, NO el de la extension), pega este fichero en la consola y
// pulsa Intro. El resultado se imprime y se copia al portapapeles
// (copy()); pegalo en el chat. Los nombres de fuente se sustituyen por su
// longitud; los valores de atributos se truncan a 40 caracteres, revisalos
// antes de pegar si algun atributo contuviera datos que no quieras compartir.
(function () {
  const SHOW_NAMES = false;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const FILE = /\.(md|pdf|txt|docx|pptx|csv|png|jpg)\b/i;
  const mask = (s) => (SHOW_NAMES ? s : '<' + String(s).trim().length + ' car.>');

  function classOf(el) {
    const c = el.className;
    return String((c && c.baseVal !== undefined) ? c.baseVal : (c || '')).slice(0, 120);
  }

  function describe(el) {
    return {
      tag: el.tagName.toLowerCase(),
      class: classOf(el),
      attrs: Array.from(el.attributes)
        .filter((a) => a.name !== 'class' && a.name !== 'style')
        .map((a) => {
          const hasUuid = UUID.test(a.value);
          const value = hasUuid
            ? a.value.replace(UUID, (m) => m.slice(0, 8) + '...')
            : (a.value.length > 40 ? a.value.slice(0, 40) + '...' : a.value);
          return { name: a.name, uuid: hasUuid, value };
        }),
    };
  }

  function chain(el, levels) {
    const out = [];
    for (let i = 0; el && i < levels; i += 1, el = el.parentElement) out.push(describe(el));
    return out;
  }

  // 1) Llamadas batchexecute ya realizadas (solo el rpcid de la URL, sin cuerpo).
  const rpcCounts = {};
  performance.getEntriesByType('resource')
    .filter((e) => e.name.includes('batchexecute'))
    .forEach((e) => {
      let id = '(sin rpcids)';
      try { id = new URL(e.name).searchParams.get('rpcids') || id; } catch (err) { /* url rara */ }
      rpcCounts[id] = (rpcCounts[id] || 0) + 1;
    });

  // 2) Filas del panel Fuentes: hojas de texto que parecen nombre de fichero.
  const leaves = Array.from(document.querySelectorAll('body *')).filter((el) => (
    el.children.length === 0
    && !el.closest('#nl-filter-panel')
    && FILE.test(el.textContent || '')
    && (el.textContent || '').trim().length < 200
  ));
  const sourceRows = leaves.slice(0, 2).map((el) => ({
    text: mask(el.textContent),
    chain: chain(el, 8),
  }));

  // 3) Casillas de seleccion (para la accion "marcar en chat" del hito 3).
  const checkboxCount = document.querySelectorAll('input[type=checkbox], [role=checkbox], mat-checkbox').length;

  // 4) Atributos con UUID dentro de los dos primeros elementos de estudio.
  const artifactIds = Array.from(document.querySelectorAll('artifact-library-item')).slice(0, 2).map((item) => {
    const found = [];
    [item, ...item.querySelectorAll('*')].forEach((el) => {
      Array.from(el.attributes).forEach((a) => {
        if (UUID.test(a.value) && found.length < 10) {
          found.push({ element: el.tagName.toLowerCase() + '.' + classOf(el).split(' ')[0], attr: a.name });
        }
      });
    });
    return { totalAttrsWithUuid: found.length, found };
  });

  const result = {
    url: location.hostname + location.pathname.replace(/[0-9a-f-]{36}/i, '<notebook-id>'),
    rpcCounts,
    // Registro del puente (v1.2.3+): que rpcids ha parseado la extension y
    // cuantas fuentes/artefactos aporto cada uno.
    bridgeRpcLog: window.__nlFilterRpcLog || null,
    filenameLeaves: leaves.length,
    sourceRows,
    checkboxCount,
    artifactItems: document.querySelectorAll('artifact-library-item').length,
    artifactIds,
  };
  const text = JSON.stringify(result, null, 1);
  console.log(text);
  if (typeof copy === 'function') copy(text);
  return result;
})();
