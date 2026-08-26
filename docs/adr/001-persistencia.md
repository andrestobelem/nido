# ADR-001: Modelo de persistencia

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

`docs/02-incognitas.md` (I1, que incluye I3) exige decidir el modelo de
persistencia de nido evaluado contra, en este orden de prioridad: (1) el
requisito no negociable de sync bidireccional repo↔base como propiedad
estructural del sistema (`docs/00-entendimiento.md`), (2) qué garantía de
atomicidad existe cuando dos agentes escriben el mismo objeto a la vez —
criterio de aceptación explícito exigido por la revisión adversarial del
plan (`docs/sprints/00-revision-plan.md`), con mínimo aceptable
"detectar-y-reportar conflicto + escritura atómica, sin locking
distribuido real", (3) consultabilidad de una View (filtros y orden
multi-campo) sobre una Database con muchas Rows, (4) historial de
auditoría, y (5) simplicidad de implementación sobre Bun.

Se evaluaron tres opciones de forma independiente: **git-as-db** (el árbol
de trabajo es la fuente de verdad, cada cambio es un commit, las queries se
resuelven parseando el árbol), **SQLite como fuente de verdad**
(`bun:sqlite` con un exportador/importador explícito hacia el repo) y
**archivos planos + índice derivado** (los archivos son la única fuente de
verdad, un índice en `bun:sqlite` reconstruible y descartable resuelve las
queries). Las tres evaluaciones coincidieron en un punto: ninguna opción
cumple los cinco criterios gratis; cada una traslada el costo a un lugar
distinto. La diferencia decisiva está en **dónde** cae ese costo respecto
del criterio no negociable (1): en `SQLite como fuente de verdad`, cae
directamente sobre (1) — el sync se convierte en disciplina de proceso
("se reimporta antes de contar como cambio real"), no en propiedad
estructural. En `git-as-db` y en `archivos planos + índice`, (1) se cumple
por construcción (no hay una segunda fuente de verdad que reconciliar) y el
costo cae sobre (3) y (5) — que son más baratos de pagar explícitamente que
(1), justamente por ser el criterio no negociable.

## Decisión

Los **archivos planos son la única fuente de verdad**, versionados en git.
Cada Page y cada Row vive en su propio archivo; una Database (con sus
Properties y sus Views, que según `docs/01-modelo-dominio.md` se
materializan dentro del archivo de su Database, no en archivo propio) vive
en un solo archivo. El formato exacto de serialización (Markdown con
frontmatter, JSON, o una combinación según el tipo de nodo) es una decisión
de I2 y no se fija en este ADR.

Un **índice derivado en `bun:sqlite`** resuelve las Views: se reconstruye
determinísticamente a partir de los archivos, nunca contiene información
que no esté ya en ellos, y por lo tanto nunca es fuente de verdad. Si el
índice se corrompe, queda desactualizado o simplemente no existe (primera
invocación de la CLI), se descarta y se reconstruye sin riesgo de pérdida
de datos. Toda resolución de una View (filtros y orden multi-campo) pasa
por este índice vía `WHERE`/`ORDER BY`; ninguna View se resuelve leyendo y
filtrando en JS el listado completo de archivos de una Database en cada
query (el patrón que hoy usa `listar()` en
`packages/tickets/src/store.ts`, aceptable para un backlog de decenas de
tickets pero no para "una Database con muchas Rows").

**Garantía de atomicidad entre agentes** (criterio de aceptación exigido
por I1/I3), declarada explícitamente como exige
`docs/sprints/00-revision-plan.md`:

1. **Creación** de un objeto nuevo: reserva de id por creación exclusiva de
   archivo (`open(path, "wx")`) con reintento ante `EEXIST`, igual al
   patrón ya probado en `packages/tickets/src/id.ts`.
2. **Actualización** de un objeto existente: al leer, se captura un
   hash (o mtime+tamaño) del archivo. Antes de confirmar la escritura, se
   vuelve a leer ese mismo dato del archivo en disco y se compara contra
   el capturado. Si cambió, se **aborta y se devuelve un error tipado de
   conflicto** — nunca se mezcla ni se sobrescribe en silencio.
3. **Escritura física**: siempre a un archivo temporal en el mismo
   directorio (mismo filesystem, para que el `rename` sea atómico a nivel
   POSIX) seguido de `rename` al path final. Nunca se escribe en el lugar
   final directamente.
4. **Granularidad del conflicto = un archivo completo.** Dos agentes
   creando Rows distintas de la misma Database (archivos distintos) no
   colisionan. Dos agentes editando la misma Row, o editando Views
   distintas de la misma Database, o uno cambiando el esquema de
   Properties mientras otro agrega una View a esa misma Database, sí
   colisionan porque comparten archivo — y deben recibir el conflicto
   reportado, no una fusión silenciosa.

Esto es exactamente el mínimo aceptado en `docs/sprints/00-revision-plan.md`
(detectar-y-reportar + escritura atómica), sin locking distribuido. No es
gratis por elegir "archivos": hay que implementarlo en cada función de
escritura sobre un objeto existente, no solo en la creación.

La validación de entrada no confiable que exige I2 extendida (`parent_id`
colgante, `id` falsificado o duplicado, path traversal, árbol tocado por
git fuera del motor de sync vía rebase/merge/cherry-pick/checkout) es
responsabilidad de I2, pero la elección de este ADR la hace estructuralmente
necesaria en **cada lectura**, no solo en un paso de importación aparte:
como no hay una base separada que ya haya validado el contenido al
importarlo, cualquier lectura de un archivo tiene que tratarlo como
entrada no confiable.

## Alternativas consideradas

- **git-as-db, parseando el árbol directamente (sin índice derivado)**: se
  descartó porque paga el costo del criterio 3 (consultabilidad) sin
  necesidad. Evidencia externa concreta: Logseq (modelo de archivo muy
  cercano al de nido) tardaba 4–10 minutos en cargar grafos de más de 2000
  páginas y migró su v2 a SQLite por esto; Decap/Netlify CMS documenta un
  techo práctico de ~10k entradas leyendo archivo por archivo; Dolt ("git
  para datos") tuvo que construir un storage engine propio (Prolly Trees)
  en vez de usar blobs de git sin más, porque git "fue diseñado para
  versionar archivos como texto, no para queries/diffs eficientes de datos
  estructurados". Además, Bun no tiene un binding de git de primera clase
  — obliga a shell-out (`Bun.$`) o a una librería de git en JS, saliendo
  de las APIs que `CLAUDE.md` marca como preferidas. Y si el diseño
  delegara en el merge automático de texto de git sobre los archivos de
  contenido (en vez de una disciplina explícita de fast-forward-only), dos
  agentes editando la misma Row podrían terminar en un merge silencioso de
  `PropertyValue` distintos, o en un archivo con marcadores de conflicto
  que rompe el parser en la siguiente lectura — patrón documentado en el
  ecosistema de Obsidian Git. Sumarle un índice derivado resuelve (3) sin
  perder nada de (1), que es exactamente la opción elegida.
- **SQLite como fuente de verdad + exportador/importador explícito hacia
  el repo**: se descartó porque falla el criterio no negociable como
  *propiedad estructural* y lo convierte en disciplina de proceso: la
  edición de un archivo "no cuenta" hasta que se reimporta, y si el
  exportador vuelve a materializar el mismo archivo sin comparar contra su
  estado en disco, una edición manual se sobrescribe en silencio (lost
  update) — justo la clase de bug que el criterio 1 busca eliminar.
  Evidencia externa concreta: Logseq migró su v2 a "SQLite es la fuente
  canónica" y su propia documentación dice explícitamente que con la base
  como verdad "ya no se editan los archivos subyacentes a mano" como en el
  formato de archivos, y advierte riesgo real de pérdida de datos
  recomendando backups manuales — prueba de que ni un equipo enfocado en
  este problema logró que "DB es la verdad + archivos editables a mano ida
  y vuelta" sea gratis o seguro por diseño. Es más fuerte que la opción
  elegida en el criterio 3 (SQL nativo sin capa de índice que mantener) y
  en el criterio 2 (transacciones ACID reales sobre varios objetos a la
  vez, más fuertes que un CAS por archivo), pero esa ventaja no compensa
  fallar el criterio que la propia misión declara no negociable.

## Consecuencias

**Más fácil:**

- El sync bidireccional deja de ser un problema de ingeniería: no hay una
  segunda fuente de verdad que pueda desviarse de los archivos, así que la
  invariante 6 de `docs/01-modelo-dominio.md` se cumple por construcción.
- El historial de auditoría es casi gratis: `git log`, `git log -p -- <path>`
  y `git blame` sobre los mismos archivos que son fuente de verdad dan
  autor, timestamp y diff de cada cambio, sin tabla de auditoría propia.
- Consultar una View es SQL real (`WHERE`/`ORDER BY` con índices) contra el
  índice derivado, no un evaluador de filtros escrito a mano.
- El motor de persistencia usa únicamente las APIs que `CLAUDE.md` marca
  como preferidas en Bun (`Bun.file`/`Bun.write`, creación exclusiva con
  `open(path, "wx")`, `bun:sqlite` solo para el índice) — sin dependencias
  externas ni proceso de servidor que operar.
- Si el índice se corrompe o queda desactualizado, el remedio es tirarlo y
  reconstruirlo desde los archivos: no hay ningún dato que pueda perderse
  ahí, porque el índice nunca tuvo información que los archivos no
  tuvieran ya.

**Más difícil (costo aceptado explícitamente):**

- **No hay locking distribuido real en v1.** La garantía es
  detectar-y-reportar conflicto (comparar hash/mtime antes de confirmar)
  más escritura atómica por archivo (write-then-rename) — no una
  transacción real que cubra varios archivos a la vez. Un cambio que por
  su naturaleza toca más de un archivo (por ejemplo, una migración de
  esquema que reescribe N Rows de una Database — ver I9, todavía abierta)
  no es atómico como conjunto: cada archivo individual sí lo es, el
  conjunto no. Este es el riesgo que
  `docs/sprints/00-revision-plan.md` acepta explícitamente para el tamaño
  de equipo previsto (un agente operando por vez como caso central,
  concurrencia probada pero no crítica); si la escala de agentes
  concurrentes creciera, hace falta revisar este ADR.
- El CAS + write-then-rename hay que implementarlo en cada función que
  actualiza un objeto existente, no solo en la creación. `packages/tickets`
  resuelve su propia concurrencia con un mecanismo distinto — un mutex
  global por directorio (`conLock`) que serializa toda escritura, más
  write-then-rename — válido para su storage, que `docs/03-plan.md`
  declara explícitamente independiente del de nido. Ese mecanismo no se
  adopta tal cual aquí: un mutex único serializaría también a dos agentes
  editando objetos sin relación entre sí (una Page y una Row de otra
  Database no tienen por qué bloquearse), justo el paralelismo que el CAS
  por archivo preserva. La escritura de nido debe implementar su propio
  CAS por archivo, no reutilizar el mutex de tickets.
- El serializador de cada tipo de archivo tiene que ser canónico y
  determinista (mismo objeto → mismos bytes) para que un ciclo
  repo→base→repo sin cambios no genere diffs de git espurios; esto se
  decide en I2, no en este ADR, pero queda como dependencia directa suya.
- La validación de entrada no confiable que exige I2 extendida corre en
  cada lectura, no en un paso de importación aislado — es más superficie
  a cubrir, precisamente porque no hay una base separada que ya la haya
  validado antes.
- Reconstruir el índice desde cero en cada invocación de la CLI es
  aceptable para el volumen esperado de un workspace de nido (Databases de
  cientos a pocos miles de Rows), pero no es una garantía de escala
  ilimitada: si algún día una Database crece mucho, el camino de escape es
  invalidación incremental por archivo (comparar mtime/hash contra el
  índice persistido), no un cambio de arquitectura.
- El layout exacto del repo (workspace de nido en un directorio propio del
  mismo repo, o en un repo de datos separado, para no mezclar commits de
  contenido generado por agentes con el historial de desarrollo de la
  herramienta) queda como detalle de implementación de I2, no se fija
  aquí.
