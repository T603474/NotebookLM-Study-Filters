# Filtro de Estudio para NotebookLM

Extensión de navegador (Manifest V3) para **Microsoft Edge** y **Google Chrome** que añade un panel de filtros dentro de la pestaña **Studio** de [NotebookLM](https://notebooklm.google.com), permitiendo filtrar las herramientas de estudio generadas (audios, presentaciones, tests, infografías, etc.) **por tipo de contenido** y **por fuente**, sin romper la SPA de NotebookLM.

> Versión actual: **0.1.8**

---

## Tabla de contenidos

- [Qué hace](#qué-hace)
- [Por qué existe](#por-qué-existe)
- [Instalación](#instalación)
- [Uso](#uso)
- [Cómo funciona (arquitectura)](#cómo-funciona-arquitectura)
- [Tipos de contenido reconocidos](#tipos-de-contenido-reconocidos)
- [Resolución de problemas](#resolución-de-problemas)
- [Diagnóstico desde la consola](#diagnóstico-desde-la-consola)
- [Desarrollo y pruebas](#desarrollo-y-pruebas)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Historial de versiones](#historial-de-versiones)
- [Licencia](#licencia)

---

## Qué hace

Cuando abres un notebook en NotebookLM y entras en la pestaña **Studio**, la extensión inyecta un panel "Filtros" entre los botones de creación y la lista de herramientas generadas. El panel ofrece:

- **Buscador de guías** (por texto): filtra las herramientas cuyo título o detalles contienen el texto escrito.
- **Tipo de contenido**: chips para cada tipo detectado (`Todos`, `Audio`, `Briefing`, `Tarjetas`, `Tabla de datos`, `Guía`, `Infografía`, `Mapa`, `Presentación`, `Test`, `Informes`, `Vídeo`…). Selecciona uno (o varios) para acotar la lista.
- **Fuentes**: lista **solo las fuentes para las que ya se ha creado alguna herramienta de estudio** (no todas las fuentes del notebook). Permite filtrar por número de tema escribiendo en el buscador (p. ej. `041.md` o `041`) o seleccionando uno o varios chips de fuente.

Los filtros se combinan con semántica **Y** (un artefacto debe cumplir todas las condiciones activas para seguir visible). El estado de los filtros se **persiste** entre sesiones mediante `chrome.storage.local`, y se sincroniza entre el panel in-page y el popup de la extensión.

## Por qué existe

NotebookLM lista en Studio todas las herramientas generadas de todas las fuentes juntas, sin forma de acotar por tipo ni por fuente. Cuando un notebook tiene decenas de fuentes y se han creado audios, tests, infografías, etc. para cada una, encontrar lo que buscas requiere mucho *scroll*. Esta extensión añade el filtrado que NotebookLM no trae de fábrica, respetando su DOM y sin interceptar ni alterar las llamadas de red de forma destructiva.

---

## Instalación

La extensión **no está publicada en la Chrome Web Store**; se carga como extensión de desarrollo (no empaquetada). Funciona igual en **Microsoft Edge** y en **Google Chrome**.

### Requisitos

- Microsoft Edge o Google Chrome.
- Una cuenta de Google con acceso a NotebookLM.
- Los ficheros de este repositorio descargados en tu equipo (clonar el repo o descargar el ZIP y descomprimirlo).

### Paso a paso (Microsoft Edge)

1. Descarga el repositorio a una carpeta local, por ejemplo:
   ```bash
   git clone https://github.com/T603474/NotebookLM-Study-Filters.git
   ```
   (o descomprime el ZIP en una carpeta y recuerda su ruta).

2. Abre Edge y ve a `edge://extensions`.

3. Activa el **Modo para desarrolladores** (interruptor en la esquina inferior izquierda).

4. Pulsa **Cargar extensión descomprimida** y selecciona la carpeta del proyecto (la que contiene `manifest.json`).

5. La extensión **Filtro de Estudio para NotebookLM** aparecerá en la lista. Asegúrate de que está **activada**.

6. Abre (o recarga) una pestaña con un notebook de NotebookLM y entra en la pestaña **Studio**. Deberías ver el panel "Filtros" entre los botones de creación y la lista de herramientas.

### Paso a paso (Google Chrome)

Igual que Edge, pero la URL de gestión de extensiones es `chrome://extensions` y el botón se llama **Cargar descomprimida**.

### Actualizar a una nueva versión

Cuando se incorporen cambios al repositorio:

1. `edge://extensions` (o `chrome://extensions`).
2. Pulsa **Volver a cargar** en la tarjeta de la extensión.
3. **Cierra y vuelve a abrir** la pestaña de NotebookLM (no basta con refrescar: la SPA mantiene en memoria el estado anterior y el content script debe reinicializarse).
4. Verifica en el panel que la versión mostrada (`Filtros · vX.Y.Z`) es la esperada.

> Si tras actualizar la extensión dejas la pestaña de NotebookLM abierta, es normal que aparezca un error "Extension context invalidated" en la página de la extensión: la instancia anterior del content script queda huérfana. Cerrar y reabrir la pestaña lo resuelve. La extensión está blindada frente a este caso y se desactiva limpiamente sin dejar timers ni observadores activos.

---

## Uso

El panel "Filtros" tiene esta estructura:

```
Filtros · v0.1.8                              Limpiar
─────────────────────────────────────────────
TIPO DE CONTENIDO
  [ Buscar guías... ]
  ( Todos ) ( Audio ) ( Briefing ) ( Tarjetas ) ( Tabla de datos )
  ( Guía ) ( Infografía ) ( Mapa ) ( Presentación ) ( Test )
  ( Informes ) ( Vídeo )
─────────────────────────────────────────────
FUENTES
  [ Buscar fuente (ej: 047.md)... ]
  ( 028 ) ( 035 ) ( 041 ) ( 047 ) ...
```

### Filtrar por texto

- Escribe en **Buscar guías...** para acotar por el título o los detalles de la herramienta (p. ej. `trampas`, `T041`, `audio`). Se aplica en vivo mientras escribes.

### Filtrar por tipo de contenido

- Pulsa un chip (p. ej. **Test**) para mostrar solo las herramientas de ese tipo.
- El chip **Todos** (seleccionado por defecto) desactiva el filtro de tipo.
- Puedes seleccionar varios tipos a la vez: la lista mostrará las herramientas de cualquiera de los tipos seleccionados (semántica **O** entre tipos, **Y** con el resto de filtros).

### Filtrar por fuente

- **Chips de fuente**: solo aparecen fuentes para las que **ya existe** al menos una herramienta de estudio creada. Cada chip muestra el número de tema legible derivado del título de la fuente o del título del artefacto (p. ej. `041`).
- **Buscador de fuente**: escribe el número de tema en cualquier formato habitual (`041`, `041.md`, `T041`, `Tema 41`, `Tema41_...`) y se filtrarán las herramientas de esa fuente. Acepta también parte del nombre del fichero fuente (p. ej. `legislacion` para `Informe_Legislacion_Obsoleta.md`).
- Selecciona uno o varios chips de fuente para combinar (semántica **O** entre fuentes seleccionadas, **Y** con el tipo y el texto).

### Limpiar

- El botón **Limpiar** (arriba a la derecha del panel) restablece todos los filtros a su estado por defecto (Todo visible, sin texto).

### Popup de la extensión

Además del panel in-page, al pulsar el icono de la extensión en la barra de herramientas se abre un popup con los mismos chips de tipo y de fuente. Lo que cambies en el popup se aplica a la pestaña activa de NotebookLM y se sincroniza con el panel in-page (y viceversa).

---

## Cómo funciona (arquitectura)

La extensión intercepta las llamadas internas que NotebookLM hace a su backend (`batchexecute`) para obtener los **metadatos reales** de cada artefacto: su tipo y los UUIDs de las fuentes a las que está vinculado. Esto evita depender de heurísticas frágiles sobre el texto del título.

- **`page-bridge.js`** se inyecta en el **mundo MAIN** de la página (el mismo contexto de JS que NotebookLM) y envuelve `fetch` y `XMLHttpRequest` para capturar las respuestas `batchexecute`, extraer fuentes y artefactos, y comunicarlos al content script mediante un atributo en `<html>` y un evento `nl-filter-api-metadata`.
- **`content.js`** se inyecta en el **mundo ISOLATED** (donde tiene acceso a la API de extensiones, `chrome.storage`, etc.). Recibe los metadatos del bridge, construye y mantiene el panel de filtros, enlaza cada elemento del DOM con sus metadatos, y aplica la visibilidad.
- **`filter-core.js`** es un módulo de funciones puras (normalización de consultas, extracción de claves de fuente, *matching*) compartido por ambos mundos.
- **`background.js`** es el *service worker* que reenvía mensajes del popup a la pestaña activa.
- **`popup.html` / `popup.js`** implementan la interfaz de la barra de herramientas.

El filtrado por tipo es robusto frente a un `typeCode` erróneo o compartido en la respuesta RPC: se priorizan las señales visuales que la propia UI de NotebookLM renderiza (icono, botón de reproducción) antes que el campo numérico de la respuesta. El filtrado por fuente deriva la clave legible (p. ej. `041`) del título de la fuente cuando está disponible, o del título del artefacto (`T041 - Audio - Test`) como respaldo. Solo si no se puede derivar ninguna clave, el chip muestra el UUID abreviado (`Fuente 1fce7372`) para que la fuente siga siendo seleccionable en vez de desaparecer.

---

## Tipos de contenido reconocidos

| Chip            | Tipo interno   | Origen de la detección                          |
|-----------------|----------------|-------------------------------------------------|
| Audio           | `audio`        | Icono / botón "Reproducir" + `typeCode` 1       |
| Briefing        | `briefing`     | "briefing doc" en detalles + `typeCode` 2       |
| Informes        | `report`       | "blog post" en detalles + `typeCode` 2          |
| Guía            | `guide`        | "study guide" en detalles + `typeCode` 2        |
| Vídeo           | `video`        | Icono subscriptions / "vídeo" + `typeCode` 3    |
| Test            | `quiz`         | "quiz"/"cuestionario" + `typeCode` 4            |
| Tarjetas        | `cards`        | "flashcard"/"tarjeta" + `typeCode` 4            |
| Mapa            | `map`          | "mind map"/"mapa mental" + `typeCode` 5         |
| Infografía      | `infographic`  | "infographic"/"infografía" + `typeCode` 7       |
| Presentación    | `presentation` | "slide deck"/"presentación" + `typeCode` 8      |
| Tabla de datos  | `datatable`    | "data table"/"tabla de datos" + `typeCode` 9    |

---

## Resolución de problemas

**El panel no aparece**
- Confirma que estás en `https://notebooklm.google.com/notebook/<id>` y en la pestaña **Studio**.
- Cierra y vuelve a abrir la pestaña (la extensión se inicializa al cargar).
- En `edge://extensions` confirma que la extensión está activada y que la versión mostrada es la esperada.

**Selecciono un chip pero la lista no se filtra**
- Refresca la pestaña por completo (cerrar y reabrir). Si acabas de actualizar la extensión sin cerrar la pestaña, el content script anterior quedó huérfano.
- Ejecuta `__nlFilterDebug()` en la consola de DevTools (ver siguiente sección) y comprueba que `FILTER_CORE` está `definido`.

**Los chips de fuente muestran `Fuente <uuid>` en vez de un número**
- Significa que para esas fuentes no se pudo derivar el número de tema ni del título de la fuente ni del título de ningún artefacto (p. ej. fuentes con nombres sin numeración). Siguen siendo seleccionables por su UUID. Para fuentes con numeración (`041.md`, `Tema41_...`), el chip muestra el número.

**Error "Extension context invalidated" en la página de extensiones**
- Es esperado si recargaste la extensión sin cerrar la pestaña de NotebookLM. Cierra y reabre la pestaña. La extensión está blindada frente a este caso y se desactiva limpiamente.

---

## Diagnóstico desde la consola

Con DevTools abierto en la pestaña de NotebookLM (contexto de la extensión), ejecuta:

```js
__nlFilterDebug();
```

Muestra una tabla con las fuentes y artefactos capturados vía `batchexecute`, los filtros activos, los textos de búsqueda, cuántos ítems del DOM están enlazados a metadatos y, especialmente, el estado de `FILTER_CORE`:

```
[NL Filter] FILTER_CORE: inline (definido)
```

- `global`: se está usando `globalThis.NotebookFilterCore` (compartida entre ficheros del content script).
- `inline`: la global no estaba disponible y se está usando el fallback inline (el filtrado funciona igualmente).

---

## Desarrollo y pruebas

Requisitos: Node.js (para los tests).

Instala las dependencias de desarrollo (jsdom):

```bash
npm install
```

Ejecuta la batería de pruebas:

```bash
npm test
```

La suite incluye:

- `filter-core.test.js`: pruebas unitarias de la lógica pura (normalización de consultas de fuente, extracción de claves, *matching* de filtros, parseo de respuestas `batchexecute`, detección de filas fuente vs. artefacto, *snapshots* de metadatos, detección del error "Extension context invalidated").
- `content.dom.test.js`: pruebas de integración con jsdom que ejecutan la canalización real (`clic en chip → readPressedFilters → applyFilters → ocultar/mostrar`) contra un DOM simulado con datos reales de un notebook (UUIDs, `typeCode` y títulos obtenidos vía MCP de NotebookLM). Incluye un test de regresión que carga `content.js` **sin** `filter-core.js` para verificar que el fallback inline mantiene el filtrado cuando la global no está disponible (escenario observado en Edge real).

---

## Estructura del proyecto

```
.
├── manifest.json          # Manifest V3: permisos, content scripts (MAIN + ISOLATED), popup, service worker
├── content.js             # Content script (mundo ISOLATED): panel de filtros, filtrado, enlaces DOM-metadatos
├── page-bridge.js         # Puente en el mundo MAIN: intercepta fetch/XHR batchexecute y emite metadatos
├── filter-core.js         # Funciones puras compartidas (normalización, matching, parseo de RPC)
├── background.js          # Service worker: reenvía mensajes del popup a la pestaña activa
├── popup.html             # UI del popup de la barra de herramientas
├── popup.js               # Lógica del popup
├── styles.css             # Estilos (referencia; los del panel in-page están inline en content.js)
├── icon16.png icon48.png icon128.png
├── filter-core.test.js    # Tests unitarios de filter-core
├── content.dom.test.js    # Tests de integración DOM con jsdom
├── package.json           # Dependencias de desarrollo (jsdom) y script de test
└── .gitignore
```

---

## Historial de versiones

- **0.1.1** — Interceptación de `batchexecute` para tipo/fuente real y panel de filtros in-page.
- **0.1.2** — Fuentes de respaldo por UUID y clasificación de filas fuente/artefacto más robusta.
- **0.1.3** — Blindaje frente al error "Extension context invalidated" (teardown limpio).
- **0.1.4** — Corrige filtrado por tipo y fuente rotos por un bug de enlace DOM-metadatos.
- **0.1.5** — Limpieza de código muerto e instrumentación de depuración; corrige la detección de fuente para nombres con guion bajo (`Tema41_..._ESTUDIO.md`).
- **0.1.6** — Causa raíz del filtrado inoperante: `FILTER_CORE` era `undefined` en el navegador real; se añade fallback inline de las funciones puras. Test de regresión que lo cubre.
- **0.1.7** — El cuadro "Buscar guías..." se reubica bajo la sección "Tipo de contenido".
- **0.1.8** — Separación visual entre las dos subsecciones (línea divisoria) y renombrado de "Fuente" a "Fuentes".

---

## Licencia

[MIT](LICENSE) © 2026 T603474

Permiso para usar, copiar, modificar, fusionar, publicar, distribuir, sublicenciar y/o vender copias del software, y para permitir a las personas a las que se les proporcione hacerlo, bajo la única condición de conservar el aviso de copyright y este aviso de permiso en todas las copias o partes sustanciales del software.

Esta extensión no está afiliada a Google ni a NotebookLM.
