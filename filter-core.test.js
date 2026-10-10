const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeSourceQuery,
  sourceKeyFromTitle,
  matchesSourceQuery,
  parseNotebookBatchResponse,
  buildArtifactSourceOptions,
  artifactMatchesFilters,
  mergeMetadataSnapshot,
  isContextInvalidatedError,
  SOURCE_ID_PREFIX,
  extractSourceKeys,
  buildStudyModel,
  reconcileSourceFilter,
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

test('derives a source key from real underscore-separated filenames, not just space-separated ones', () => {
  // Bug real (v0.1.4): "Tema41_Desarrollo_..._ESTUDIO.md" nunca resolvia
  // porque el regex exigia un limite de palabra ("\b") justo despues del
  // numero, y "_" cuenta como caracter de palabra en regex -- nunca habia
  // limite entre "41" y "_". Verificado contra nombres reales obtenidos
  // via MCP notebook-lm del notebook "Grupo III - ExDesarr (41-65)".
  assert.equal(sourceKeyFromTitle('Tema41_Desarrollo_Equipos_Departamentales_Dispositivos_Personales_Madrid_ESTUDIO.md'), 'T041');
  assert.equal(sourceKeyFromTitle('Tema63_Planificacion_Estrategica_SI_Plan_Sistemas_Madrid_EXAMEN.md'), 'T063');
  // Los convenios anteriores (con espacio, con prefijo T, o numero desnudo)
  // deben seguir funcionando igual que antes.
  assert.equal(sourceKeyFromTitle('047.md'), 'T047');
  assert.equal(sourceKeyFromTitle('T047'), 'T047');
  assert.equal(sourceKeyFromTitle('Claves y trampas del Tema 041 TIC'), 'T041');
  // Un titulo sin ningun numero de tema no debe inventarse una clave.
  assert.equal(sourceKeyFromTitle('Trampas de agilidad para opositores TIC'), '');
  // Un numero de 4 cifras (p.ej. un anyo) no debe recortarse a 2-3 cifras.
  assert.equal(sourceKeyFromTitle('Informe anual 2026'), '');
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

// --- Modelo DOM-first (spec v1.2.0) -----------------------------------------
// UUIDs y titulos reales del notebook "Infraestructura y Tecnologia (52-85)".
const SRC_063 = '7b104fef-2fc0-431e-89c1-5bb86477541f';
const SRC_064 = 'ea0a4122-c95a-4db3-a09d-d78439d5ccc2';
const SRC_065 = 'a2cef8f2-e0f7-4ef0-b071-75f98d322058';
const SRC_066 = '29e4fde1-ba03-4f8f-ad2f-3192805aeef7';
const A_QUIZ_063 = 'b45be210-8a5b-4497-a0a7-db3e2e75bd8b';
const A_QUIZ_064 = '2be6230f-34b2-4e2c-8491-800daeec4cbe';
const A_AUDIO_066 = '2524cd6f-d462-4586-a90e-5cd81db6ba25';
const A_AUDIO_065 = '9af21145-dbef-4bea-a6b9-a754160e3bf7';

const MODEL_DICT = {
  artifacts: new Map([
    [A_QUIZ_063, { title: 'T063 - Test - Test', sourceIds: [SRC_063] }],
    [A_QUIZ_064, { title: 'T64 - Test - Test', sourceIds: [SRC_064] }],
    [A_AUDIO_066, { title: 'T66 - Audio - Test', sourceIds: [SRC_066] }],
    [A_AUDIO_065, { title: 'T65 - Audio - Test', sourceIds: [SRC_065] }],
  ]),
  sourceTitles: new Map([
    [SRC_063, '063.md'],
    [SRC_064, '064.md'],
    [SRC_065, '065.md'],
    [SRC_066, '066.md'],
  ]),
};

function domItem(id, kind) {
  return { id, title: MODEL_DICT.artifacts.get(id).title, kind };
}

const ALL_ITEMS = [
  domItem(A_QUIZ_063, 'quiz'),
  domItem(A_QUIZ_064, 'quiz'),
  domItem(A_AUDIO_066, 'audio'),
  domItem(A_AUDIO_065, 'audio'),
];

test('extractSourceKeys deriva claves de nombres de fichero, de titulos y de un "Tema NN" explicito', () => {
  assert.deepEqual(Array.from(extractSourceKeys('Tema41_Desarrollo_Madrid_ESTUDIO.md')), ['T041']);
  assert.deepEqual(Array.from(extractSourceKeys('Claves y trampas del Tema 041 TIC')), ['T041']);
  assert.deepEqual(Array.from(extractSourceKeys('Parte 12 del Tema 41')).sort(), ['T012', 'T041']);
  assert.equal(extractSourceKeys('').size, 0);
  assert.equal(extractSourceKeys('Informe anual 2026').size, 0);
});

test('buildStudyModel crea una fuente por UUID con su nombre real, recuentos y claves', () => {
  const model = buildStudyModel(ALL_ITEMS, MODEL_DICT);
  assert.deepEqual(model.sources.map((s) => s.label), ['063.md', '064.md', '065.md', '066.md']);
  assert.deepEqual(model.sources.map((s) => s.id), [SRC_063, SRC_064, SRC_065, SRC_066]);
  assert.deepEqual(model.sources.map((s) => s.keys), [['T063'], ['T064'], ['T065'], ['T066']]);
  assert.equal(model.counts.total, 4);
  assert.deepEqual(model.counts.byKind, { quiz: 2, audio: 2 });
  assert.equal(model.counts.bySourceId[SRC_064], 1);
  assert.equal(model.complete, true);
});

test('buildStudyModel mantiene separadas dos fuentes que comparten clave de tema', () => {
  const ESTUDIO = '193e656a-e19e-405a-b80c-663376b1c8ad';
  const EXAMEN = '9bbc1678-ec54-4e1a-99d7-9cb36a4d9266';
  const dict = {
    artifacts: new Map([
      ['11111111-1111-4111-8111-111111111111', { title: 'Claves y trampas del Tema 041 TIC', sourceIds: [EXAMEN] }],
      ['22222222-2222-4222-8222-222222222222', { title: 'Trampas de agilidad', sourceIds: [ESTUDIO] }],
      ['33333333-3333-4333-8333-333333333333', { title: 'Resumen en audio del tema', sourceIds: [ESTUDIO] }],
    ]),
    sourceTitles: new Map([
      [ESTUDIO, 'Tema41_Desarrollo_Madrid_ESTUDIO.md'],
      [EXAMEN, 'Tema41_Desarrollo_Madrid_EXAMEN.md'],
    ]),
  };
  const items = Array.from(dict.artifacts.entries())
    .map(([id, meta]) => ({ id, title: meta.title, kind: 'audio' }));
  const model = buildStudyModel(items, dict);
  assert.deepEqual(model.sources.map((s) => s.label),
    ['Tema41_Desarrollo_Madrid_ESTUDIO.md', 'Tema41_Desarrollo_Madrid_EXAMEN.md']);
  assert.equal(model.counts.bySourceId[ESTUDIO], 2);
  assert.equal(model.counts.bySourceId[EXAMEN], 1);
  model.sources.forEach((s) => assert.deepEqual(s.keys, ['T041']));
});

test('buildStudyModel: quitar un elemento del DOM retira su fuente y descuenta los recuentos', () => {
  const before = buildStudyModel(ALL_ITEMS, MODEL_DICT);
  const after = buildStudyModel(ALL_ITEMS.filter((item) => item.id !== A_AUDIO_066), MODEL_DICT);
  assert.equal(before.sources.some((s) => s.id === SRC_066), true);
  assert.equal(after.sources.some((s) => s.id === SRC_066), false, 'la fuente 066 solo tenia ese artefacto');
  assert.equal(after.counts.bySourceId[SRC_066], undefined);
  assert.deepEqual(after.counts.byKind, { quiz: 2, audio: 1 });
  assert.equal(after.counts.total, 3);
});

test('buildStudyModel cuenta los elementos sin enlace y marca el modelo como incompleto', () => {
  const items = [
    ...ALL_ITEMS,
    { id: '', title: 'Sin enlace', kind: 'audio' },
    { id: '99999999-9999-4999-8999-999999999999', title: 'No esta en la cache', kind: 'quiz' },
  ];
  const model = buildStudyModel(items, MODEL_DICT);
  assert.equal(model.complete, false);
  assert.equal(model.counts.total, 6);
  assert.deepEqual(model.artifacts[4].sourceIds, []);
  assert.equal(buildStudyModel([], MODEL_DICT).complete, false, 'sin elementos tampoco hay modelo completo');
});

test('buildStudyModel etiqueta: nombre, luego numero de tema, luego "Fuente sin nombre"; y desambigua repetidas', () => {
  const NAMED = 'c0000000-0000-4000-8000-00000000000a';
  const KEYED = SRC_064;
  const BARE = SRC_066;
  const TWIN_A = 'aaaa1111-0000-4000-8000-000000000001';
  const TWIN_B = 'bbbb2222-0000-4000-8000-000000000002';
  const dict = {
    artifacts: new Map([
      ['10000000-0000-4000-8000-000000000001', { title: 'Resumen', sourceIds: [NAMED] }],
      ['10000000-0000-4000-8000-000000000002', { title: 'T064 - Audio', sourceIds: [KEYED] }],
      ['10000000-0000-4000-8000-000000000003', { title: 'Resumen', sourceIds: [BARE] }],
      ['10000000-0000-4000-8000-000000000004', { title: 'T041 - Audio', sourceIds: [TWIN_A] }],
      ['10000000-0000-4000-8000-000000000005', { title: 'T041 - Test', sourceIds: [TWIN_B] }],
    ]),
    sourceTitles: new Map([[NAMED, 'informe_legislacion.md']]),
  };
  const items = Array.from(dict.artifacts.entries())
    .map(([id, meta]) => ({ id, title: meta.title, kind: 'audio' }));
  const labels = new Map(buildStudyModel(items, dict).sources.map((s) => [s.id, s.label]));
  assert.equal(labels.get(NAMED), 'informe_legislacion.md');
  assert.equal(labels.get(KEYED), '064');
  assert.equal(labels.get(BARE), 'Fuente sin nombre · 29e4');
  assert.equal(labels.get(TWIN_A), '041 · aaaa');
  assert.equal(labels.get(TWIN_B), '041 · bbbb');
});

test('buildStudyModel deriva claves de tema solo de los artefactos presentes', () => {
  const ids = ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'];
  const dict = {
    artifacts: new Map([
      [ids[0], { title: 'T064 - Audio', sourceIds: [SRC_064] }],
      [ids[1], { title: 'Resumen sin numero', sourceIds: [SRC_064] }],
    ]),
    sourceTitles: new Map(),
  };
  const both = [
    { id: ids[0], title: 'T064 - Audio', kind: 'audio' },
    { id: ids[1], title: 'Resumen sin numero', kind: 'audio' },
  ];
  assert.deepEqual(buildStudyModel(both, dict).sources[0].keys, ['T064']);
  const afterDelete = buildStudyModel(both.slice(1), dict);
  assert.deepEqual(afterDelete.sources[0].keys, [], 'sin el artefacto "T064" ya no hay clave que derivar');
  assert.equal(afterDelete.sources[0].label, 'Fuente sin nombre · ea0a');
});

test('buildStudyModel expone por artefacto las claves y nombres de sus fuentes para el buscador de fuente', () => {
  const model = buildStudyModel(ALL_ITEMS, MODEL_DICT);
  const quiz064 = model.artifacts.find((a) => a.id === A_QUIZ_064);
  assert.deepEqual(quiz064.sourceKeys, ['T064']);
  assert.deepEqual(quiz064.sourceNames, ['064.md']);
  assert.deepEqual(quiz064.sourceIds, [SRC_064]);
});

const TEMA_ESTUDIO = '193e656a-e19e-405a-b80c-663376b1c8ad';
const TEMA_EXAMEN = '9bbc1678-ec54-4e1a-99d7-9cb36a4d9266';

function completeModel() {
  const dict = {
    artifacts: new Map([
      ['11111111-1111-4111-8111-111111111111', { title: 'Claves Tema 041', sourceIds: [TEMA_EXAMEN] }],
      ['22222222-2222-4222-8222-222222222222', { title: 'Audio ESTUDIO', sourceIds: [TEMA_ESTUDIO] }],
      ['33333333-3333-4333-8333-333333333333', { title: 'T66 - Audio - Test', sourceIds: [SRC_066] }],
    ]),
    sourceTitles: new Map([
      [TEMA_ESTUDIO, 'Tema41_Madrid_ESTUDIO.md'],
      [TEMA_EXAMEN, 'Tema41_Madrid_EXAMEN.md'],
    ]),
  };
  const items = Array.from(dict.artifacts.entries())
    .map(([id, meta]) => ({ id, title: meta.title, kind: 'audio' }));
  return buildStudyModel(items, dict);
}

test('reconcileSourceFilter no toca el filtro mientras el modelo esta incompleto', () => {
  const incomplete = buildStudyModel([], MODEL_DICT);
  const saved = { 'ID:aaaa0000-0000-4000-8000-000000000000': true, T041: true };
  const result = reconcileSourceFilter(incomplete, saved);
  assert.equal(result.changed, false);
  assert.deepEqual(result.filter, saved);
});

test('reconcileSourceFilter conserva las fuentes que existen y descarta las que ya no', () => {
  const gone = 'ID:aaaa0000-0000-4000-8000-000000000000';
  const result = reconcileSourceFilter(completeModel(), { ['ID:' + SRC_066]: true, [gone]: true });
  assert.equal(result.changed, true);
  assert.deepEqual(result.filter, { ['ID:' + SRC_066]: true });
});

test('reconcileSourceFilter traduce una clave antigua "Tnnn" a todas las fuentes que la tienen', () => {
  const result = reconcileSourceFilter(completeModel(), { T041: true });
  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.filter).sort(), ['ID:' + TEMA_ESTUDIO, 'ID:' + TEMA_EXAMEN].sort());
  assert.ok(Object.values(result.filter).every((value) => value === true));
});

test('reconcileSourceFilter descarta claves antiguas desmarcadas o sin ninguna fuente', () => {
  const result = reconcileSourceFilter(completeModel(), { T041: false, T050: true });
  assert.equal(result.changed, true);
  assert.deepEqual(result.filter, {});
});

test('reconcileSourceFilter es idempotente y no distingue mayusculas en los UUID', () => {
  const model = completeModel();
  const first = reconcileSourceFilter(model, { T066: true });
  const second = reconcileSourceFilter(model, first.filter);
  assert.equal(second.changed, false);
  assert.deepEqual(second.filter, first.filter);
  const upper = reconcileSourceFilter(model, { ['ID:' + SRC_066.toUpperCase()]: true });
  assert.equal(upper.changed, false, 'el UUID en mayusculas sigue siendo la misma fuente');
});

// --- Formas reales de la API (hito 2) ---------------------------------------
// Verificadas contra el cuaderno "0. Metodo - Practico" con el cliente del MCP:
//  - rLM1Ne: cada fuente es [[uuid], titulo, [metadatos con otro uuid...], ...]
//  - gArtLc: artefactos con typeCode 10 (archivo subido) y 11 (informe
//    interactivo), ademas de 4, 7, 8...; las fuentes van en el indice 3.
function wrap(rpc, payload) {
  return `)]}'\n\n123\n${JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic']])}`;
}

test('reconoce las fuentes con el UUID envuelto en una lista ([[uuid], titulo, ...])', () => {
  const SRC_A = '0e58e2c4-59dc-4c3f-8ecb-bfa3e246d3bf';
  const SRC_B = '658b36a6-8a6e-4def-9c1a-fa56c8ab4c80';
  const FILE_A = '11111111-aaaa-4bbb-8ccc-222222222222';
  const FILE_B = '33333333-aaaa-4bbb-8ccc-444444444444';
  const meta = (fileId) => [null, 1234, [1700000000, 0], [fileId, [1, 2]], 9, null, 1, null];
  const notebook = [
    '0. Método - Práctico',
    [
      [[SRC_A], '_CADENA_DECISION.md', meta(FILE_A), [null, 2], null, 'resumen', 'contenido'],
      [[SRC_B], '11_ENS_Seguridad.md', meta(FILE_B), [null, 2], null, 'resumen', 'contenido'],
    ],
    '5dca60a2-7f13-478a-99ce-3d199731f162',
  ];

  const parsed = parseNotebookBatchResponse(wrap('rLM1Ne', notebook));

  assert.equal(parsed.sources.get(SRC_A), '_CADENA_DECISION.md');
  assert.equal(parsed.sources.get(SRC_B), '11_ENS_Seguridad.md');
  assert.equal(parsed.sources.size, 2, 'los UUID de metadatos no son fuentes');
  assert.deepEqual(parsed.artifacts, [], 'una fuente envuelta no debe confundirse con un artefacto');
});

test('reconoce artefactos con typeCode 10 (archivo) y 11 (informe interactivo) y sus fuentes', () => {
  const SRC_A = '0e58e2c4-59dc-4c3f-8ecb-bfa3e246d3bf';
  const SRC_B = '1afc3ce5-c8ae-41b7-a0cf-fbe77be9bf4a';
  const PNG = '545b0eef-89c2-40d9-b726-a20411b08859';
  const REPORT = '159f69d9-3e6e-4d78-9d92-a5f1acca03e5';
  const QUIZ = '14b891e7-2b85-4831-bbf1-2bc24b1accee';
  const sources = [[[SRC_A], null, 1, '1700000000000'], [[SRC_B], null, 1, '1700000000000']];
  const rows = [
    [PNG, 'bpmn_diagrama_tramitacion.png', 10, sources, 3],
    [REPORT, 'Informe Interactivo de Dominio de la Metodología', 11, sources, 3],
    [QUIZ, 'Seguridad Cuestionario', 4, [[[SRC_A]]], 3],
  ];

  const parsed = parseNotebookBatchResponse(wrap('gArtLc', [rows]));

  assert.deepEqual(parsed.artifacts.map((a) => [a.id, a.typeCode, a.sourceIds]), [
    [PNG, 10, [SRC_A, SRC_B]],
    [REPORT, 11, [SRC_A, SRC_B]],
    [QUIZ, 4, [SRC_A]],
  ]);
});

test('un entero grande (marca de tiempo) en la posicion del tipo no convierte una fila en artefacto', () => {
  const SRC_A = '0e58e2c4-59dc-4c3f-8ecb-bfa3e246d3bf';
  const row = ['99999999-9999-4999-8999-999999999999', 'no es un artefacto', 1699999999, [[SRC_A]], 3];

  const parsed = parseNotebookBatchResponse(wrap('rpc', [row]));

  assert.deepEqual(parsed.artifacts, []);
});

// --- Datos reales: lo que rompio la 1.2.2 -----------------------------------
// Verificado contra el cuaderno real: el informe interactivo (typeCode 11)
// incrusta ids de otros artefactos en su contenido; y otras respuestas de la
// web contienen filas [[uuid], texto] que no son la lista de fuentes.
test('las fuentes de un artefacto salen solo de su campo de fuentes, no de ids incrustados en su contenido', () => {
  const SRC_A = '0e58e2c4-59dc-4c3f-8ecb-bfa3e246d3bf';
  const SRC_B = '1afc3ce5-c8ae-41b7-a0cf-fbe77be9bf4a';
  const SLIDES = '9c1b5b0b-9673-4f50-ab1a-a08a9338adca';
  const REPORT = '159f69d9-3e6e-4d78-9d92-a5f1acca03e5';
  const sources = [[[SRC_A], null, 1, '1700000000000'], [[SRC_B], null, 1, '1700000000000']];
  const embedded = `## Introduccion\n[Embedded element: ${SLIDES}]`;
  const rows = [
    [SLIDES, 'Control Táctico', 8, sources, 3],
    [REPORT, 'Informe Interactivo', 11, sources, 3, null, null, [embedded, [SLIDES]]],
  ];

  const parsed = parseNotebookBatchResponse(wrap('gArtLc', [rows]));
  const report = parsed.artifacts.find((a) => a.id === REPORT);

  assert.deepEqual(report.sourceIds, [SRC_A, SRC_B], 'el id del artefacto incrustado no es una fuente');
});

test('un id de otro artefacto de la misma respuesta nunca cuenta como fuente, aunque aparezca en el campo de fuentes', () => {
  const SRC_A = '0e58e2c4-59dc-4c3f-8ecb-bfa3e246d3bf';
  const SLIDES = '9c1b5b0b-9673-4f50-ab1a-a08a9338adca';
  const REPORT = '159f69d9-3e6e-4d78-9d92-a5f1acca03e5';
  const rows = [
    [SLIDES, 'Control Táctico', 8, [[[SRC_A]]], 3],
    [REPORT, 'Informe Interactivo', 11, [[[SRC_A]], [[SLIDES]]], 3],
  ];

  const parsed = parseNotebookBatchResponse(wrap('gArtLc', [rows]));

  assert.deepEqual(parsed.artifacts.find((a) => a.id === REPORT).sourceIds, [SRC_A]);
});

test('los nombres de fuente solo se toman de la lista de fuentes de rLM1Ne, sea cual sea el orden de las respuestas', () => {
  const SRC_A = '0e58e2c4-59dc-4c3f-8ecb-bfa3e246d3bf';
  const SRC_B = '1afc3ce5-c8ae-41b7-a0cf-fbe77be9bf4a';
  const meta = [null, 10, [1700000000, 0], ['bbbbbbbb-0000-4000-8000-000000000000', [1, 2]], 9];
  const notebook = ['Cuaderno', [[[SRC_A], '_CADENA_DECISION.md', meta], [[SRC_B], '_FOLIO_EXAMEN.md', meta]], 'nb'];
  // Otra respuesta de la web con filas [[uuid], texto] que NO son fuentes.
  const noise = [[[SRC_A], '2f72e313-4097-4d34-a1ef-458e04cbc29b'], [[SRC_B], '17_Calculo_y_Dimensionamiento.md']];
  const frame = (rpc, payload) => ['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic'];
  const response = (frames) => `)]}'\n\n1\n${JSON.stringify(frames)}`;

  [[frame('hPTbtc', noise), frame('rLM1Ne', notebook)], [frame('rLM1Ne', notebook), frame('hPTbtc', noise)]].forEach((frames) => {
    const parsed = parseNotebookBatchResponse(response(frames));
    assert.equal(parsed.sources.get(SRC_A), '_CADENA_DECISION.md');
    assert.equal(parsed.sources.get(SRC_B), '_FOLIO_EXAMEN.md');
    assert.equal(parsed.sources.size, 2);
  });
});

test('el resultado del parser lista los rpcids vistos (para diagnostico)', () => {
  const frame = (rpc) => ['wrb.fr', rpc, JSON.stringify([]), null, null, null, 'generic'];
  const parsed = parseNotebookBatchResponse(`)]}'\n\n1\n${JSON.stringify([frame('rLM1Ne'), frame('gArtLc')])}`);
  assert.deepEqual(Array.from(parsed.rpcIds).sort(), ['gArtLc', 'rLM1Ne']);
});
