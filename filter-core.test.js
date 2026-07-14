const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSourceQuery,
  matchesSourceQuery,
  parseNotebookBatchResponse,
  buildArtifactSourceOptions,
  artifactMatchesFilters,
  mergeMetadataSnapshot,
} = require('./filter-core');

test('a source query with trailing punctuation does not match everything', () => {
  assert.equal(normalizeSourceQuery('047.'), 'T047');
  assert.equal(matchesSourceQuery(new Set(['T047']), '047.'), true);
  assert.equal(matchesSourceQuery(new Set(['T048']), '047.'), false);
});

test('source options include only sources referenced by artifacts', () => {
  const source047 = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const source050 = 'f367ac42-72b7-4153-a866-14e1c1907b32';
  const sources = new Map([
    [source047, '047.md'],
    [source050, '050.md'],
  ]);
  const artifacts = [
    {
      id: '69fc428b-94a6-4355-af48-eb6c56699ab6',
      typeCode: 1,
      sourceIds: [source047],
    },
  ];

  assert.deepEqual(buildArtifactSourceOptions(artifacts, sources), [
    { src: 'T047', display: '047' },
  ]);
});

test('parses nested batchexecute payloads into source and artifact metadata', () => {
  const sourceId = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const artifactId = '69fc428b-94a6-4355-af48-eb6c56699ab6';
  const rpcPayload = JSON.stringify([
    [[sourceId, '047.md', 1]],
    [[artifactId, 'Título renombrado', 1, [[[sourceId]]], 3]],
  ]);
  const response = `)]}'\n\n123\n${JSON.stringify([
    ['wrb.fr', 'gArtLc', rpcPayload, null, null, null, 'generic'],
  ])}`;

  const parsed = parseNotebookBatchResponse(response);

  assert.equal(parsed.sources.get(sourceId), '047.md');
  assert.deepEqual(parsed.artifacts, [
    { id: artifactId, title: 'Título renombrado', typeCode: 1, sourceIds: [sourceId] },
  ]);
});

test('parses a nested source title and source references outside artifact slot three', () => {
  const sourceId = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const artifactId = '69fc428b-94a6-4355-af48-eb6c56699ab6';
  const payload = JSON.stringify([
    [sourceId, [['047.md']], 0],
    [artifactId, 'Audio', 1, null, [[sourceId]]],
  ]);
  const response = `)]}'\n${JSON.stringify([
    ['wrb.fr', 'rpc', payload, null, null, null, 'generic'],
  ])}`;

  const parsed = parseNotebookBatchResponse(response);

  assert.equal(parsed.sources.get(sourceId), '047.md');
  assert.deepEqual(parsed.artifacts[0].sourceIds, [sourceId]);
});

test('combines content type and multiple selected sources with AND/OR semantics', () => {
  const audio047 = { kind: 'audio', sourceKeys: new Set(['T047']) };
  const audio048 = { kind: 'audio', sourceKeys: new Set(['T048']) };
  const quiz047 = { kind: 'quiz', sourceKeys: new Set(['T047']) };
  const filters = {
    activeTypes: ['audio'],
    activeSources: ['T047', 'T048'],
    sourceQuery: '',
  };

  assert.equal(artifactMatchesFilters(audio047, filters), true);
  assert.equal(artifactMatchesFilters(audio048, filters), true);
  assert.equal(artifactMatchesFilters(quiz047, filters), false);
});

test('typed source name combines with selected content type', () => {
  const filters = {
    activeTypes: ['quiz'],
    activeSources: [],
    sourceQuery: '047.md',
  };

  assert.equal(
    artifactMatchesFilters({ kind: 'quiz', sourceKeys: new Set(['T047']) }, filters),
    true
  );
  assert.equal(
    artifactMatchesFilters({ kind: 'audio', sourceKeys: new Set(['T047']) }, filters),
    false
  );
  assert.equal(
    artifactMatchesFilters({ kind: 'quiz', sourceKeys: new Set(['T048']) }, filters),
    false
  );
});

test('typed non-numeric source name matches artifact source metadata', () => {
  const artifact = {
    kind: 'guide',
    sourceKeys: new Set(),
    sourceNames: ['Informe_Legislacion_Obsoleta.md'],
  };

  assert.equal(
    artifactMatchesFilters(artifact, {
      activeTypes: ['guide'],
      activeSources: [],
      sourceQuery: 'legislacion obsoleta',
    }),
    true
  );
});

test('metadata snapshots retain sources and artifacts from separate RPC responses', () => {
  const sourceId = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const artifactId = '69fc428b-94a6-4355-af48-eb6c56699ab6';
  const withSource = mergeMetadataSnapshot(null, {
    sources: [[sourceId, '047.md']],
    artifacts: [],
  });
  const complete = mergeMetadataSnapshot(withSource, {
    sources: [],
    artifacts: [{
      id: artifactId,
      title: 'T047 - Audio',
      typeCode: 1,
      sourceIds: [sourceId],
    }],
  });

  assert.deepEqual(complete.sources, [[sourceId, '047.md']]);
  assert.equal(complete.artifacts[0].id, artifactId);
});
