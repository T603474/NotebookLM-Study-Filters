(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotebookFilterCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function isUuid(value) {
    return typeof value === 'string' && UUID_PATTERN.test(value);
  }

  function normalizeSourceQuery(raw) {
    if (raw === null || raw === undefined) return '';
    const match = String(raw).trim().toUpperCase().match(/(?:^|\bT?)0*(\d{2,3})(?=\D|$)/);
    return match ? 'T' + match[1].padStart(3, '0') : '';
  }

  function sourceKeyFromTitle(title) {
    if (!title) return '';
    const match = String(title).match(/(?:^|\s|T?)0*(\d{2,3})(?:\.md)?\b/i);
    return match ? normalizeSourceQuery(match[1]) : '';
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[_-]+/g, ' ')
      .toLowerCase()
      .trim();
  }

  function matchesSourceQuery(sourceKeys, query, sourceNames) {
    const raw = String(query || '').trim();
    if (!raw) return true;
    const normalized = normalizeSourceQuery(raw);
    const matchesKey = normalized
      && Array.from(sourceKeys || []).some((key) => normalizeSourceQuery(key) === normalized);
    const textQuery = normalizeText(raw);
    const matchesName = Array.from(sourceNames || [])
      .some((name) => normalizeText(name).includes(textQuery));
    return Boolean(matchesKey || matchesName);
  }

  function artifactMatchesFilters(artifact, filters) {
    const activeTypes = filters.activeTypes || [];
    const activeSources = filters.activeSources || [];
    const sourceKeys = artifact.sourceKeys || new Set();
    const sourceNames = artifact.sourceNames || [];
    const matchesType = activeTypes.length === 0
      || activeTypes.includes('__all__')
      || activeTypes.includes(artifact.kind);
    const matchesSelectedSource = activeSources.length === 0
      || activeSources.some((source) => matchesSourceQuery(sourceKeys, source, sourceNames));
    const matchesTypedSource = matchesSourceQuery(sourceKeys, filters.sourceQuery || '', sourceNames);
    return matchesType && matchesSelectedSource && matchesTypedSource;
  }

  function extractUuids(node, found) {
    const result = found || new Set();
    if (typeof node === 'string') {
      if (isUuid(node)) result.add(node);
      return result;
    }
    if (Array.isArray(node)) node.forEach((entry) => extractUuids(entry, result));
    return result;
  }

  function isArtifactRow(row) {
    return Array.isArray(row)
      && row.length >= 5
      && isUuid(row[0])
      && typeof row[1] === 'string'
      && Number.isInteger(row[2])
      && row[2] >= 1
      && row[2] <= 9;
  }

  function sourceTitleFromRow(row) {
    if (!Array.isArray(row) || !isUuid(row[0])) return '';
    const candidates = [];
    function collect(node) {
      if (typeof node === 'string') {
        if (!isUuid(node) && !parseJsonCandidate(node)) candidates.push(node.trim());
        return;
      }
      if (Array.isArray(node)) node.forEach(collect);
    }
    row.slice(1).forEach(collect);
    return candidates.find((value) => sourceKeyFromTitle(value))
      || candidates.find((value) => /\.[a-z0-9]{2,5}$/i.test(value))
      || candidates.find(Boolean)
      || '';
  }

  function isSourceRow(row) {
    return Array.isArray(row)
      && row.length >= 2
      && isUuid(row[0])
      && Boolean(sourceTitleFromRow(row))
      && !isArtifactRow(row);
  }

  function parseJsonCandidate(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || !['[', '{'].includes(trimmed[0])) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  function parseNotebookBatchResponse(text) {
    const sources = new Map();
    const artifacts = [];
    const seenArtifacts = new Set();

    function visit(node) {
      if (typeof node === 'string') {
        const nested = parseJsonCandidate(node);
        if (nested) visit(nested);
        return;
      }
      if (!Array.isArray(node)) {
        if (node && typeof node === 'object') Object.values(node).forEach(visit);
        return;
      }
      if (isArtifactRow(node)) {
        if (!seenArtifacts.has(node[0])) {
          seenArtifacts.add(node[0]);
          artifacts.push({
            id: node[0],
            title: node[1],
            typeCode: node[2],
            sourceIds: Array.from(extractUuids(node.slice(3)))
              .filter((sourceId) => sourceId !== node[0]),
          });
        }
        return;
      }
      if (isSourceRow(node)) sources.set(node[0], sourceTitleFromRow(node));
      node.forEach(visit);
    }

    String(text || '')
      .replace(/^\)\]\}'\s*/, '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('[') || line.startsWith('{'))
      .forEach((line) => {
        const parsed = parseJsonCandidate(line);
        if (parsed) visit(parsed);
      });

    return { sources, artifacts };
  }

  function buildArtifactSourceOptions(artifacts, sourcesById) {
    const options = new Map();
    for (const artifact of artifacts || []) {
      for (const sourceId of artifact.sourceIds || []) {
        const key = sourceKeyFromTitle(sourcesById.get(sourceId));
        if (key) options.set(key, key.replace(/^T/, ''));
      }
    }
    return Array.from(options.entries())
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true }))
      .map(([src, display]) => ({ src, display }));
  }

  function mergeMetadataSnapshot(current, incoming) {
    const sourceMap = new Map(current?.sources || []);
    const artifactMap = new Map(
      (current?.artifacts || []).map((artifact) => [artifact.id, artifact])
    );
    for (const [sourceId, title] of incoming?.sources || []) {
      sourceMap.set(sourceId, title);
    }
    for (const artifact of incoming?.artifacts || []) {
      if (artifact?.id) artifactMap.set(artifact.id, artifact);
    }
    return {
      sources: Array.from(sourceMap.entries()),
      artifacts: Array.from(artifactMap.values()),
    };
  }

  return {
    isUuid,
    normalizeSourceQuery,
    sourceKeyFromTitle,
    matchesSourceQuery,
    artifactMatchesFilters,
    parseNotebookBatchResponse,
    buildArtifactSourceOptions,
    mergeMetadataSnapshot,
  };
});
