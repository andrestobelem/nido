# ADR-002: Formato de archivo, serialización canónica y validación de entrada no confiable

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

`docs/adr/001-persistencia.md` fijó que los archivos planos son la única
fuente de verdad y que la atomicidad entre agentes se resuelve con CAS por
archivo (comparar un valor capturado en la lectura contra el estado real en
disco antes de confirmar la escritura) más escritura vía
temporal-y-`rename`. Ese ADR dejó explícitamente abierto para I2 el formato
exacto de serialización, y declaró como consecuencia directa que "el
serializador de cada tipo de archivo tiene que ser canónico y determinista
(mismo objeto → mismos bytes)" y que la validación de entrada no confiable
"corre en cada lectura, no en un paso de importación aislado".

`docs/02-incognitas.md` (I2, extendida tras la revisión adversarial del
plan) exige responder, además del formato en sí:

1. Qué hace el importador ante un árbol que llegó a cualquier estado sin
   pasar por el motor de sync (`git checkout`, merge, cherry-pick, edición
   manual) — cuatro casos concretos: `parent_id` colgante, `id` falsificado
   o duplicado, path traversal, y árbol tocado por git fuera del motor.
2. Cómo se resuelve un conflicto de edición concurrente — esto ya está
   resuelto por ADR-001 (detectar-y-reportar vía CAS, nunca fusión
   silenciosa) y este ADR no lo reabre; lo que sí fija acá es **sobre qué
   bytes exactos** opera esa comparación, porque el ADR-001 no lo dejó
   explícito.

Se evaluaron tres opciones de formato de forma independiente: **Markdown
con frontmatter YAML/TOML para todo nodo por igual**, **JSON para todo
nodo por igual**, y un **híbrido por tipo de nodo** (Page en
Markdown+frontmatter, Database y Row en JSON). Las tres evaluaciones,
incluida la que defendía el formato uniforme en cada dirección, convergen
en el mismo punto cuando se las lee hasta el veredicto: el cuerpo libre de
una Page (invariante 4 de `docs/01-modelo-dominio.md`: "una Page que no es
Row no tiene `PropertyValue` estructurado... su contenido es texto libre
en `cuerpo`") y los datos tipados de una Row o el esquema/Views de una
Database son dos formas de contenido genuinamente distintas, y forzar una
sola representación para ambas paga un costo real en exactamente los
criterios que este ticket no puede relajar: determinismo de round-trip y
seguridad del parseo de entrada no confiable.

**Fuera de alcance de este ADR**: I9 (migración de esquema — qué pasa con
las Rows existentes cuando se agrega o quita una Property requerida de una
Database) sigue abierta. El formato de archivo fijado acá no asume ni
resuelve una estrategia de migración; cuando I9 se resuelva, su
implementación debe respetar la serialización canónica y el checklist de
validación que fija este ADR, no reabrirlos.

## Decisión

### 1. Formato de archivo por tipo de nodo (híbrido, no uniforme)

- **Page** (nodo que no es Database ni Row): `<id>.md`, con un encabezado
  de campos fijos delimitado por líneas `---` seguido del cuerpo Markdown
  tal cual.
- **Database**: `<id>.json`, un único objeto JSON que incluye su esquema
  (`propiedades`) y sus Views (`vistas`), consistente con ADR-001
  ("Database... vive en un solo archivo").
- **Row**: `<id>.json`, un único objeto JSON con sus `PropertyValue`. **Una
  Row no tiene campo `cuerpo`.** No es una omisión: es la resolución
  explícita del hueco de modelo que dejaba abierto envolver una Row en un
  formato pensado para prosa (un cuerpo Markdown que ninguna evaluación
  pudo justificar y que ninguna Row real usa) — con este formato, la
  pregunta "¿qué significa que una Row tenga contenido en el cuerpo?" deja
  de tener sentido porque el slot no existe.

El criterio de la división no es "Page vs. el resto" por prurito de
categoría, sino por forma de contenido: Page es el único nodo con prosa
libre genuina; Database y Row son, en su contenido definitorio (esquema +
Views; PropertyValue), datos tipados y anidados donde JSON no pierde nada
frente a YAML y gana en las dos propiedades que este ticket prioriza
(determinismo, seguridad de parseo). El campo `cuerpo` que Database hereda
de Page (`docs/01-modelo-dominio.md`: "Database... hereda todos los campos
de Page") existe pero es secundario: el contenido que define a una
Database es su esquema y sus Views, no su prosa, y en la práctica una
Database rara vez tiene `cuerpo` con contenido real. Cuando lo tiene, se
serializa como un string JSON normal dentro del mismo objeto — se acepta
el costo menor de editabilidad para ese campo secundario y opcional, en vez
de pagar el costo mayor de mantener dos parsers (frontmatter + JSON) para
un solo tipo de nodo.

### 2. El encabezado de Page no es YAML general

Esto es la parte no negociable de la decisión. Las tres evaluaciones
documentan, con evidencia concreta, dos clases de fallo real de cualquier
motor de frontmatter YAML "de defaults":

- **Ejecución de código al leer**: `gray-matter` (la librería de
  frontmatter más usada en JS/Bun) ejecuta el contenido del frontmatter
  como JavaScript/CoffeeScript cuando el delimitador es `---js`/`---coffee`
  (Snyk SNYK-JS-FRONTMATTER-569103; gray-matter issues #94/#99/#131;
  explotado en producción según md-to-pdf GHSA-547r-qmjm-8hvw). Esto es
  exactamente el vector que el caso 4 de I2 extendida describe: un archivo
  que llega al árbol por un merge fuera del motor de sync puede ejecutar
  código en el simple acto de leerlo.
- **No-determinismo de round-trip**: `js-yaml` no garantiza orden de
  claves en el dump (issue #208) y el "Norway problem" de YAML 1.1 coacciona
  `no`/`yes`/`on`/`off` a booleano de forma implícita; Obsidian/mcpvault
  issue #77 documenta una fecha plana reserializada como timestamp ISO
  completo sin cambio semántico real.

Ninguno de estos riesgos es necesario para lo que el encabezado de una Page
tiene que representar: seis campos fijos, todos escalares, conocidos de
antemano. Por eso el encabezado de Page **no usa un parser YAML general ni
ninguna librería de frontmatter**: es un formato propio, deliberadamente
chico, con esta forma exacta:

```
---
id: "<id>"
tipo: "pagina"
parent_id: "<id>" | null
titulo: "<string entre comillas dobles>"
creado_en: "<ISO-8601 UTC completo>"
actualizado_en: "<ISO-8601 UTC completo>"
---
<cuerpo: Markdown plano, verbatim, hasta EOF>
```

Reglas del formato (no del contenido — eso está en la sección 3):

- Delimitador de apertura y cierre: una línea exacta `---`. No se reconoce
  ningún otro delimitador (`---js`, `---coffee`, `+++` de TOML, etc.); si
  el archivo no abre con `---\n` seguido de líneas `clave: valor` y un
  segundo `---\n`, se rechaza el archivo entero (ver checklist, sección
  4).
- Todo valor string va entre comillas dobles. El único escape reconocido
  es `\"` y `\\`; no se interpreta ningún otro escape YAML (`\n`, `\t`,
  anchors, tags, multi-documento). Un parser total de ~20 líneas — split
  por línea, un regex fijo por clave esperada — cubre el formato completo;
  no hay "modo seguro" que configurar porque no hay motor de lenguaje que
  desactivar.
- `titulo` no puede contener un salto de línea literal (los títulos de
  Page son de una sola línea por asunción de dominio); si el valor a
  escribir lo tuviera, es un error de validación en escritura, no algo que
  el formato intente codificar.
- El **lector** acepta las seis claves en cualquier orden (para no
  rechazar un archivo editado a mano que las reordenó) pero exige el
  conjunto exacto: ni falta ninguna, ni sobra ninguna, cada una aparece
  una sola vez, y cada valor cumple el grammar de arriba al pie de la
  letra. El **escritor** (serializador canónico, sección 3) siempre emite
  las seis claves en el orden fijo de arriba, sin excepción — así una
  edición a mano que reordenó claves no se rechaza en la lectura, pero el
  próximo write la vuelve a poner en orden canónico.
- El campo `sync` que `docs/01-modelo-dominio.md` describe para Page (path
  en el repo, hash de contenido, última sincronización) **no se serializa
  dentro del archivo del nodo**. Embeber el hash de un archivo dentro de sí
  mismo es circular (cambiar el hash cambia el contenido, que cambia el
  hash) y no aporta nada que la sección 5 no resuelva ya sin ese problema:
  el path es derivable de `id` + tipo de nodo por convención de nombre de
  archivo, y el hash se calcula on-demand desde los bytes en disco. Esta
  metadata de sync es bookkeeping del motor de sync (puede vivir en el
  índice derivado de ADR-001, que ya está declarado reconstruible y nunca
  fuente de verdad), no un campo persistido dentro del nodo. Esto no
  contradice `docs/01-modelo-dominio.md`: es la resolución concreta, a
  nivel de implementación, de dónde vive un campo que ese documento
  describe pero no ubica.

### 3. Serialización canónica y determinista

Regla general: **el orden de claves de cualquier objeto es un orden fijo
que el serializador construye explícitamente, nunca el orden de inserción
en memoria del objeto que se le pasa.** `packages/tickets/src/store.ts` se
salva de este problema hoy solo porque tiene un único code path
(`crear`/`asignar`/`moverEstado`/`comentar`) que siempre reconstruye el
objeto completo en el mismo orden literal — nido necesita la garantía
explícita porque va a tener actualizaciones parciales (patch de un
`PropertyValue`, de metadata, de una Property del esquema) donde confiar
en el orden de inserción implícito de JS es exactamente el punto donde
`js-yaml`/`JSON.stringify` sin canonicalizar fallan en producción.

Concretamente, cada función de escritura pasa por un serializador que
construye el objeto de salida campo por campo, en este orden fijo, antes
de pasarlo a `JSON.stringify(objeto, null, 2) + "\n"` (mismo patrón de
indentación y newline final que `packages/tickets/src/store.ts:68`, sin
librerías nuevas):

- **Database**: `id`, `tipo`, `parent_id`, `titulo`, `cuerpo` (solo si
  está presente), `propiedades`, `vistas`, `creado_en`, `actualizado_en`.
- **Row**: `id`, `tipo`, `parent_id`, `titulo`, `creado_en`,
  `actualizado_en`, `valores`.

Reglas de valor, para cerrar cada ambigüedad conocida:

- **Fechas** (`creado_en`, `actualizado_en`): siempre
  `Date.prototype.toISOString()` — ISO-8601 UTC completo con milisegundos
  (`2026-08-26T10:00:00.000Z`), igual que `packages/tickets`. Un
  `PropertyValue` de tipo `fecha` se guarda como **string `"YYYY-MM-DD"`
  opaco**: se valida su forma en la entrada pero nunca se re-parsea a
  `Date` ni se reformatea al reescribir. Esto cierra por diseño la clase
  de bug documentada en Obsidian/mcpvault issue #77 (una fecha plana que
  vuelve como timestamp completo sin cambio real): si nunca se construye
  un objeto `Date` a partir de ese valor, no hay ruta de código que pueda
  reformatearlo.
- **Números** (`PropertyValue` tipo `numero`): number nativo de JSON. Se
  **rechaza en validación de escritura** (no se serializa nunca)
  `NaN`, `Infinity`, `-Infinity` y `-0` — `JSON.stringify` convierte los
  primeros tres a `null` en silencio, que sería una pérdida de dato no
  reportada; se corta antes, en la validación, no en el serializador.
- **`multi_select`**: el array de ids de opción se ordena
  lexicográficamente (comparación de string ascendente) y se deduplica
  antes de serializar. `multi_select` es un conjunto semánticamente (sin
  orden de exhibición declarado en `docs/01-modelo-dominio.md`), así que
  fijar un orden derivado del contenido, no del orden de inserción,
  elimina la ambigüedad en la raíz en vez de confiar en que el código que
  construye el array siempre lo haga en el mismo orden.
- **`valores` de una Row**: se ordena por `property_id` ascendente
  (comparación de string) antes de serializar, por la misma razón que
  `multi_select` — el modelo no declara que el orden de los
  `PropertyValue` sea significativo, así que el serializador no confía en
  el orden de construcción en memoria.
- **`propiedades` de una Database y `vistas`** (incluyendo `filtros` y
  `orden` dentro de una vista): el orden se preserva tal cual viene en el
  objeto, sin reordenar. A diferencia de `valores`/`multi_select`, aquí el
  orden **es** dato de dominio con significado (`docs/01-modelo-dominio.md`
  llama a `propiedades` explícitamente "lista ordenada"; `orden` de una
  View es orden multi-campo donde la secuencia importa). El código que
  construye o actualiza estas listas es responsable de mantener el orden
  correcto; el serializador no lo corrige ni lo reordena.
- **Campos opcionales ausentes vs. `null`**: regla única, sin excepciones.
  `null` significa "el campo existe conceptualmente para este objeto pero
  no tiene valor" (ejemplo: `parent_id` de una Page de nivel superior —
  siempre presente, puede ser `null`). Un campo **ausente** (la clave no
  aparece en el objeto serializado) significa "este campo no aplica a este
  objeto" (ejemplo: `cuerpo` en una Database que nunca lo usó; `config` en
  una Property de tipo `checkbox`, que no necesita configuración). Nunca
  se emite `null` para "no aplica", y nunca se omite una clave que el
  esquema del tipo de nodo declara como siempre presente.
- Objeto vacío o array vacío nunca se usa como placeholder de "ausente":
  si un campo no aplica, se omite la clave; si aplica pero no tiene
  elementos (una Database sin Views todavía), se serializa como `[]`
  explícito, no se omite.

### 4. Qué se hashea para el CAS de ADR-001, y dónde vive

**Se hashea el contenido completo del archivo tal cual está en disco —
los bytes crudos, no una re-serialización canónica del objeto parseado.**
Concretamente: `Bun.hash()` (hash no criptográfico rápido, nativo de Bun)
sobre el `ArrayBuffer`/`Uint8Array` que devuelve `Bun.file(path).arrayBuffer()`.
No hace falta un hash criptográfico (SHA-256) porque este valor nunca
cruza un límite de confianza ni se usa para verificar autenticidad — es
puramente un token de concurrencia optimista dentro del mismo proceso/host
("¿cambiaron los bytes desde que los leí?"), y `Bun.hash()` es la API
nativa de Bun ya preferida por `CLAUDE.md`.

Por qué bytes crudos y no la forma canónica: si se hasheara la
re-serialización canónica del objeto parseado, una edición manual que
cambia bytes sin cambiar el valor semántico (por ejemplo, alguien reordena
a mano las claves del encabezado de una Page, o cambia indentación en un
JSON) sería invisible para el CAS — dos lecturas distintas del archivo
"antes" y "después" de esa edición externa producirían el mismo hash
canónico, y una escritura concurrente podría pisarla en silencio.
Exactamente lo que ADR-001 prohíbe ("nunca se mezcla ni se sobrescribe en
silencio"). Hashear los bytes crudos detecta cualquier cambio externo al
archivo, tocado por el motor de sync o no, sin excepción — que es
justamente el caso 4 de I2 extendida (árbol tocado por git fuera del motor
de sync).

Dónde vive: **en memoria, solo durante el ciclo de una operación de
escritura**, nunca persistido. El flujo es el mismo que ya describe
ADR-001: se lee el archivo, se captura `Bun.hash()` de esos bytes; antes de
confirmar (justo antes del `rename` del archivo temporal), se vuelve a
leer el archivo en disco y se recalcula el hash; si no coincide con el
capturado, se aborta con un error tipado de conflicto. El valor no se
embebe en el archivo (ver sección 2, por qué embeber un hash dentro de sí
mismo es circular) ni se guarda en el índice derivado de `bun:sqlite`: el
índice es para resolver Views, no para CAS, y agregarle esta
responsabilidad mezclaría dos ciclos de vida distintos (el índice se
reconstruye completo cuando se lo descarta; el hash de CAS solo tiene
sentido durante una escritura puntual en curso).

### 5. Checklist de validación de entrada no confiable, en cada lectura

Corre en este orden, sobre cada archivo que el motor de sync considera
parte del árbol de nido (Page, Database o Row); "rechazar" significa
excluir ese nodo del índice/operación en curso y reportarlo como
diagnóstico — nunca abortar la lectura de todo el árbol por un solo archivo
roto, y nunca completar con un valor adivinado o parcialmente parseado.

1. **Confinamiento de path** (cierra *path traversal*): antes de abrir
   cualquier archivo, resolver su path absoluto y verificar que es
   descendiente de la raíz del workspace configurada — rechazar `..`,
   paths absolutos fuera de la raíz, y symlinks que resuelvan afuera. El
   nombre de archivo debe matchear `^<charset-de-id>+\.(md|json)$`; nunca
   se construye un path concatenando un `parent_id` u otro valor leído
   del contenido de un archivo sin pasar antes por el índice id→path.
2. **Parseo total, no tolerante**: `JSON.parse` para Database/Row (un
   error de sintaxis rechaza el archivo completo, no intenta recuperar lo
   que sí parseó); para Page, el encabezado tiene que matchear
   exactamente el grammar de la sección 2 (delimitadores, seis claves, sin
   más ni menos) o se rechaza el archivo completo. Nunca se ejecuta el
   contenido como código — no hay motor de lenguaje que invocar en ningún
   parser usado aquí, es la propiedad que hace que el resto de este
   checklist tenga sentido.
3. **Forma/esquema exacto**: el objeto parseado tiene exactamente los
   campos que el esquema de su tipo de nodo declara — ni falta un campo
   requerido ni sobra uno inesperado. Un campo extra se trata como
   evidencia de manipulación o de drift de esquema, no se ignora en
   silencio.
4. **Consistencia id-vs-filename** (cierra *id falsificado*): el `id`
   dentro del contenido tiene que ser igual al id derivado del nombre de
   archivo (`<id>.md`/`<id>.json` sin extensión). Si no coincide, se
   rechaza — nunca se indexa un archivo bajo un id distinto del que dice
   su nombre.
5. **Unicidad de id en todo el árbol** (cierra *id duplicado*): al
   construir/refrescar el índice derivado, si dos archivos distintos
   declaran el mismo `id`, es un conflicto duro que se reporta
   explícitamente (ejemplo concreto: copiar el archivo de una Row sin
   cambiar su encabezado). Nunca "el último que se procesa gana" en
   silencio.
6. **Resolución de `parent_id`** (cierra *parent_id colgante*): `null` es
   válido solo para un tipo de nodo que el modelo permite en el nivel
   superior del Workspace (Page, Database). Cualquier otro valor tiene que
   resolver, vía el índice id→path (nunca por adivinanza de path), a un
   nodo ya validado de un tipo permitido (`Row.parent_id` debe resolver a
   una Database; `Page.parent_id` a una Page o Database existente). Si no
   resuelve, el nodo queda marcado huérfano/inválido y excluido del árbol
   normal — no se borra, se reporta.
7. **Ciclos en el grafo de contención**: recorrer la cadena de
   `parent_id` desde cualquier nodo tiene que terminar sin revisitar un
   nodo, acotado por la cantidad total de nodos (mismo patrón que
   `creaCiclo` en `packages/tickets/src/store.ts`). Un ciclo marca como
   inválidos a todos los nodos que participan de él — la invariante 5 de
   `docs/01-modelo-dominio.md` exige que el grafo de contención sea un
   árbol estricto.
8. **Validación de tipo por `PropertyValue`** (invariantes 2 y 3 de
   `docs/01-modelo-dominio.md`): para cada Row, cada `property_id` en
   `valores` tiene que existir en el esquema de su Database padre (sin
   valores huérfanos), y cada Property requerida del esquema tiene que
   tener un valor correspondiente (sin faltantes) — se chequean las dos
   direcciones, no solo una. El tipo de cada `valor` tiene que coincidir
   con el tipo declarado de su Property (string para `texto`/`agente`,
   string `YYYY-MM-DD` para `fecha`, number finito para `numero`, boolean
   para `checkbox`, un id presente en `config.opciones` para `select`, un
   array de esos ids para `multi_select`). Cualquier descalce rechaza esa
   Row como inválida.
9. **Falla cerrada, nunca silenciosa ni total**: cualquier fallo de 1–8
   excluye ese nodo puntual del índice/operación y se reporta como
   diagnóstico visible (por ejemplo, en la salida de la CLI que reconstruye
   el índice); nunca aborta la operación completa por un solo archivo roto,
   y nunca repara ni adivina el valor correcto en silencio. Esto es lo que
   responde al caso 4 de I2 extendida (árbol tocado por git fuera del
   motor de sync): como no hay una base separada que ya validó el
   contenido al importarlo, este checklist corre completo en cada
   lectura, no solo la primera vez.

## Alternativas consideradas

- **Markdown con frontmatter YAML/TOML para Page, Database y Row por
  igual**: se descartó como uniforme porque, para una Row típica, el
  formato es forzado — 100% contenido estructurado envuelto en un sobre
  pensado para prosa, con un cuerpo Markdown vacío que no aporta nada y
  que además deja sin definir qué significaría que ese cuerpo tuviera
  contenido (la propia evaluación que defendía esta opción termina
  recomendando JSON para Row). Extendida a Database, la estructura anidada
  de Properties/Views prácticamente exige YAML (no TOML), lo que además
  importa sus riesgos documentados (Norway problem, no determinismo de
  `js-yaml` issue #208, motores de frontmatter con ejecución de código
  como `gray-matter`) justo en los dos tipos de nodo donde ninguna ventaja
  de Markdown aplica. Sobrevive de esta opción únicamente el fragmento
  Page, adoptado en la Decisión con la enmienda de no usar un motor YAML
  general (sección 2).
- **JSON para Page, Database y Row por igual**: se descartó para Page
  específicamente porque `cuerpo` es prosa libre genuina (invariante 4 de
  `docs/01-modelo-dominio.md`), y envolverla en un string JSON escapado
  degrada la editabilidad a mano de forma medible (sin saltos de línea
  reales, comillas escapadas) y colapsa cualquier diff de una edición de
  prosa a una única línea reemplazada de punta a punta — el mismo problema,
  a otra escala, que hace que los `.ipynb` de Jupyter necesiten `nbdime`
  porque el diff nativo de git sobre JSON con contenido largo embebido es
  casi inútil. Se adopta para Database y Row, donde gana limpio en los
  cinco criterios de este ticket.
- **Híbrido completo tal como se evaluó, con un motor de frontmatter YAML
  de librería para Page**: se descartó la parte de "usar una librería de
  YAML/frontmatter existente, configurada en modo seguro" que las tres
  evaluaciones proponían como mitigación mínima, en favor de no tener
  ningún motor YAML en absoluto. El encabezado de Page es un conjunto fijo
  y chico de seis claves escalares conocidas de antemano — no necesita la
  expresividad de YAML (listas, anidamiento, tags), así que la opción de
  "YAML en modo seguro" resuelve un problema que este ADR puede evitar por
  completo en vez de solo mitigar: sin motor de lenguaje que desactivar, no
  hay superficie de RCE que auditar, y sin dump de librería que
  canonicalizar, no hay no-determinismo de orden de claves que corregir.
  Esto también evita incorporar una dependencia nueva, consistente con la
  preferencia de `CLAUDE.md` por APIs nativas de Bun que ADR-001 ya destaca
  como ventaja de la opción de persistencia elegida.
- **Hashear la re-serialización canónica del objeto parseado, en vez de
  los bytes crudos del archivo, para el CAS de ADR-001**: se descartó
  porque un cambio externo al archivo que no altera el valor semántico
  parseado (reordenar claves a mano, cambiar indentación) sería invisible
  para esa comparación, permitiendo que una escritura concurrente pise en
  silencio una edición manual — exactamente lo que ADR-001 prohíbe.
  Hashear bytes crudos (sección 4) detecta cualquier cambio, tocado por el
  motor de sync o no.
- **Usar `mtime`+tamaño en vez de un hash de contenido para el CAS**: es la
  alternativa que ADR-001 deja explícitamente abierta ("hash (o
  mtime+tamaño)"). Se descartó por ser estrictamente más frágil sin ahorrar
  costo real: el tamaño de los archivos de nido es chico (un nodo por
  archivo), así que hashear bytes crudos con `Bun.hash()` es barato, y
  evita depender de la resolución de `mtime` del filesystem (que puede
  truncarse a 1 segundo en algunos filesystems, o no cambiar de forma
  confiable ante ciertas operaciones de git) para una garantía que, si
  falla, produce exactamente el bug que el CAS existe para prevenir.
- **Embeber el hash de contenido o la metadata de `sync` dentro del propio
  archivo del nodo**: se descartó por ser circular (el hash de un archivo
  que incluye su propio hash cambia el hash al escribirlo) y por no
  aportar nada que la sección 4 no resuelva ya sin ese problema — ver
  sección 2.

## Consecuencias

**Más fácil:**

- Database y Row reutilizan directamente el patrón ya probado en
  `packages/tickets/src/store.ts` (JSON canónico + temporal-y-`rename`),
  con una sola adición real: construir el objeto de salida en el orden
  fijo de la sección 3 en vez de confiar en el orden de inserción en
  memoria.
- El índice derivado de ADR-001 lee Database y Row con un
  `JSON.parse` directo, sin paso previo de separar metadata de cuerpo —
  la representación en archivo es igual a lo que el índice necesita.
- La superficie de parseo de entrada no confiable queda acotada a dos
  parsers totales y chicos: `JSON.parse` (nativo) y un parser de ~20
  líneas para el encabezado de Page, ninguno de los dos con motor de
  lenguaje ni dependencia externa nueva — auditar "¿puede este parser
  ejecutar algo que no sea datos?" tiene una respuesta corta para los dos.
- El hueco de modelo de "¿qué significa que una Row tenga cuerpo?" queda
  cerrado por construcción: Row no tiene ese campo.
- El diff de git de una edición de prosa en una Page sigue siendo un diff
  de texto plano, línea por línea, legible — Markdown real, no un string
  JSON escapado.

**Más difícil (costo aceptado explícitamente):**

- Cada función de escritura tiene que pasar por el serializador canónico
  de la sección 3, no por un `JSON.stringify(objeto, null, 2)` directo
  sobre lo que sea que tenga el objeto en memoria en ese momento — es
  disciplina de implementación que hay que mantener en cada code path que
  escribe, no algo que un formato "simplemente da" gratis.
- Hay dos formatos y dos parsers en vez de uno: el resolutor de `parent_id`
  no puede asumir la extensión de archivo del nodo referenciado sin
  consultar primero su tipo (vía el índice id→tipo→path), agregando una
  indirección que un formato único no necesitaría. Se acepta porque el
  costo es chico y acotado (una consulta al índice) comparado con forzar
  Row o Page al formato del otro.
- El encabezado de Page es deliberadamente menos expresivo que YAML
  general (sin listas, sin anidamiento) — es correcto porque hoy Page no
  necesita más que seis campos escalares, pero si algún día una Page
  necesitara metadata estructurada además de `titulo`, este formato no la
  representa sin extenderse explícitamente (lo cual implica revisar este
  ADR, no forzar la extensión dentro del grammar actual).
- El campo `cuerpo` heredado de Page en una Database, cuando se usa, vive
  como string JSON escapado — se acepta la pérdida de editabilidad ahí
  porque es un campo secundario y raro en la práctica, no el contenido que
  define a una Database.
- La resolución de I9 (migración de esquema) va a necesitar tocar
  `valores` de muchas Rows a la vez; este ADR no resuelve esa migración,
  solo fija que cuando se resuelva, cada Row sigue escribiéndose de forma
  atómica e individual (un archivo, un CAS) — la migración como conjunto
  no es atómica, herencia directa del límite que ADR-001 ya aceptó
  explícitamente ("el conjunto no [es atómico], cada archivo individual sí
  lo es").
