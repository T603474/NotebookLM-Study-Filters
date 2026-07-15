# Contribuir a Filtro de Estudio para NotebookLM

Gracias por tu interés en mejorar esta extensión. Es un proyecto pequeño y ligero (sin bundler, sin dependencias en runtime); agradecemos que se mantenga así.

## Instalación para desarrollo

1. Clona el repo.
2. Carga la extensión sin empaquetar en Edge (`edge://extensions` → modo desarrollador → "Cargar extensión descomprimida") o Chrome (`chrome://extensions` → "Cargar descomprimida"), apuntando a la carpeta del proyecto.
3. Abre un notebook en NotebookLM y entra en la pestaña **Studio**; debería aparecer el panel "Filtros".

## Tests

Requisito: Node.js 20+.

```bash
npm install      # instala jsdom (dev)
npm test         # ejecuta filter-core.test.js, content.dom.test.js y popup.test.js
```

Los tests usan `node:test` y `jsdom`. `content.dom.test.js` ejecuta la canalización real de filtrado contra un DOM simulado con datos reales de un notebook (UUIDs, `typeCode` y títulos obtenidos vía MCP). Cualquier cambio de comportamiento debe ir acompañado de un test que lo cubra.

## Convención de versionado

- Una rama por versión: `version/X.Y.Z` (p. ej. `version/1.0.0`).
- Subir la versión en `manifest.json` en cada corrección o mejora.
- Probar en local antes de consolidar.
- Tras aprobación, consolidar la rama de versión a `main` y empujar.
- Para desarrollo aislado de una versión mayor sin afectar a la actual, puede usarse un **git worktree** (carpeta hermana sobre la rama `version/X.Y.Z`); así la carpeta principal se queda en la versión estable.

## Cómo añadir una mejora

1. Abre una rama `version/X.Y.Z` (o una rama de feature corta).
2. Implementa el cambio en archivos pequeños y enfocados; añade/actualiza tests.
3. Verifica `npm test` en verde y `node -c` sin errores en cada script.
4. Commit con mensajes claros (`feat:`, `fix:`, `chore:`, `docs:`, `perf:`, `refactor:`).
5. Si el cambio toca el panel in-page, comprueba que no se realimente el `MutationObserver` (el panel vive dentro del subárbol observado; las actualizaciones deben ser idempotentes o el observer las ignora).

## Notas de arquitectura

- **Mundos MV3**: `page-bridge.js` corre en el mundo MAIN (intercepta `batchexecute`); `content.js` en el ISOLATED (panel, filtrado, `chrome.storage`); `filter-core.js` compartido.
- **`FILTER_CORE`**: `content.js` resuelve `globalThis.NotebookFilterCore || INLINE_FILTER_CORE`. El fallback inline es vital: en algunos navegales la global compartida entre ficheros del mismo `content_scripts` no está disponible, y sin el fallback el filtrado por tipo y por fuente deja de funcionar (la búsqueda de texto, que no usa `FILTER_CORE`, seguiría funcionando). No eliminar el fallback.
- **Almacenamiento por notebook**: las claves son `studyTypes:<notebookId>`, `sourceTypes:<notebookId>`, `collapsed:<notebookId>`. El popup usa las mismas claves (extrae el ID de la URL de la pestaña activa).

## Co-autoría

Los commits pueden llevar el trailer `Co-authored-by:` cuando corresponda (p. ej. asistencia de IA). Es transparencia, no cambia la propiedad ni la licencia (MIT).
