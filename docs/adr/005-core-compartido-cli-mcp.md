# ADR-005: Core compartido entre CLI y MCP

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

`docs/00-entendimiento.md` fija, como parte de la misión, que "CLI y MCP son
dos superficies del mismo core: ninguna reimplementa la lógica de la otra".
`docs/02-incognitas.md` (I6) deja sin resolver **cómo** se cumple eso en la
práctica: ¿una librería TypeScript en proceso, invocada directamente por
ambas superficies? ¿O el servidor MCP envuelve subprocesos de la CLI (por
ejemplo, `Bun.$` o `child_process.spawn` sobre el binario `nido`, parseando
su salida `--json`)? Y en cualquiera de los dos casos, faltan los límites
exactos: qué operaciones expone ese core y qué queda excluido de él por ser
específico de una superficie.

Esto no es una decisión nueva desde cero: `packages/tickets` ya resuelve el
mismo problema de layout para su única superficie hoy (la CLI), separando
`store.ts` (operaciones sobre `Ticket`, sin saber nada de argv ni de
formato de salida) de `cli.ts` (parseo de argv, `--json` vs. texto humano,
código de salida de proceso) y `format.ts` (solo el formato humano). La
diferencia con nido es que nido declara *desde el plan* (`docs/03-plan.md`,
puntos 7, 10 y 12) que va a tener dos superficies, no una — así que el corte
entre "core" y "superficie" no es un detalle de implementación interno de
la CLI, es un contrato que otro paquete (el futuro MCP) también va a
consumir. Vale la pena fijarlo explícitamente ahora, antes de que exista
código de MCP que dependa de una forma implícita del límite.

## Decisión

### 1. El core es una librería TypeScript en proceso. El MCP nunca envuelve subprocesos de la CLI.

CLI y MCP importan y llaman funciones del mismo paquete TypeScript
(`packages/core`, análogo en rol a `packages/tickets/src/store.ts` pero
como paquete propio de `@nido/*` porque, a diferencia de tickets, tiene más
de un consumidor). El futuro paquete `packages/mcp` depende de
`packages/core` exactamente como `packages/cli` — vía `import`, en el mismo
proceso — nunca haciendo `Bun.$`/`spawn` sobre el binario `nido` para
después parsear su stdout. Se prefiere esta opción sobre la alternativa
porque:

- Es la única de las dos que hace cierta la frase de
  `docs/00-entendimiento.md`: si el MCP invocara la CLI como subproceso, la
  "lógica" que el MCP ejecuta en la práctica sería "saber manejar la CLI",
  no la lógica de dominio — exactamente la reimplementación implícita que
  esa frase descarta, solo que a través de un proceso hijo en vez de código
  duplicado.
- Preserva tipos y errores estructurados de punta a punta. Un subproceso
  solo puede devolver bytes (stdout/stderr + código de salida); el MCP
  tendría que volver a parsear el JSON de salida de la CLI y reconstruir a
  mano qué clase de error fue (¿conflicto de escritura? ¿nodo no
  encontrado? ¿validación?) a partir de un string de mensaje, en vez de
  recibir directamente la excepción tipada que el core ya lanza.
- Coincide con "sin estado" (`docs/00-entendimiento.md`): cada llamada del
  MCP a una función del core es una operación completa en sí misma, sin
  proceso hijo que administrar, sin buffers de stdout que acumular, sin
  código de salida que interpretar.
- Evita pagar dos veces el costo de arranque y serialización (argv → CLI →
  stdout JSON → parseo en MCP) por cada operación, en una superficie (MCP)
  pensada para que un agente la llame repetidamente dentro de un mismo
  workflow.

### 2. Qué expone el core

Operaciones tipadas — reciben un objeto de parámetros tipado, devuelven un
objeto de dominio tipado o lanzan una excepción tipada (mismo patrón que
`TicketNoEncontrado`/`DependenciaInvalida`/`IdInvalido` en
`packages/tickets/src/store.ts`, extendido con lo que ya exige
`docs/adr/001-persistencia.md` y `docs/adr/002-formato-de-archivos-y-sync.md`:
un error tipado de conflicto de escritura, y el checklist de validación de
entrada no confiable corriendo en cada lectura) — sobre estas entidades:

- **Workspace**: obtener el workspace (v1 es singleton — no hay `crear` ni
  `listar`, solo resolución de la raíz configurada).
- **Page**: crear, obtener por id, actualizar (`titulo`, `cuerpo`,
  `parent_id` — mover de lugar en el árbol), borrar, listar hijos directos
  de un nodo.
- **Database**: crear (con su esquema inicial de `Property`), obtener,
  actualizar esquema (agregar/quitar/editar una `Property` — sujeto a lo
  que resuelva I9, no bloqueado por esta ADR), borrar.
- **Property**: no es una entidad con operaciones propias de alto nivel;
  se gestiona como parte de las operaciones de esquema de su Database
  (arriba). El core no expone un endpoint "Property suelta" fuera de una
  Database, porque el modelo (`docs/01-modelo-dominio.md`) no la define
  fuera de ese contexto.
- **Row**: crear (con sus `PropertyValue`), obtener por id, actualizar
  valores, borrar, listar filas de una Database (sin filtro — eso es View).
- **View**: crear, actualizar, borrar (persistidas dentro del archivo de su
  Database, según `docs/01-modelo-dominio.md` y ADR-002) y **resolver**:
  ejecutar una View (guardada, o una consulta ad-hoc con la misma forma de
  filtros/orden — la decisión de si toda consulta debe nombrarse o puede
  ser ad-hoc es de I5, no de esta ADR) contra el índice derivado de
  `docs/adr/001-persistencia.md`, devolviendo las Rows resultantes ya
  tipadas.
- **Mantenimiento del índice**: una operación explícita de reconstrucción
  del índice derivado (`docs/adr/001-persistencia.md`: "si el índice se
  corrompe... se descarta y se reconstruye") vive en el core, no en la CLI,
  porque el MCP también necesita poder dispararla o beneficiarse de que el
  core la ejecute de forma transparente antes de resolver una View.

Cada función del core recibe explícitamente la raíz del workspace (path) u
otra configuración de conexión como parámetro — nunca lee variables de
entorno ni `Bun.argv` por su cuenta. Quién resuelve esa raíz a partir de
`NIDO_WORKSPACE_DIR`, un flag de CLI, o la configuración de arranque del
servidor MCP es decisión de cada superficie, no del core (mismo principio
que ya separa `dirTickets()` — hoy mezclado en `cli.ts` de tickets, ver
"Consecuencias" — de `TicketStore`).

### 3. Qué NO expone el core

Vive exclusivamente en la capa de superficie (CLI hoy; MCP cuando exista),
nunca en `packages/core`:

- **Parsing de argv**: sintaxis de flags (`--titulo valor`, `--flag=valor`,
  posicionales, `--json` como flag global), igual que hoy
  `parseArgs`/`ESPECS` en `packages/tickets/src/cli.ts`. El core no sabe
  qué es un flag.
- **Formato de salida humana vs. JSON**: el core devuelve objetos de
  dominio tipados, no strings preformateados para terminal ni un choque
  binario "humano u objeto". Decidir entre imprimir con formato humano
  (como `formatearTicket`/`formatearLista` en
  `packages/tickets/src/format.ts`) o serializar a JSON es responsabilidad
  de quien consume el resultado — la CLI en un caso, el MCP en otro (que
  arma su propio `content` de respuesta de herramienta a partir del mismo
  objeto tipado, sin pasar por un formateador de texto humano).
- **Cualquier cosa específica de terminal**: código de salida de proceso
  (`process.exit`), lectura de `stdin`/escritura a `stdout`/`stderr`,
  color/ANSI, mensajes de progreso pensados para lectura humana en curso
  ("reintentando... intento 2/3"). El core puede reintentar internamente
  (por ejemplo, reserva de id con reintento ante `EEXIST`, como
  `packages/tickets/src/id.ts`), pero no imprime nada mientras lo hace.
- **Framing de transporte de MCP** (stdio/HTTP, forma de `tool_result`,
  JSON Schema de cada herramienta expuesta): eso es exclusivo del futuro
  paquete `packages/mcp`, simétrico a que el parsing de argv es exclusivo
  de `packages/cli`. Ninguna de las dos superficies le impone su forma de
  transporte a la otra a través del core.
- **Noción de sesión o de servidor de larga vida**: cada llamada al core es
  una operación completa e independiente (abre archivo(s) necesarios, hace
  su trabajo, cierra); no hay estado de conexión ni de sesión que el core
  mantenga entre llamadas. Si el proceso MCP vive más tiempo que una sola
  operación (server de stdio de larga vida), esa vida larga es del proceso
  MCP, no del core que corre adentro suyo.

### 4. Layout de paquetes concreto

- `packages/core` (`@nido/core`): la librería. Contiene el store de
  archivos (ADR-001/ADR-002) y el índice derivado en `bun:sqlite`. Sin
  `bin`, sin dependencia de `Bun.argv`.
- `packages/cli` (`@nido/cli`): depende de `@nido/core`. Contiene el
  parseo de argv y el formato humano/JSON, en la misma forma que hoy
  `packages/tickets/src/cli.ts` + `format.ts`. Tiene el `bin: nido`.
- `packages/mcp` (`@nido/mcp`, cuando se construya en el punto 12 de
  `docs/03-plan.md`): depende de `@nido/core` directamente, igual que
  `@nido/cli` — **no** depende de `@nido/cli` ni lo invoca como
  subproceso. Traduce cada operación del core a una herramienta MCP y cada
  resultado/excepción tipada del core a la forma de respuesta de MCP.

Si en algún momento CLI y MCP mostraran comportamientos distintos para la
misma operación lógica, eso es un bug en el límite del core (algo se filtró
a una superficie que debería vivir en las dos, o una superficie
reimplementó algo que debería pedirle al core), no algo a parchar agregando
lógica en una sola superficie.

## Alternativas consideradas

- **El MCP envuelve subprocesos de la CLI** (`Bun.$` o `spawn` sobre el
  binario `nido --json`, parseando stdout): descartada. Fuerza al MCP a
  tratar el contrato de salida `--json` de la CLI como una API estable que
  no controla directamente — cualquier cambio de presentación en la CLI
  (aunque no cambie la lógica) arriesga romper al MCP. Pierde información:
  un error hoy tipado en el core (`ConflictoDeEscritura`, `NodoNoEncontrado`,
  validación fallida con detalle estructurado) se aplana a
  `{ok:false,error:"<string>"}` en la salida de la CLI, y el MCP tendría
  que volver a inferir de qué clase de error se trata parseando texto.
  Paga costo de arranque de proceso y de doble serialización por cada
  llamada. Y, sobre todo, contradice directamente
  `docs/00-entendimiento.md`: la "lógica" que el MCP ejecutaría sería
  literalmente "invocar y parsear la CLI", que es la definición misma de
  reimplementar una superficie sobre otra en vez de compartir un core.
- **El core devuelve datos "listos para mostrar" (con formato humano u
  opción de formato incluida en su firma)**: descartada. Mezclar la
  decisión de presentación dentro de las funciones del core obligaría al
  MCP a pedir un formato que no necesita, o a descartar texto
  pre-formateado para humano que nunca usa — filtra una decisión de
  superficie (cómo se ve algo en una terminal) al único código que ambas
  superficies comparten.
- **Sin separación explícita en paquetes — argv parseando e invocando el
  storage inline, como hace hoy `packages/tickets` con una sola
  superficie**: descartada para nido específicamente, no como crítica a
  tickets. Tickets no tiene declarado un requisito de MCP
  (`docs/03-plan.md` lo trata como herramienta de proceso, independiente
  del producto), así que no paga el costo de separar core y CLI en
  paquetes distintos. Nido sí declara la superficie MCP desde el plan
  (`docs/03-plan.md`, punto 12); pagar el costo chico de separar en
  paquetes ahora evita una migración más cara cuando el MCP exista.

## Consecuencias

**Más fácil:**

- CLI y MCP no pueden divergir en la lógica de una misma operación: hay una
  sola implementación (`packages/core`) que ambas llaman. Un bug arreglado
  en el core queda arreglado para las dos superficies a la vez.
- Probar el core con `bun test` no requiere invocar ni la CLI ni un
  servidor MCP — se llaman las funciones directamente, igual que
  (presumiblemente) `packages/tickets/test` ya prueba `store.ts` sin pasar
  por `cli.ts`.
- El MCP, cuando se construya, no paga costo de arranque de proceso por
  llamada ni pierde información tipada de error — recibe directamente lo
  que el core lanza o devuelve.
- La CLI actual de nido (todavía no construida) puede empezar por
  `packages/core` con exactamente cero código MCP, sin que eso comprometa
  el límite: el límite ya está declarado antes de escribir la primera
  función.

**Más difícil (costo aceptado explícitamente):**

- Dos paquetes (`packages/cli`, y más adelante `packages/mcp`) dependiendo
  del mismo `packages/core` significa que cualquier cambio de firma en una
  función del core hay que propagarlo a las dos superficies que dependen
  de ella (o a la única que exista todavía). Es más disciplina que "todo en
  un archivo", pero es el costo correcto: la alternativa (MCP dependiendo
  de la CLI) traslada ese mismo costo de propagación a un lugar peor,
  acoplado a la presentación de la CLI en vez de a su lógica.
- El core no puede asumir nada sobre cómo se configura (raíz del
  workspace, etc.) — tiene que recibirlo como parámetro explícito en cada
  llamada, nunca leerlo de `process.env`/`Bun.argv` él mismo. Esto es más
  verboso que dejar que el core lea una variable de entorno global, pero
  es necesario porque el MCP puede necesitar resolver esa configuración de
  forma distinta a la CLI (por ejemplo, desde el arranque del proceso
  servidor en vez de desde un flag por invocación).
- Esta ADR fija el límite y el catálogo de operaciones, pero no fija las
  firmas exactas de cada función ni los tipos exactos de cada excepción —
  eso queda para cuando se construya `packages/core` en el punto 7 de
  `docs/03-plan.md` (formalización de tipos, puntos 6–7), y para I5 (qué
  tan expresiva es una View a resolver) e I9 (qué pasa con Rows existentes
  al migrar el esquema de su Database), ambas todavía abiertas o en curso
  este mismo sprint.
- No se resuelve acá si `packages/mcp` vive en este mismo repo/workspace de
  Bun o en uno separado — es un detalle de implementación del punto 12 de
  `docs/03-plan.md`, no de esta ADR; lo único que esta ADR fija es que,
  donde sea que viva, depende de `@nido/core` en proceso, no de invocar la
  CLI.
