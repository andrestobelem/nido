# Consolidación T-0012 — sincronización bidireccional

Este documento cierra T-0012 con el mismo espíritu que
`docs/gate-round-trip.md` cerró T-0011: declara, en un solo lugar, qué se
implementó, qué no hizo falta implementar y por qué, y qué evidencia
concreta (`bun test`) respalda cada punto. No repite lo que ya está escrito
en `docs/adr/001-persistencia.md` y `docs/adr/002-formato-de-archivos-y-sync.md`;
enlaza a esas secciones en vez de reabrirlas.

Punto de partida: la auditoría de Sprint 7 (`docs/sprints/07-planning.md`)
concluyó que T-0012 es un término medio acotado, no "no falta nada" ni un
ticket completo con otro nombre — un módulo nuevo pero mínimo, una laguna de
testing real, y dos preguntas del ticket original que ADR-001 ya cierra sin
código adicional. Esta consolidación sigue esa auditoría punto por punto.

## 1. Lo que se implementó

### 1.1. `sincronizarWorkspace` — reporte de alto nivel

`packages/core/src/sync/reporte.ts` agrega la única pieza de dominio nuevo
que la auditoría encontró genuinamente necesaria: un wrapper de
agregación/presentación sobre `construirIndice`
(`packages/core/src/indice/construccion.ts`, T-0018) — cero I/O propio, cero
validación nueva. `sincronizarWorkspace(raizWorkspace)` reconstruye el
índice (lectura fresca, nunca cacheada — ADR-001) y devuelve
`ReporteSincronizacion`: conteo de nodos válidos por tipo, diagnósticos
agrupados por severidad, huérfanos (`PARENT_ID_INVALIDO`) expuestos aparte
para acceso directo, y un booleano `sano` (`errores.length === 0`).

Por qué le corresponde al core y no a que cada superficie lo arme a mano:
`docs/00-entendimiento.md` es explícito en que "CLI y MCP son dos
superficies del mismo core: ninguna reimplementa la lógica de la otra". Sin
esta función, T-0013 (CLI) y un futuro T-0014 (MCP) habrían tenido que
ensamblar el mismo resumen cada uno por su cuenta sobre
`indice.diagnosticos`.

Probado en `packages/core/test/sync-reporte.test.ts` (6 tests): árbol sano,
`parent_id` colgante contado como huérfano y separado del resto de errores,
`ID_DUPLICADO` y `CICLO_EN_CONTENCION` contados como error pero no como
huérfano, una advertencia (`PROPERTY_VALUE_HUERFANO`) que no afecta `sano`,
y workspace vacío.

### 1.2. E2E con git real — la laguna de testing

`packages/core/test/sync-git-real.test.ts` cierra el caso 4 de I2 extendida
("árbol tocado por git fuera del motor de sync: rebase/merge/cherry-pick/
checkout", `docs/adr/002-formato-de-archivos-y-sync.md` sección 5) con **git
real** (`Bun.$`, tal como prefiere `CLAUDE.md`), no solo con contenido
malformado escrito a mano. Antes de este ticket, nadie había ejercitado este
escenario de punta a punta con un `git merge` real.

Mecánica: dos branches editan, cada una con una operación legítima de la API
de nido (`actualizarPage`/`actualizarDatabase`), el mismo campo del mismo
archivo de forma incompatible; el merge deja marcadores
`<<<<<<<`/`=======`/`>>>>>>>` en el archivo final en disco. Se verificó
empíricamente (no solo se asumió) el resultado para los dos formatos de
archivo de ADR-002:

- **Page (`.md`)**: cuando el conflicto cae en una línea del encabezado
  (`titulo`, en el test), el archivo se rechaza con `ENCABEZADO_INVALIDO` —
  confirma exactamente la predicción de la auditoría.
- **Database (`.json`)**: los marcadores de conflicto rompen `JSON.parse`
  sin excepción — el archivo se rechaza con `ESTRUCTURA_INVALIDA`. Este caso
  no estaba explícitamente en la propuesta de la auditoría (que solo
  describía el caso Page), pero se agregó porque el mismo razonamiento
  ("rompe el mismo parseo total no-tolerante", ADR-002 sección 5 punto 2)
  aplica igual a Database/Row, y el costo de confirmarlo con git real
  también, en vez de solo asumirlo, es chico.

En ambos casos, confirmado con git real: `construirIndice` no cuelga, no
lanza, excluye únicamente el nodo en conflicto con un diagnóstico claro, y
el resto del árbol (un nodo testigo nunca tocado por ninguna rama) se sigue
indexando igual, sin ningún diagnóstico espurio. La lectura puntual
(`leerPage`/`leerDatabase`) sobre el mismo archivo da el mismo resultado.

## 2. Lo que no hizo falta implementar, y por qué

### 2.1. Export/import masivo

No se agregó ninguna operación separada de "exportar todo a archivos" o
"importar todo desde archivos". No falta: `docs/adr/001-persistencia.md`
predice explícitamente que, al elegir archivos planos como única fuente de
verdad, "el sync bidireccional deja de ser un problema de ingeniería...
la invariante 6 se cumple por construcción". No hay una base separada de la
cual "exportar" (cada `crearPage`/`actualizarRow`/etc. de T-0019 ya
persiste el archivo en el momento del cambio), y "importar todo" es
literalmente `construirIndice`, que ya existe desde T-0018 y ya se ejercita
end-to-end en `docs/gate-round-trip.md`. Agregar una operación separada de
export/import masivo habría inventado una segunda fuente de verdad ficticia
sobre una arquitectura que deliberadamente no tiene una — trabajo que el
ticket no pide y que ADR-001 rechazó explícitamente al descartar la opción
"SQLite como fuente de verdad + exportador".

### 2.2. CAS ante edición manual externa vs. "otro agente"

No se agregó ningún mecanismo nuevo. Ya está probado, con el mismo
mecanismo, en dos lugares: `packages/core/test/almacenamiento-escritura.test.ts`
(describe "escritura atómica: nunca queda un archivo a medio escribir...",
que simula un cambio externo con `Bun.write` directo antes de un intento de
escritura con hash viejo) y `packages/core/test/gate-round-trip.test.ts`
(describe "gate: archivo borrado externamente...", que usa `unlink` de
`node:fs` directo). El código mismo (`packages/core/src/almacenamiento/escritura.ts`
y ADR-002 sección 4) declara explícitamente que "otro agente" y "cualquier
cambio externo, tocado por el motor de sync o no" son la misma clase de
evento para el CAS: no hay ninguna rama de código que distinga el origen
del cambio, así que no hay ningún gap funcional que cerrar acá.

Se evaluó agregar un test de una línea, con el nombre puesto explícitamente
("edición manual externa, indistinguible de otro agente para el CAS"), que
reusaría exactamente el mismo patrón ya probado — la propia auditoría lo
marcó como opcional y cosmético, sin cerrar ningún gap funcional. Decisión
de este ticket: no agregarlo. Sería una duplicación de un test que ya existe
con datos distintos pero la misma aserción, sin agregar cobertura real —
"sin abstracciones (ni tests) que nadie pidió" cuando el gap ya está cerrado
por otro camino.

### 2.3. "Detección de cambios incremental" (framing original del ticket)

`docs/gate-round-trip.md` describe T-0012 como "detectar qué cambió en el
árbol de archivos desde la última vez que nido lo miró... y reconciliarlo".
Esa frase asume una noción de "última vez que lo miró" — un estado previo
cacheado contra el cual diffear. Esto **no aplica a v1**: ADR-001 elige
explícitamente lo contrario, el índice se reconstruye siempre desde cero,
"nunca cacheado" (ver también `packages/core/src/sync/reporte.ts`, que
hereda esta misma propiedad — cada llamada a `sincronizarWorkspace` es una
lectura fresca completa). No hay estado previo que reconciliar porque no
hay caché: cada invocación es una lectura fresca completa.

La "reconciliación" real ya la resuelve, para el caso de escritura
concurrente, el CAS por archivo (ADR-001 puntos 1–4, implementado en
T-0017), y para el caso de contenido inválido, el checklist de validación
(ADR-002 sección 5) — ambos ya implementados y ya probados antes de este
ticket, y confirmados de punta a punta con git real por la sección 1.2 de
este documento. No hay una tercera pieza de "detección de cambios
incremental" pendiente para v1. ADR-001 deja esto como escape hatch
explícito para el futuro ("si una Database crece mucho... invalidación
incremental por archivo"), no como requisito de este ticket — se documenta
acá para que la pregunta del framing original del ticket quede
explícitamente respondida, no abierta sin respuesta.

## 3. Evidencia

Desde la raíz del repo (`/Users/andrestobelem/ws/nido`):

- `bun test` — 281 tests, 0 fallas (incluye los 6 tests nuevos de
  `sync-reporte.test.ts` y los 2 de `sync-git-real.test.ts`, además de todo
  lo que T-0009 a T-0011 ya cubrían).
- `bunx tsc --noEmit -p tsconfig.json` — sin errores.

## 4. Archivos de este ticket

- `packages/core/src/sync/reporte.ts` (nuevo)
- `packages/core/test/sync-reporte.test.ts` (nuevo)
- `packages/core/test/sync-git-real.test.ts` (nuevo)
- `docs/gate-sync-bidireccional.md` (este documento)

Nada se tocó en `packages/core/src/formato/*.ts`,
`packages/core/src/almacenamiento/*.ts`, `packages/core/src/indice/construccion.ts`
ni `packages/core/src/crud/*.ts`: todos ya cumplían, antes de este ticket, lo
que T-0012 necesitaba de ellos.
