# ADR-003: Subconjunto de tipos de Property

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

`docs/02-incognitas.md` (I4) exige confirmar el subconjunto de tipos de
`Property` propuesto en `docs/01-modelo-dominio.md` — `texto`, `numero`,
`select`, `multi_select`, `fecha`, `checkbox`, `agente` (`relacion` ya
quedó diferida a v2, confirmado en Sprint 1, T-0003) — contra una sola
pregunta: ¿cada uno aporta valor real a un consumidor **agente** (CLI-first,
sin UI visual, salida JSON, determinista — `docs/00-entendimiento.md`), o
sobra/falta alguno de los ~15 tipos de propiedad que tiene Notion?

Esta decisión no puede reabrir lo que `docs/adr/002-formato-de-archivos-y-sync.md`
ya fijó como serialización concreta para varios de estos tipos: `numero`
rechaza en validación de escritura `NaN`/`Infinity`/`-Infinity`/`-0`;
`fecha` se guarda como string `"YYYY-MM-DD"` opaco, nunca reparseado a
`Date`; `select`/`multi_select` referencian opciones por `id` estable
(`config.opciones`), y `multi_select` además ordena lexicográficamente y
deduplica ese array antes de escribir. Este ADR toma esas reglas como
restricción ya cerrada, no como algo a discutir.

Para evaluar si el subconjunto de siete está completo, hay que mirar los
tipos de Notion que **no** están propuestos y preguntar si el consumidor
agente los necesita: `person`/`people`, `url`, `email`, `phone`, `files &
media`, `formula`, `relation`, `rollup`, `status`, `created_time`,
`created_by`, `last_edited_time`, `last_edited_by`, `button`. `relation` ya
está resuelto (diferido, T-0003) y queda fuera de este análisis.

## Decisión

**Se confirma el subconjunto de siete tipos, sin agregar ni quitar
ninguno**: `texto`, `numero`, `select`, `multi_select`, `fecha`,
`checkbox`, `agente`.

Razón concreta por tipo, con la barra alta de "¿un consumidor agente lo usa
para algo que no puede hacer con otro tipo del subconjunto?":

1. **texto**: contenedor de datos libres que un agente necesita registrar
   (referencias externas, notas cortas) sin vocabulario cerrado. Es el
   tipo base; todo lo demás es una especialización con más estructura o
   más validación.
2. **numero**: cantidades, puntajes, conteos. Valor concreto en Views
   (I5, todavía en curso este sprint): permite `WHERE prioridad > 3` real
   contra el índice de ADR-001, algo que `texto` no soporta sin coerción.
3. **select**: clasificación de un solo valor sobre vocabulario cerrado.
   Exactamente el patrón que ya usa `packages/tickets/src/types.ts`
   (`Estado`, una unión fija de cinco valores) — pero ahí está hardcodeado
   en TypeScript porque tickets tiene un solo esquema fijo. Una Database de
   nido no tiene un esquema fijo de antemano: `select` es lo que le permite
   a cualquier agente declarar su propio "estado" (o cualquier
   clasificación cerrada) sin tocar código.
4. **multi_select**: clasificación de **varios** valores simultáneos sobre
   vocabulario cerrado (etiquetas, áreas afectadas). Es un tipo distinto de
   `select` en naturaleza, no una variante cosmética: una fila que
   necesita dos etiquetas a la vez no puede expresarlo con `select` sin
   perder una de las dos. Tampoco es reducible a `texto` con valores
   separados por coma sin perder exactamente lo que ADR-002 ya construyó a
   propósito (ids estables de opción, orden canónico, dedup) — bajar a
   `texto` tiraría ese trabajo ya hecho sin necesidad.
5. **fecha**: vencimientos, fechas de referencia. Mismo argumento que
   `numero`: habilita `WHERE vencimiento < hoy` y orden real en una View,
   que `texto` no da sin parseo ad-hoc en cada consumidor.
6. **checkbox**: flag binario (bloqueado, revisado, urgente). Es el tipo
   más barato de los siete — boolean nativo de JSON, sin `config`, sin
   reglas de validación más allá de "es boolean" — y cubre un caso de uso
   real y frecuente (evidencia: la propia herramienta de tickets usa un
   patrón equivalente de flags de estado). No hay razón de costo para
   sacarlo.
7. **agente**: identifica al responsable/asignado de una fila. El valor
   real de que sea un tipo **distinto** de `texto`, aunque su forma en
   runtime sea idéntica (string), no está en más estructura — no hay
   entidad `Agent` en v1 (`docs/01-modelo-dominio.md` ya lo deja explícito)
   — sino en la **etiqueta semántica**: cualquier tooling genérico (el
   coordinador de I8/T-0007, en curso este mismo sprint, o un futuro
   comando `nido db query --agente-actual`) puede recorrer el esquema de
   **cualquier** Database del workspace y encontrar "la columna de
   asignación" por tipo, sin conocer de antemano si esa Database la llamó
   `asignado_a`, `owner` o `responsable`. Dos Databases que usaran `texto`
   para lo mismo serían indistinguibles por tipo — perderían justo esa
   capacidad de introspección genérica sin ahorrar nada, porque el costo
   de implementar `agente` es idéntico al de `texto` (mismo dato en
   runtime).

No se agrega ningún tipo de los ocho evaluados y no propuestos (detalle y
motivo de descarte de cada uno en "Alternativas consideradas").

## Alternativas consideradas

Alternativas al subconjunto de siete (no al ADR en sí, que es una
confirmación):

- **Sacar `agente` y usar `texto` con una convención de nombre de columna**:
  descartada porque pierde la introspección genérica de esquema (punto 7
  arriba) sin ahorrar ningún costo de implementación — `agente` y `texto`
  son el mismo dato en runtime, así que no hay trade-off que justifique
  sacarlo.
- **Ampliar `agente` a lista de agentes** (multi-valor, análogo a
  `multi_select`): descartada por falta de un caso de uso concreto en este
  sprint, y porque el sistema comparable más cercano en este mismo repo
  (`packages/tickets/src/types.ts`, `asignadoA: string | null`) es
  single-value. Si aparece una necesidad real de multi-asignación, se
  promueve a lista — mismo patrón que la nota ya existente en
  `docs/01-modelo-dominio.md` sobre promover `agente` a entidad propia si
  hiciera falta más que un identificador. No es una puerta cerrada, es no
  pagar el costo hasta tener evidencia.
- **Agregar `url`/`email`/`phone` como tipos distintos de `texto`**:
  descartada porque la única diferencia real de Notion frente a `texto`
  (renderizado como link/mail clickeable) no existe en un consumidor
  CLI/JSON sin UI visual (`docs/00-entendimiento.md`, "no hace falta
  interfaz gráfica"), y una validación de formato, si hiciera falta, se
  puede hacer a nivel de aplicación sin necesitar un tipo de `Property`
  nuevo. Agregar un tipo que no cambia nada en runtime ni en filtro de
  View es proliferación de tipos sin beneficio, en contra de la regla de
  `docs/00-entendimiento.md` ("gana lo que acerque a nido a estar usable").
- **Agregar `status`** (equivalente de Notion a `select` con agrupación
  visual de opciones en columnas, para un tablero kanban): descartada
  porque toda su ventaja sobre `select` es de presentación visual, y nido
  es explícitamente CLI-first sin UI visual. `select` ya cubre la
  clasificación de un solo valor; `status` sería un duplicado funcional.
- **Agregar `created_time`/`created_by`/`last_edited_time`/`last_edited_by`
  como Property**: descartada porque ya están cubiertos, sin duplicar
  dato, en dos lugares distintos del diseño ya aceptado: `creado_en`/
  `actualizado_en` a nivel de `Page` (heredado por toda `Row`, según
  `docs/01-modelo-dominio.md`) cubren los dos primeros, y la autoría
  (`created_by`/`last_edited_by`) ya la da git gratis —
  `docs/adr/001-persistencia.md` es explícito: "el historial de auditoría
  es casi gratis: `git log`... dan autor". Agregarlos como `Property`
  crearía una segunda copia del mismo dato con riesgo real de
  desincronizarse de la fuente (el commit real), sin necesidad.
- **Agregar `formula`/`rollup`, acotados a expresiones intra-fila (sin
  referencia cruzada)**: descartada porque, aun acotados, exigen un
  lenguaje de expresiones propio con su propio parser y su propio
  checklist de entrada no confiable — exactamente la clase de riesgo que
  `docs/adr/002-formato-de-archivos-y-sync.md` evitó a propósito al no
  usar un motor YAML general para el encabezado de `Page` ("sin motor de
  lenguaje que desactivar, no hay superficie... que auditar"). `rollup` en
  particular no tiene sentido sin `relacion`, que ya está diferida a v2 por
  el mismo criterio de riesgo (T-0003). El criterio de éxito de la misión
  (`docs/00-entendimiento.md`, "criterio de éxito, en concreto") no pide
  columnas calculadas.
- **Agregar `files`/`media`**: descartada por el mismo criterio que ya
  excluyó "bloques ricos de contenido" en `docs/01-modelo-dominio.md`
  ("Lo que este modelo deja afuera, a propósito"): un adjunto binario
  exige resolver cómo se materializa en el ciclo de sync bidireccional
  (`docs/00-entendimiento.md`, requisito no negociable), que
  `docs/adr/002-formato-de-archivos-y-sync.md` no cubre — solo define
  Markdown/JSON de texto. No es un caso ya resuelto por el formato de
  archivo elegido, es una extensión real que ningún ticket de este sprint
  pidió.
- **Diferir también `checkbox` a v2, junto con `relacion`, por
  minimalismo**: descartada porque, a diferencia de `relacion`/`formula`/
  `files`, `checkbox` no tiene ningún riesgo de sync ni de validación que
  diferirlo evite — es un boolean nativo de JSON, ya cubierto sin trabajo
  adicional por el checklist de ADR-002. Diferirlo no ahorra nada y sí
  sacaría del modelo un caso de uso barato y frecuente.

## Consecuencias

**Más fácil:**

- El subconjunto queda cerrado en siete tipos, los mismos que
  `docs/adr/002-formato-de-archivos-y-sync.md` ya cubre en su checklist de
  validación de `PropertyValue` (sección 5, punto 8) y en sus reglas de
  serialización (sección 3). Este ADR no exige ninguna extensión de
  ADR-002: ningún tipo nuevo, ninguna regla de serialización nueva.
- Queda una regla simple y verificable para I8 (heurística del
  coordinador) y para cualquier tooling futuro: el tipo `agente` en el
  esquema de cualquier Database es, por construcción, "la columna de
  asignación" — no hace falta convención de nombres ni configuración por
  Database.
- `config` de `Property` (`docs/01-modelo-dominio.md`) queda con contenido
  real solo para `select`/`multi_select`; para los otros cinco tipos está
  ausente, consistente con la regla ya fijada en ADR-002 ("campo ausente =
  no aplica a este objeto").

**Más difícil (costo aceptado explícitamente):**

- Casos reales de URL/email validado, adjuntos binarios, o
  multi-asignación por fila quedan sin tipo dedicado en v1. Se resuelven
  con `texto` (URL/email, sin validación de formato) o quedan bloqueados
  hasta una revisión de este ADR (adjuntos, multi-agente) si aparece
  evidencia concreta de necesidad — no se pagan por adelantado.
- `formula`/`rollup` quedan diferidos junto con `relacion`. Si una futura
  revisión de v2 revierte el recorte de `relacion` (T-0003), este ADR
  probablemente necesita revisarse en el mismo momento: `rollup` en
  particular no tiene sentido sin `relacion`.
- Dos Databases distintas pueden seguir modelando el mismo concepto de
  negocio con tipos distintos si un agente decide usar `texto` en vez de
  `select`/`agente` donde correspondía — este ADR no impone esa disciplina
  a nivel de validación (no hay regla de "esta Property debería ser de
  este tipo"), solo deja disponible el tipo correcto para quien defina el
  esquema.

## Propuestas de cambio a documentos compartidos

Este ADR no edita `docs/01-modelo-dominio.md` ni `docs/02-incognitas.md`
directamente (regla del sprint, ver `docs/sprints/03-planning.md`). El
texto exacto a aplicar en esos dos archivos está en la respuesta de T-0004,
no en este archivo.
