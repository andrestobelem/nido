# ADR-006: Migración de esquema en una Database con Rows existentes

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

La invariante 2 de `docs/01-modelo-dominio.md` exige que el conjunto de
`PropertyValue` de toda Row corresponda 1:1 al esquema de su Database: ni
faltan valores para Properties requeridas, ni sobran valores para
Properties que no existen en el esquema. Esa invariante describe un estado
objetivo, pero no dice qué pasa en el instante en que el esquema cambia
bajo Rows que ya existen — que es exactamente cuándo se puede violar.
`docs/02-incognitas.md` (I9) deja abiertas dos preguntas concretas:

1. ¿Se puede agregar una Property **requerida** a una Database que ya
   tiene Rows? En el instante de agregarla, toda Row existente pasaría a
   violar la invariante 2 salvo que ya tuviera, por casualidad, un valor
   para un `property_id` que hasta ese momento no existía.
2. ¿Qué pasa con los `PropertyValue` que quedan huérfanos (referencian un
   `property_id` que ya no está en el esquema) cuando se quita una
   Property?

**Fuera de alcance, ya resuelto por otros ADRs, no se reabre acá:**

- El formato de archivo y la serialización canónica de Database y Row
  (`docs/adr/002-formato-de-archivos-y-sync.md`, secciones 1 y 3): esta
  migración se expresa como escrituras normales sobre esos mismos formatos,
  no introduce uno nuevo.
- La atomicidad por archivo (`docs/adr/001-persistencia.md`): "la
  migración como conjunto no es atómica, cada archivo individual sí lo
  es" es una herencia directa que este ADR no puede ni intenta relajar.
  Cualquier regla que este ADR fije tiene que poder implementarse como una
  secuencia de escrituras CAS de un archivo por vez, nunca como una
  transacción que cubra varios archivos.
- El checklist de validación de entrada no confiable
  (`docs/adr/002-formato-de-archivos-y-sync.md`, sección 5), en particular
  el punto 8 (validación de `PropertyValue` contra el esquema). Este ADR
  **sí lo matiza en un punto concreto y acotado** — ver sección 4 de la
  Decisión — pero no reabre el resto del checklist.

## Decisión

El principio general que ordena las dos reglas de abajo: **una operación
de escritura sobre el archivo de la Database (agregar o quitar una
Property) siempre puede resolverse tocando un solo archivo — el de la
Database — con un CAS normal de ADR-001.** Nunca se diseña una operación
de esquema que necesite reescribir N archivos de Row de forma atómica
como conjunto, porque esa atomicidad no existe en este sistema y fingir
que existe (por ejemplo, alcanzarla con un mutex global, que ADR-001 ya
rechazó explícitamente para no serializar escrituras sin relación) es
peor que no ofrecer la operación.

### 1. Agregar una Property: nunca requerida de entrada si ya hay Rows

Agregar una Property a una Database (`nido db property add`) se resuelve
siempre como una escritura sobre el archivo de la Database (CAS de
ADR-001, sin tocar ningún archivo de Row).

- Si la Database **no tiene ninguna Row todavía**, se puede agregar
  directamente como `requerida: true`. La invariante 2 se cumple
  trivialmente (no hay ninguna Row que pueda violarla) — no hace falta
  ninguna regla especial para este caso, es una consecuencia directa de
  cuantificar "para toda Row" sobre un conjunto vacío.
- Si la Database **ya tiene al menos una Row** y el llamador pide
  `requerida: true`, la operación se **rechaza explícitamente** con un
  error tipado: no se agrega en absoluto, y no se reinterpreta el pedido
  en silencio como `requerida: false`. El error indica el camino de dos
  pasos: agregar como no-requerida y después usar la operación de
  promoción (sección 2).
- Si el llamador pide `requerida: false` (o no especifica, siendo ese el
  default), la Property se agrega sin condición, tenga o no la Database
  Rows existentes. Ninguna Row existente necesita cambiar: por definición,
  una Property no requerida puede estar ausente de `valores` sin violar
  la invariante 2.

Rechazar en vez de degradar silenciosamente el pedido es la misma
disciplina que ya rige en ADR-001/002 para todo lo demás: "nunca se
mezcla ni se sobrescribe en silencio", "nunca se completa con un valor
adivinado". Pedir `requerida: true` y recibir de vuelta una Property no
requerida sin que nada lo señale es exactamente esa clase de sorpresa
silenciosa.

### 2. Promover una Property existente a requerida

Operación explícita y separada (`nido db property promote`), distinta de
"agregar". Recibe el `database_id` y el `property_id` de una Property que
ya existe en el esquema con `requerida: false`.

Flujo:

1. Fuerza una relectura directa de los archivos de Row de esa Database
   (o una reconstrucción fresca del índice derivado si el motor ya la
   expone) — **nunca confía en un índice que pueda estar desactualizado**
   para esta decisión puntual. La razón concreta: una promoción que se
   confirma sobre datos viejos deja Rows realmente inválidas que recién
   se detectarían en la próxima lectura o reconstrucción de índice, sin
   contexto de qué operación las rompió. Es preferible pagar el costo de
   una lectura fresca en el momento de promover (proporcional al tamaño
   de la Database, pagado una sola vez, cuando alguien efectivamente
   pide promover) que descubrir el problema más tarde, desconectado de su
   causa.
2. Verifica que **todas** las Rows de esa Database tengan un
   `PropertyValue` para ese `property_id`.
3. Si falta en alguna: la operación **falla sin tocar el archivo de la
   Database** y devuelve un error tipado que lista los `id` de las Rows
   que faltan (acotado — por ejemplo los primeros 50 más el conteo total,
   para que el error siga siendo legible en una Database grande). El
   esquema queda exactamente como estaba.
4. Si todas la tienen: se escribe el archivo de la Database con
   `requerida: true` para esa Property, vía el CAS normal de ADR-001
   (hash capturado en el paso 1, comparado antes de confirmar). Ninguna
   Row se reescribe como parte de esta operación — ya tenían el valor
   antes de promover, si no, el paso 3 hubiera fallado.

Rellenar cada Row con el valor real es trabajo del llamador, hecho con las
operaciones normales de escritura de Row (una por una, cada una atómica
por su cuenta vía CAS de ADR-001) **antes** de invocar promote. Este ADR
no ofrece "agregar Property requerida + backfill automático" como una
sola operación — es la decisión central de este ADR, justificada en la
sección de alternativas.

**Race residual, aceptado explícitamente:** entre el paso 2 (verificar) y
el paso 4 (confirmar) de una promoción, otro agente podría crear una Row
nueva sin valor para esa Property — válida en ese instante porque el
esquema todavía no la marca requerida — y la promoción de todos modos se
confirma. Esa Row queda entonces con un descalce respecto del esquema ya
vigente. No se agrega ninguna máquina nueva para cerrar esta ventana: el
checklist de `docs/adr/002-formato-de-archivos-y-sync.md` (sección 5,
punto 8) ya corre en cada lectura y ya rechaza (fail-closed, reportado
como diagnóstico) cualquier Row a la que le falte un valor para una
Property requerida de su esquema actual — este caso no es una excepción
al checklist, es exactamente el caso que el checklist ya cubre. Cerrar la
ventana con locking distribuido sería contradecir el mínimo aceptado por
`docs/sprints/00-revision-plan.md` (que ADR-001 ya adoptó) para una
ganancia marginal: la ventana es angosta (dos operaciones de escritura de
un mismo agente, separadas por una lectura) y el peor caso ya tiene una
red de contención (el checklist) que lo detecta y lo reporta, nunca lo
deja pasar en silencio.

### 3. Quitar una Property: nunca falla, nunca borra nada en silencio

Quitar una Property (`nido db property remove`) se resuelve siempre: se
saca la entrada correspondiente de `propiedades` en el archivo de la
Database, vía el CAS normal de ADR-001. No hay condición que la bloquee
— a diferencia de agregar-como-requerida, quitar una Property nunca deja
una Row en un estado que viole la invariante 2, porque la invariante solo
exige valores para Properties que **existen** en el esquema; sacar una
Property no puede crear una ausencia inválida, en el peor caso deja
sobrantes (ver abajo), y un sobrante no es una violación de la mitad
"faltante" de la invariante 2.

Los `PropertyValue` que referencian ese `property_id` en las Rows
existentes **no se toman, no se tocan, no se borran** como parte de esta
operación. Quedan tal cual estaban en cada archivo de Row — orphaned. Lo
mismo aplica a cualquier View de esa Database cuyo `filtros`, `orden` o
`columnas_visibles` referencie ese `property_id`: la referencia queda en
el archivo de la Database sin que la operación de quitar la Property la
edite.

Tratamiento de esos huérfanos, hasta que alguien pida limpiarlos:

- **Se excluyen de la validación**: el punto 8 del checklist de
  `docs/adr/002-formato-de-archivos-y-sync.md` decía, sin excepción,
  que cualquier `property_id` en `valores` que no exista en el esquema
  rechaza la Row entera como inválida. **Este ADR matiza ese punto,
  exclusivamente para este caso**: un `property_id` en `valores` que no
  está en el esquema actual **no rechaza la Row**. Se ignora esa entrada
  puntual — no se type-checkea contra nada, no se expone en ninguna View
  ni columna (porque no hay Property que la nombre), pero el resto de la
  Row (sus otros `PropertyValue`, válidos contra el esquema actual) se
  valida e indexa normalmente. La mitad del punto 8 que sí sigue intacta,
  sin excepción, es la otra dirección: un `property_id` **requerido**
  que falte en `valores` sigue rechazando la Row (ese es justo el caso de
  la sección 2 de este ADR).
- **Se excluyen del índice derivado**: no hay columna para ese
  `property_id` en el índice (la Property ya no existe en el esquema), así
  que estructuralmente no puede aparecer en ningún filtro, orden o
  columna visible de ninguna View.
- **No se borran del archivo.** Siguen físicamente en el JSON de la Row (y
  la referencia huérfana sigue en el JSON de la Database, si una View la
  tenía). Se reportan como diagnóstico visible — el mismo canal que ya
  usa el punto 9 del checklist para cualquier hallazgo de validación, por
  ejemplo al reconstruir el índice o al leer esa Database puntual.
- **Una operación explícita de limpieza** (`nido db property
  purge-orphans <database_id> [--property-id <id>]`) es la única forma de
  que esos valores desaparezcan de verdad. Reescribe, uno por uno, cada
  Row que tenga un huérfano (CAS individual de ADR-001 por archivo, igual
  que cualquier otra escritura de Row) quitando esa entrada de `valores`,
  y de la misma forma la referencia huérfana en `filtros`/`orden`/
  `columnas_visibles` de cualquier View del archivo de la Database. Es
  una operación por definición no atómica como conjunto — herencia directa
  de ADR-001/002 ("la migración como conjunto no es atómica, cada archivo
  individual sí lo es") — así que reporta, al terminar, qué archivos
  limpió y cuáles no pudo (por ejemplo, por un conflicto de CAS con otra
  escritura concurrente a esa misma Row), sin que una falla puntual
  bloquee el resto del lote.

Por qué nunca en silencio: un hard-delete inmediato de cada `PropertyValue`
huérfano en el mismo paso que quita la Property exigiría reescribir N
archivos de Row como parte de una sola operación de esquema — exactamente
la atomicidad-de-conjunto que este sistema no tiene. Si esa reescritura se
interrumpe a mitad de camino (el proceso muere, la máquina se apaga), el
resultado es un estado a medio migrar donde no hay ninguna marca de qué
Rows ya se limpiaron y cuáles no — peor que dejar el dato de más, que es
inerte, reportado, y removible después sin apuro.

## Alternativas consideradas

- **Rellenar automáticamente con un valor por defecto al agregar una
  Property requerida** (permitir `requerida: true` de entrada y
  sintetizar un valor para cada Row existente): descartada porque el
  valor sintético queda indistinguible del valor real una vez escrito —
  nada en el archivo dice "esto lo puso un agente" vs. "esto lo inventó
  el sistema porque no había nada" — y contamina cualquier filtro o
  conteo posterior sobre esa Property sin que quien lo lea pueda saberlo.
  Además no hay un default universal sensato por tipo: `checkbox` en
  `false` es una afirmación real de "no", no un "sin dato"; `select` no
  tiene una opción canónica de "ninguna" salvo que el esquema la declare
  explícitamente como tal; y el patrón equivalente en migraciones de
  esquema de bases relacionales (agregar una columna `NOT NULL` sobre una
  tabla con filas exige o un `DEFAULT` explícito o un paso separado de
  backfill-y-luego-constraint) es justamente el mismo problema, resuelto
  ahí también en dos pasos cuando el default no es un valor de negocio
  real. La opción elegida es ese segundo camino, aplicado sin excepción.
- **Marcar la Database entera como "inconsistente" hasta que se resuelva
  a mano**: descartada porque bloquea todo uso de la Database (Rows y
  Views existentes, que no tenían ningún problema) por el agregado de una
  sola columna, sin una definición operable de qué significa "resolver a
  mano" ni una forma incremental de progresar. La regla elegida sí es
  incremental: cada Row que se completa con el valor real acerca a la
  Database a poder promover, sin bloquear nada mientras tanto.
- **Permitir agregar la Property como requerida de una y dejar que el
  checklist de ADR-002 (punto 8) invalide las Rows existentes como efecto
  secundario, sin una operación explícita de "promover"**: técnicamente
  el checklist ya reportaría el problema, así que esta opción "funciona"
  en el sentido de que nada queda corrupto ni se pierde. Se descartó
  igual porque invalida en masa, de golpe y como efecto secundario tardío
  (recién visible en la próxima lectura o reconstrucción de índice, no en
  el momento de la operación de esquema), a todas las Rows existentes que
  no tuvieran ya el valor — mucho peor UX para un agente que para enterarse
  de qué falta tiene que ir a leer el reporte de la próxima reconstrucción
  del índice en vez de recibirlo como resultado directo de la operación
  que causó el problema. La operación `promote` da el mismo resultado
  (rechazo si falta algo) pero como respuesta inmediata y con la lista
  completa de qué falta, en el momento en que alguien lo pide.
- **Downgradear `requerida: true` a `false` en silencio cuando la
  Database ya tiene Rows**, en vez de rechazar el pedido: descartada por
  inconsistencia con el resto del proyecto — cada ADR anterior evita
  reinterpretar en silencio un pedido explícito ("nunca se sobrescribe en
  silencio", "nunca se completa con un valor adivinado"). Un pedido
  explícito de `requerida: true` que vuelve como `requerida: false` sin
  que nada lo señale es la misma clase de sorpresa que esos ADRs evitan
  en otro contexto.
- **Borrar inmediatamente cada `PropertyValue` huérfano al quitar la
  Property, como parte de la misma operación**: descartada porque exige
  reescribir N archivos de Row dentro de una operación que hoy es, y
  puede seguir siendo, de un solo archivo — convertir una operación
  atómica (un archivo, un CAS) en una que reparte trabajo sobre N
  archivos sin ninguna garantía de conjunto es estrictamente peor: si se
  interrumpe a mitad de camino no hay forma de saber qué Rows ya se
  limpiaron. Además borra dato de forma irreversible sin que el llamador
  lo haya pedido explícitamente — la operación que pidió fue "quitar la
  Property del esquema", no "borrar los valores de todas las Rows que la
  usaban".
- **Aplicar el punto 8 del checklist de ADR-002 literalmente, sin
  excepción, e invalidar la Row entera cuando tiene un `property_id`
  huérfano**: descartada porque el radio de daño es desproporcionado al
  evento real. Quitar una sola Property de una Database con miles de
  Rows invalidaría, de un saque, todas las que tuvieran esa Property con
  algún valor — efectivamente vaciando la Database de toda View hasta que
  alguien corra una limpieza, por una edición de esquema legítima, no por
  manipulación adversarial del archivo. Se distingue explícitamente de
  por qué el punto 3 del mismo checklist (campo inesperado en el sobre
  fijo de un nodo: `id`, `tipo`, `parent_id`, etc.) sí rechaza sin
  excepción: ese sobre es un conjunto fijo y conocido de antemano, así
  que un campo de más ahí es evidencia real de manipulación. `valores`
  no es un conjunto fijo — su forma válida depende de un esquema que este
  mismo ADR declara mutable — así que un sobrante ahí, después de una
  operación de esquema legítima, es el resultado esperado del sistema
  funcionando como se diseñó, no una señal de ataque.

## Consecuencias

**Más fácil:**

- Agregar y quitar una Property siguen siendo, cada una, una sola
  escritura CAS sobre un solo archivo (la Database) — no se introduce
  ninguna primitiva de atomicidad nueva ni se toca la de ADR-001.
- Promover a requerida también es una sola escritura CAS sobre el archivo
  de la Database (solo cambia un booleano) — el trabajo real de poblar
  cada Row pasa por el camino de escritura de Row ya existente, que ya es
  atómico por archivo. No hace falta ningún mecanismo de "transacción
  multi-archivo" para resolver I9, que era exactamente el riesgo que
  ADR-001 dejó señalado como pendiente.
- El manejo de huérfanos reutiliza el mismo canal de diagnóstico que ya
  exige el punto 9 del checklist de ADR-002 ("nunca aborta la operación
  completa por un solo archivo roto... se reporta") — no hace falta
  diseñar un modelo de reporte nuevo, solo un caso más que lo alimenta.
- La regla es simétrica con el resto del proyecto en un sentido preciso:
  nada se pierde ni se sobrescribe sin una acción explícita y nombrada
  (`promote`, `purge-orphans`) que quien la ejecuta pidió a propósito.

**Más difícil (costo aceptado explícitamente):**

- Agregar una Property requerida desde el día uno en una Database que ya
  tiene Rows exige más de una llamada (agregar no-requerida, poblar cada
  Row con su valor real por el camino normal, promover) en vez de una
  sola — es el precio de no tocar N archivos de Row en una sola operación
  no atómica. Se acepta porque el camino de una sola llamada solo puede
  lograrse rellenando con un valor sintético (alternativa ya descartada) o
  bloqueando toda la Database (también descartada).
- Los huérfanos —`PropertyValue` de Rows y referencias de View— son
  basura que persiste indefinidamente en el repo hasta que alguien corra
  `purge-orphans` explícitamente. Una Database con varios ciclos de
  agregar/quitar Properties sin nunca purgar acumula estas entradas
  muertas en sus archivos. Se acepta como el costo de "nunca se borra en
  silencio"; el remedio (`purge-orphans`) existe y es barato de correr,
  simplemente no es automático.
- Queda una ventana de carrera real, aunque angosta, entre el chequeo y la
  confirmación de `promote` (ver sección 2, "Race residual"): una Row
  creada en ese instante puede terminar inválida apenas se confirma la
  promoción. No se cierra con locking nuevo; se cierra con la detección
  fail-closed que el checklist de ADR-002 ya hace en cada lectura. El
  costo aceptado es que esa Row inválida solo se ve en la próxima lectura
  o reconstrucción de índice, no en el momento en que se creó.
- `promote` necesita leer el conjunto completo de Rows de la Database sin
  confiar en el índice derivado (que podría estar desactualizado) — un
  costo proporcional al tamaño de la Database, pagado cada vez que se
  intenta promover, no en cada escritura normal.
- `purge-orphans`, igual que cualquier migración de conjunto en este
  sistema, no es atómica como lote: puede terminar habiendo limpiado
  algunas Rows y no otras (por ejemplo, por un conflicto de CAS puntual
  con otra escritura concurrente), y reporta ese resultado parcial en vez
  de garantizar todo-o-nada. Es la misma herencia de ADR-001/002 que ya
  se aceptó para cualquier operación que toque más de un archivo.
