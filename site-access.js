(function (global) {
  const NOTEBOOK_HOSTS = ['notebook.google.com', 'notebooklm.google.com'];
  const PRESET_ORIGINS = [
    'https://notebook.google.com/*',
    'https://notebooklm.google.com/*',
    'https://accounts.google.com/*',
  ];
  const STORAGE_SITE_ACCESS_PROMPTED = 'siteAccessPrompted';
  const STORAGE_CUSTOM_HOST_PATTERNS = 'customHostPatterns';

  function isNotebookHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return NOTEBOOK_HOSTS.includes(host);
  }

  function isNotebookUrl(url) {
    try {
      return isNotebookHost(new URL(String(url || '')).hostname);
    } catch (_) {
      return false;
    }
  }

  function isPresetOrigin(originPattern) {
    return PRESET_ORIGINS.includes(String(originPattern || ''));
  }

  function normalizeHostPattern(raw) {
    const input = String(raw || '').trim();
    if (!input) return null;
    if (input.includes('*') && !/^https:\/\/[^*/]+\/\*$/i.test(input)) return null;
    let urlString = input;
    if (!/^https?:\/\//i.test(urlString)) urlString = 'https://' + urlString;
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch (_) {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.hostname || parsed.hostname.includes('*')) return null;
    return 'https://' + parsed.hostname.toLowerCase() + '/*';
  }

  global.NotebookSiteAccess = {
    NOTEBOOK_HOSTS,
    PRESET_ORIGINS,
    STORAGE_SITE_ACCESS_PROMPTED,
    STORAGE_CUSTOM_HOST_PATTERNS,
    isNotebookHost,
    isNotebookUrl,
    isPresetOrigin,
    normalizeHostPattern,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
