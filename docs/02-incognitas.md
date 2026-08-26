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

## I2 — Mecanismo concreto de sync bidireccional (resuelta)

**Resuelto** en `docs/adr/002-formato-de-archivos-y-sync.md`: híbrido por
tipo de nodo — Page en Markdown con un encabezado propio de campos fijos
(no YAML general, para no importar sus riesgos de ejecución de código y
no-determinismo), Database y Row en JSON canónico con orden de claves
fijo. Fija además la serialización determinista (fechas, números,
opcionales vs. `null`), el checklist de validación de entrada no confiable
en cada lectura (los cuatro casos de abajo), y que el CAS de
`docs/adr/001-persistencia.md` hashea los bytes crudos del archivo en
disco, nunca embebidos en el propio archivo.

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

## I4 — Subconjunto de tipos de Property (resuelta)

**Resuelto** en `docs/adr/003-tipos-de-property.md`: se confirma el
subconjunto de siete tipos sin cambios (texto, numero, select,
multi_select, fecha, checkbox, agente — `relación` ya estaba diferida a v2
por T-0003). No se agrega ningún tipo de los ~15 de Notion evaluados y no
propuestos (url/email/phone, status, created_time/created_by/
last_edited_time/last_edited_by, formula/rollup, files/media): cada uno se
resuelve con lo que ya existe (texto, campos de Page, autoría de git) o
comparte el mismo riesgo de sync bidireccional que ya aplazó `relación`.

**Pregunta original**: de los ~15 tipos de propiedad de Notion, ¿cuáles
aportan valor real a un consumidor agente? La propuesta inicial en
`docs/01-modelo-dominio.md` (texto, número, select, multi_select, fecha,
checkbox, relación, agente) es un punto de partida, no una decisión
cerrada.

## I5 — Expresividad de las Views (resuelta)

**Resuelto** en `docs/adr/004-expresividad-de-views.md`: operadores
agrupados por familia de tipo (escalar_comparable, texto, checkbox,
select, multi_select) más `vacio`/`no_vacio` universal; combinación AND/OR
con agrupación acotada a profundidad 2 (no arbitraria — el costo real de
traducción a SQL está en la familia de tipo y en el manejo de NULL por
operador, no en AND vs OR); View con nombre persiste en el archivo de su
Database (ya fijado por `docs/01-modelo-dominio.md`/ADR-001) y coexiste
con query ad-hoc por flags de CLI, ambas sobre el mismo validador/traductor.

**Pregunta original**: ¿qué operadores de filtro hacen falta (igualdad,
comparación, contiene, vacío/no-vacío)? ¿Se combinan solo con AND, o
también con OR y agrupación? ¿Una View se persiste con nombre propio, o es
siempre una query ad-hoc que se pasa por flags de la CLI?

## I6 — Forma del core compartido entre CLI y MCP (resuelta)

**Resuelto** en `docs/adr/005-core-compartido-cli-mcp.md`: el core es una
librería TypeScript en proceso (`packages/core`), invocada directamente por
la CLI y por el futuro servidor MCP — el MCP nunca envuelve subprocesos de
la CLI. El core expone operaciones tipadas sobre Workspace, Page, Database
(incluyendo el esquema de Property), Row y View (creación, lectura,
actualización, borrado, y resolución de View vía el índice de
`docs/adr/001-persistencia.md`, más reconstrucción explícita del índice); no
expone parsing de argv, la decisión entre salida humana o JSON, códigos de
salida de proceso, ni nada específico de terminal o de transporte MCP — eso
vive exclusivamente en la capa CLI (`packages/cli`) y, en su momento, en la
capa MCP (`packages/mcp`).

**Pregunta original**: la misión dice que CLI y MCP "comparten el mismo
core". ¿Eso significa una librería TypeScript en proceso, invocada por
ambas superficies? ¿O el MCP envuelve subprocesos de la CLI? La primera
opción parece más alineada con "sin estado" y con evitar reimplementar
lógica, pero faltaba decidir los límites exactos del core (qué expone, qué
no).

## I7 — Formato mínimo de ADR y su aprobación (resuelta)

**Resuelto** en `docs/adr/000-formato-de-adr.md`, durante Paso 0. No hacía
falta esperar a un ticket de research: era una decisión de minutos que
bloqueaba escribir el primer ADR de fondo (I1).

## I8 — Heurística de priorización del coordinador (resuelta)

**Resuelto** en `docs/coordinador.md` (no es una decisión de arquitectura
de nido, por eso no tiene ADR propio): candidatos son los tickets
`pendiente`/`bloqueado` con todas sus dependencias en `hecho`; entre esos,
gana el que más tickets desbloquea transitivamente; el empate se rompe por
`creadoEn` ascendente y, como último fallback, por `id`. Si no hay
candidatos, reporta el cuello de botella en vez de no decir nada.

**Pregunta original**: el Paso 4 describe un coordinador que "destraba y
prioriza" sin implementar. ¿Con qué regla concreta decide qué ticket
sigue? Sin una heurística explícita, "mirar el tablero y decidir" no es
reproducible entre corridas del coordinador.

## I9 — Migración de esquema en una Database con filas (resuelta)

**Resuelto** en `docs/adr/006-migracion-de-esquema.md`: agregar una
Property requerida a una Database que ya tiene Rows se rechaza
explícitamente (nunca se degrada en silencio a no-requerida); el camino
es agregarla como no-requerida y usar una operación explícita "promover a
requerida" que solo tiene éxito si todas las Rows ya tienen valor — si
falta alguna, falla sin tocar el esquema y reporta cuáles. Si la Database
no tiene Rows, se puede agregar directamente como requerida. Quitar una
Property nunca falla y nunca borra en silencio: los `PropertyValue`
huérfanos (y las referencias huérfanas de una View) quedan en el archivo,
excluidos de validación e índice, hasta una operación explícita de
limpieza (`purge-orphans`). Ambas rutas de escritura de esquema quedan
como una sola escritura CAS sobre el archivo de la Database (ADR-001),
nunca como una reescritura de conjunto sobre N Rows.

**Pregunta original**: la invariante 2 de `docs/01-modelo-dominio.md` exige
que toda Row tenga un `PropertyValue` por cada Property requerida de su
Database. ¿Qué pasa cuando se agrega una Property requerida a una
Database que ya tiene Rows? Por definición, esas Rows existentes violan
la invariante en el instante en que se agrega la columna. Lo mismo
aplica, en menor medida, a quitar una Property: ¿qué pasa con los
`PropertyValue` que quedan huérfanos?

Surgida de la revisión adversarial del plan
(`docs/sprints/00-revision-plan.md`). Bloqueaba formalizar el modelo en
tipos (paso 8 de `docs/03-plan.md`), no bloqueaba el ADR de persistencia.
