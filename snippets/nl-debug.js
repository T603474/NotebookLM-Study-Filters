// === NotebookLM Filter Debugger ===
(function() {
  if (typeof window.__nlFilterDebug === 'function') {
    window.__nlFilterDebug();
  } else {
    console.log('[NL] __nlFilterDebug no disponible (¿estas en el contexto "top" en vez del de la extension?).');
  }
  const panel = (typeof findStudioPanel === 'function') ? findStudioPanel() : document.querySelector('.panel-content-scrollable');
  if (!panel) {
    console.log('[NL] Panel Studio no encontrado en DOM.');
    return;
  }
  if (typeof refreshArtifactMetadata === 'function') refreshArtifactMetadata();
  const items = Array.from(panel.querySelectorAll('artifact-library-item'));
  const rows = items.map((item, idx) => ({
    idx,
    title: (typeof getTitle === 'function') ? getTitle(item) : '',
    details: (typeof getDetails === 'function') ? getDetails(item) : '',
    kind: (typeof getArtifactKind === 'function') ? getArtifactKind(item) : '',
    sources: (typeof getArtifactSourceKeys === 'function') ? Array.from(getArtifactSourceKeys(item)).join(', ') : '',
    icons: Array.from(item.querySelectorAll('mat-icon')).map((el) => el.textContent.trim()).join(', '),
    artifactId: item.dataset.nlArtifactId || '',
  }));
  console.table(rows);
  console.log('[NL] Artefactos totales:', rows.length);
})();
