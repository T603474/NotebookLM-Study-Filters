const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSourceQuery,
  matchesSourceQuery,
  parseNotebookBatchResponse,
  buildArtifactSourceOptions,
  artifactMatchesFilters,
  mergeMetadataSnapshot,
  isContextInvalidatedError,
  SOURCE_ID_PREFIX,
} = require('./filter-core');

test('recognizes "Extension context invalidated" regardless of how the error arrives', () => {
  assert.equal(isContextInvalidatedError(new Error('Extension context invalidated.')), true);
  assert.equal(isContextInvalidatedError({ message: 'Extension context invalidated.' }), true);
  assert.equal(isContextInvalidatedError('Extension context invalidated.'), true);
  assert.equal(isContextInvalidatedError(new Error('Cannot read properties of null')), false);
  assert.equal(isContextInvalidatedError(null), false);
  assert.equal(isContextInvalidatedError(undefined), false);
});

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

test('a source row with a small numeric field is not misclassified as an artifact', () => {
  const sourceId = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const artifactId = '69fc428b-94a6-4355-af48-eb6c56699ab6';
  // Fila de fuente realista: [uuid, titulo, tipoDocumento(2), timestamp, mime].
  // "tipoDocumento" cae en el mismo rango 1-9 que el typeCode de un
  // artefacto, por lo que antes de exigir un UUID ajeno esta fila se
  // clasificaba incorrectamente como artefacto y la fuente desaparecia.
  const sourceRow = [sourceId, '047.md', 2, 1699999999, 'text/markdown'];
  const artifactRow = [artifactId, 'T047 - Audio', 1, [[sourceId]], 3];
  const payload = JSON.stringify([sourceRow, artifactRow]);
  const response = `)]}'\n${JSON.stringify([
    ['wrb.fr', 'rpc', payload, null, null, null, 'generic'],
  ])}`;

  const parsed = parseNotebookBatchResponse(response);

  assert.equal(parsed.sources.get(sourceId), '047.md');
  assert.deepEqual(parsed.artifacts, [
    { id: artifactId, title: 'T047 - Audio', typeCode: 1, sourceIds: [sourceId] },
  ]);
});

test('matches a source by its raw id when no key or name can be derived', () => {
  const sourceId = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const otherId = '11111111-1111-1111-1111-111111111111';

  assert.equal(matchesSourceQuery(new Set(), SOURCE_ID_PREFIX + sourceId, [], [sourceId]), true);
  assert.equal(matchesSourceQuery(new Set(), SOURCE_ID_PREFIX + otherId, [], [sourceId]), false);
  // Insensible a mayusculas/minusculas, ya que los UUID pueden llegar en
  // cualquier combinacion de caja segun el origen del chip.
  assert.equal(matchesSourceQuery(new Set(), SOURCE_ID_PREFIX + sourceId.toUpperCase(), [], [sourceId]), true);
});

test('a fallback id-based source chip still filters artifacts with unresolved titles', () => {
  const sourceId = 'ff424fd8-f9f1-4f54-9942-ebab74cd9729';
  const artifact = { kind: 'audio', sourceKeys: new Set(), sourceNames: [], sourceIds: [sourceId] };

  assert.equal(
    artifactMatchesFilters(artifact, {
      activeTypes: [],
      activeSources: [SOURCE_ID_PREFIX + sourceId],
      sourceQuery: '',
    }),
    true
  );
  assert.equal(
    artifactMatchesFilters(artifact, {
      activeTypes: [],
      activeSources: [SOURCE_ID_PREFIX + '11111111-1111-1111-1111-111111111111'],
      sourceQuery: '',
    }),
    false
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
