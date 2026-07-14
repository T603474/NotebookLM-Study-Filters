(function () {
  if (window.__nlFilterPageBridgeInstalled) return;
  window.__nlFilterPageBridgeInstalled = true;

  const core = window.NotebookFilterCore;
  if (!core) return;
  let metadataSnapshot = { sources: [], artifacts: [] };

  function emitMetadata(responseText) {
    const parsed = core.parseNotebookBatchResponse(responseText);
    if (!parsed.artifacts.length && !parsed.sources.size) return;
    metadataSnapshot = core.mergeMetadataSnapshot(metadataSnapshot, {
      artifacts: parsed.artifacts,
      sources: Array.from(parsed.sources.entries()),
    });

    const root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-nl-filter-api-payload', JSON.stringify(metadataSnapshot));
    root.dispatchEvent(new Event('nl-filter-api-metadata', { bubbles: true }));
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (url && url.includes('batchexecute')) {
        response.clone().text().then(emitMetadata).catch(() => {});
      }
    } catch {}
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__nlFilterUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (this.__nlFilterUrl && String(this.__nlFilterUrl).includes('batchexecute')) {
          emitMetadata(this.responseText);
        }
      } catch {}
    });
    return originalSend.apply(this, args);
  };
})();
