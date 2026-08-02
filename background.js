importScripts('site-access.js');

const SA = self.NotebookSiteAccess;
const CUSTOM_KEY = SA.STORAGE_CUSTOM_HOST_PATTERNS;

function hostnameFromPattern(pattern) {
  try {
    return new URL(String(pattern).replace(/\*\s*$/, '')).hostname;
  } catch (_) {
    return '';
  }
}

async function getCustomPatterns() {
  const data = await chrome.storage.local.get(CUSTOM_KEY);
  const list = data[CUSTOM_KEY];
  return Array.isArray(list) ? list : [];
}

async function setCustomPatterns(patterns) {
  await chrome.storage.local.set({ [CUSTOM_KEY]: patterns });
}

async function registerPair(originPattern) {
  if (SA.isPresetOrigin(originPattern)) return;
  const host = hostnameFromPattern(originPattern);
  if (!host) return;
  const matches = [originPattern];
  const mainId = 'nl-filter-main-' + host;
  const isoId = 'nl-filter-isolated-' + host;
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [mainId, isoId] });
  } catch (_) { /* no registrados aún */ }
  await chrome.scripting.registerContentScripts([
    {
      id: mainId,
      matches,
      js: ['filter-core.js', 'page-bridge.js'],
      runAt: 'document_start',
      world: 'MAIN',
      persistAcrossSessions: true,
    },
    {
      id: isoId,
      matches,
      js: ['site-access.js', 'filter-core.js', 'content.js'],
      runAt: 'document_start',
      world: 'ISOLATED',
      persistAcrossSessions: true,
    },
  ]);
}

async function unregisterPair(originPattern) {
  const host = hostnameFromPattern(originPattern);
  if (!host) return;
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: ['nl-filter-main-' + host, 'nl-filter-isolated-' + host],
    });
  } catch (_) { /* ok */ }
}

async function syncCustomContentScripts() {
  const stored = await getCustomPatterns();
  const granted = [];
  for (const pattern of stored) {
    if (SA.isPresetOrigin(pattern)) continue;
    const ok = await chrome.permissions.contains({ origins: [pattern] });
    if (ok) {
      granted.push(pattern);
      await registerPair(pattern);
    } else {
      await unregisterPair(pattern);
    }
  }
  await setCustomPatterns(granted);

  // Desregistrar scripts de hosts que ya no están en la lista
  let registered = [];
  try {
    registered = await chrome.scripting.getRegisteredContentScripts();
  } catch (_) {
    registered = [];
  }
  const keepHosts = new Set(granted.map(hostnameFromPattern));
  const staleIds = registered
    .filter((s) => String(s.id || '').startsWith('nl-filter-'))
    .filter((s) => {
      const host = String(s.id).replace(/^nl-filter-(main|isolated)-/, '');
      return !keepHosts.has(host);
    })
    .map((s) => s.id);
  if (staleIds.length) {
    try {
      await chrome.scripting.unregisterContentScripts({ ids: staleIds });
    } catch (_) { /* ok */ }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  syncCustomContentScripts().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  syncCustomContentScripts().catch(() => {});
});

if (chrome.permissions && chrome.permissions.onAdded) {
  chrome.permissions.onAdded.addListener(() => {
    syncCustomContentScripts().catch(() => {});
  });
  chrome.permissions.onRemoved.addListener(() => {
    syncCustomContentScripts().catch(() => {});
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'sync-custom-scripts') {
    syncCustomContentScripts()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
    return true;
  }

  if (message.type === 'forward-to-tab') {
    const { tabId, payload } = message;
    if (!tabId || !payload) return false;
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      sendResponse(response);
    });
    return true;
  }

  return false;
});

syncCustomContentScripts().catch(() => {});
