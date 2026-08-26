# Incógnitas

> Cada punto de esta lista requiere investigación antes de decidirse. Se
> convierten en tickets de research con una pregunta concreta a responder.
> Ninguna se resuelve en este documento.

## I1 — Modelo de persistencia (incluye I3: no se resuelven por separado) (resuelta)

**Resuelto** en `docs/adr/001-persistencia.md`: archivos planos
versionados en git como única fuente de verdad, con un índice derivado en
`bun:sqlite` (reconstruible, nunca fuente de verdad) para resolver Views.
Garantía de atomicidad entre agentes declarada: CAS por archivo
(comparar hash/mtime antes de escribir, abortar y reportar si cambió) +
escritura vía write-then-rename, sin locking distribuido.

**Pregunta**: ¿git-as-db, SQLite, o archivos planos + índice?

Evaluar contra: consultabilidad (filtros y orden de una View), concurrencia
entre agentes, historial, simplicidad, y sobre todo el requisito no
negociable de sync bidireccional con el repo. Decisión obligatoria vía ADR
en `docs/adr/` (formato definido en `docs/adr/000-formato-de-adr.md`).

**Tras la revisión adversarial del plan** (`docs/sprints/00-revision-plan.md`):
I3 (concurrencia entre agentes) no es una incógnita separada que se resuelve
"después". El ADR de I1 tiene que declarar, como criterio de aceptación
explícito, qué garantía de atomicidad da el storage elegido cuando dos
agentes escriben el mismo objeto a la vez. La garantía mínima aceptable en
v1 es detectar-y-reportar el conflicto más una escritura atómica (por
ejemplo, escribir a un archivo temporal y renombrar) — no locking
distribuido real. Si el ADR no responde esto, no está completo.

## I2 — Mecanismo concreto de sync bidireccional

**Pregunta**: ¿qué formato de archivo representa una Page o una Row de forma
estable y diffable? (¿Markdown con frontmatter? ¿JSON? ¿los dos, según el
tipo de nodo?) ¿Cómo se resuelve un conflicto cuando el archivo se edita a
mano mientras la base cambió en paralelo?

Depende de I1.

**Extendida tras la revisión adversarial**: además del conflicto de edición
concurrente, I2 tiene que responder qué hace el importador ante entrada no
confiable, porque el árbol del repo puede llegar a cualquier estado vía
`git checkout`, merge o edición manual sin pasar por el motor de sync:

- Un archivo con `parent_id` que referencia un nodo que no existe.
- Un `id` falsificado o duplicado (por ejemplo, copiar el archivo de una Row
  sin cambiar su frontmatter, lo que fusionaría dos filas distintas).
- Un path que intenta escapar del árbol del repo.
- Un árbol resultante de una operación de git que nunca pasó por el
  importador (rebase, merge, cherry-pick).

## I3 — (fusionada con I1, ver arriba)

## I4 — Subconjunto de tipos de Property

**Pregunta**: de los ~15 tipos de propiedad de Notion, ¿cuáles aportan valor
real a un consumidor agente? La propuesta inicial en
`docs/01-modelo-dominio.md` (texto, número, select, multi_select, fecha,
checkbox, relación, agente) es un punto de partida, no una decisión cerrada.

## I5 — Expresividad de las Views

**Pregunta**: ¿qué operadores de filtro hacen falta (igualdad, comparación,
contiene, vacío/no-vacío)? ¿Se combinan solo con AND, o también con OR y
agrupación? ¿Una View se persiste con nombre propio, o es siempre una query
ad-hoc que se pasa por flags de la CLI?

## I6 — Forma del core compartido entre CLI y MCP

**Pregunta**: la misión dice que CLI y MCP "comparten el mismo core". ¿Eso
significa una librería TypeScript en proceso, invocada por ambas
superficies? ¿O el MCP envuelve subprocesos de la CLI? La primera opción
parece more alineada con "sin estado" y con evitar reimplementar lógica, pero
falta decidir los límites exactos del core (qué expone, qué no).

## I7 — Formato mínimo de ADR y su aprobación (resuelta)

**Resuelto** en `docs/adr/000-formato-de-adr.md`, durante Paso 0. No hacía
falta esperar a un ticket de research: era una decisión de minutos que
bloqueaba escribir el primer ADR de fondo (I1).

## I8 — Heurística de priorización del coordinador

**Pregunta**: el Paso 4 describe un coordinador que "destraba y prioriza"
sin implementar. ¿Con qué regla concreta decide qué ticket sigue? ("el más
antiguo sin bloqueos", "el que más tickets desbloquea", "el que el PM marcó
como foco del sprint"...) Sin una heurística explícita, "mirar el tablero y
decidir" no es reproducible entre corridas del coordinador.

## I9 — Migración de esquema en una Database con filas

**Pregunta**: la invariante 2 de `docs/01-modelo-dominio.md` exige que toda
Row tenga un `PropertyValue` por cada Property requerida de su Database.
¿Qué pasa cuando se agrega una Property requerida a una Database que ya
tiene Rows? Por definición, esas Rows existentes violan la invariante en el
instante en que se agrega la columna. Hace falta una regla: ¿se rellenan
con un valor por defecto, la Property nueva no puede ser requerida si la
Database ya tiene filas, o se marca la Database entera como inconsistente
hasta que se resuelva a mano? Lo mismo aplica, en menor medida, a quitar una
Property: ¿qué pasa con los `PropertyValue` que quedan huérfanos?

Surgida de la revisión adversarial del plan
(`docs/sprints/00-revision-plan.md`). Bloquea formalizar el modelo en tipos
(paso 8 de `docs/03-plan.md`), no bloquea el ADR de persistencia.
