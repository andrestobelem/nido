# ADR-004: Expresividad de las Views

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

`docs/02-incognitas.md` (I5) deja tres preguntas abiertas sobre View, que
`docs/01-modelo-dominio.md` ya modeló con esta forma provisoria:

> `filtros`: condiciones sobre Property (igualdad, comparación, contiene,
> combinables con AND/OR — expresividad exacta a definir, ver incógnita
> correspondiente).

y que `docs/adr/001-persistencia.md` ya restringió en el mecanismo de
resolución: **toda** resolución de una View pasa por el índice derivado en
`bun:sqlite` vía `WHERE`/`ORDER BY` — "ninguna View se resuelve leyendo y
filtrando en JS el listado completo de archivos de una Database en cada
query". Este ADR no reabre ni el modelo de persistencia (ADR-001) ni el
formato de archivo (ADR-002); toma como dadas sus decisiones y resuelve lo
que falta: (1) qué operadores de filtro expone el modelo por cada tipo de
Property, (2) cómo se combinan — solo AND, o también OR y agrupación, y con
qué costo real de traducción a SQL sobre el índice — y (3) si una View se
persiste con nombre propio dentro del archivo de su Database (que
`docs/01-modelo-dominio.md` ya aclaró que le corresponde: "View... sí
participa del sync bidireccional... se materializa como parte del archivo
de su Database") o si además existe la query ad-hoc pasada por flags de la
CLI, o ambas cosas coexisten.

**Esto no es una decisión chica**: toca la forma exacta del campo `filtros`
que tanto el serializador de ADR-002 como el traductor a SQL tienen que
respetar, y las tres preguntas de I5 están genuinamente acopladas entre sí
(la forma de combinación elegida determina qué tan simple es compartir un
solo validador/traductor entre View persistida y query ad-hoc). Se trata
como ADR completo, no como decisión menor.

Tipos de Property considerados (propuesta v1 de `docs/01-modelo-dominio.md`,
aún sujeta a I4, no cerrada por este ADR): `texto`, `numero`, `select`,
`multi_select`, `fecha`, `checkbox`, `agente`. Este ADR agrupa esos tipos en
**familias de operadores** en vez de definir un operador por tipo
individualmente, precisamente para que un cambio de I4 (agregar o sacar un
tipo) solo requiera ubicar el tipo nuevo en la familia que le corresponde,
sin reabrir esta decisión.

## Decisión

### 1. Operadores de filtro, agrupados por familia de tipo

**Unarios, comunes a toda familia**: `vacio`, `no_vacio` (sin `valor`).
Semántica exacta (borde importante, ver más abajo): `vacio` es verdadero si
la Property no tiene `PropertyValue` en absoluto para esa Row (legal para
una Property no requerida, invariante 2 de `docs/01-modelo-dominio.md`) **o**
si lo tiene con un valor vacío según su tipo (`texto: ""`, `multi_select:
[]`). Un agente que filtra "sin descripción" no debería tener que saber si
internamente el valor está ausente o es una cadena vacía — ambos estados
son indistinguibles desde el filtro.

- **Familia `escalar_comparable`** (`numero`, `fecha`, y los campos base
  `creado_en`/`actualizado_en`): `igual`, `distinto`, `mayor_que`,
  `mayor_o_igual`, `menor_que`, `menor_o_igual`, `vacio`, `no_vacio`.
- **Familia `texto`** (`texto`, `agente`, y el campo base `titulo`):
  `igual`, `distinto`, `contiene`, `no_contiene`, `empieza_con`,
  `termina_con`, `vacio`, `no_vacio`. Sin comparación de orden
  (`mayor_que`/`menor_que`) — un orden alfabético sobre texto libre no
  aporta valor real a un consumidor agente y complica la validación sin
  necesidad pedida.
- **Familia `checkbox`**: `igual` (valor `true`/`false`), `vacio`,
  `no_vacio`.
- **Familia `select`**: `igual`, `distinto` (valor: un id de opción),
  `es_alguno_de`, `no_es_ninguno_de` (valor: array de ids de opción),
  `vacio`, `no_vacio`.
- **Familia `multi_select`**: `contiene`, `no_contiene` (valor: un id de
  opción), `contiene_alguno_de`, `contiene_todos_de` (valor: array de ids
  de opción), `vacio`, `no_vacio`. **No admite `orden`** (ver sección 2):
  ordenar por un campo de múltiples valores no tiene una respuesta única.
- **Campos base sin familia de Property**: `id` admite únicamente `igual`,
  `distinto` (comparar por substring o vacío no tiene un caso de uso real
  y angosta la validación a propósito). `id`, `creado_en` y
  `actualizado_en` **rechazan** `vacio`/`no_vacio`: no es que sean "siempre
  no-vacíos" de forma trivialmente verdadera — es un error de validación
  filtrar por eso, porque estructuralmente esos campos nunca pueden faltar
  ni ser cadena vacía (un `id` generado nunca es `""`, una fecha ISO
  completa nunca es `""`), así que el filtro no tiene contenido semántico
  y se rechaza en vez de aceptarse en silencio como una tautología. `titulo`
  sí admite `vacio`/`no_vacio` (a diferencia de los otros campos base):
  siempre está presente como clave, pero su valor puede ser `""`, y
  encontrar páginas sin título es un caso de uso real. **`parent_id` no es
  filtrable**: una View ya está fijada a una sola Database, así que
  `parent_id` es constante para todas las filas candidatas — filtrar por
  él no discrimina nada, exclusión deliberada, no un olvido.

Para `select`/`multi_select`, el `valor` que recibe un filtro (desde la
CLI o desde el JSON persistido) se resuelve contra `config.opciones` de la
Property al momento de construir el filtro — igual que una
`PropertyValue`, el filtro persistido guarda siempre el **id** de la
opción, nunca su texto visible, por la misma razón de estabilidad que
`docs/01-modelo-dominio.md` ya fija para `PropertyValue`.

### 2. Combinación: AND/OR con agrupación acotada a profundidad 2 — no arbitraria, no solo-AND

La forma de `filtros` es un árbol de dos niveles como máximo:

```
Grupo = { combinador: "y" | "o", condiciones: (CondicionHoja | Grupo)[] }
CondicionHoja = { campo: RefCampo, operador: string, valor?: JSONValue }
```

con la regla explícita: **un `Grupo` puede contener otro `Grupo` como hijo,
pero ese hijo no puede a su vez contener otro `Grupo`** — profundidad máxima
2 (el `Grupo` raíz de la View, y como mucho un nivel de sub-`Grupo`s
compuestos solo de `CondicionHoja`). `filtros` en sí es `Grupo | null`;
`null` (o el campo ausente) significa "sin filtro, todas las filas" — caso
especial que se resuelve **antes** de emitir SQL, nunca como un `Grupo`
vacío (ver más abajo por qué).

Esto da expresividad simétrica real (AND de grupos-OR, u OR de grupos-AND,
o mezcla, indistintamente en qué nivel se elige cada combinador) para los
dos casos que un agente realmente necesita — "todas estas condiciones" y
"estado es A o B, además vencida" — sin permitir anidamiento sin límite.

**Por qué el límite es 2 y no arbitrario, y por qué eso no es donde está el
costo real de traducción a SQL** (que es lo que este ticket pide evaluar
explícitamente): SQL ya soporta anidamiento de `AND`/`OR` sin límite de
forma nativa — un traductor recursivo que emite paréntesis por cada
`Grupo` es exactamente igual de simple para profundidad 2 que para
profundidad arbitraria. El costo real de permitir profundidad arbitraria
**no está en el traductor**, está en dos lugares distintos:

1. **Validar entrada no confiable** (mentalidad de ADR-002: cualquier
   archivo de Database, tocado a mano o por un merge fuera del motor de
   sync, es entrada no confiable en cada lectura). Un árbol de profundidad
   no acotada leído de un archivo JSON puede construirse — accidental o
   deliberadamente — con miles de niveles de anidamiento, y un traductor
   recursivo ingenuo sobre eso arriesga un stack overflow al parsear o
   traducir. Con profundidad 2, ese riesgo se cierra **por construcción del
   esquema esperado** y además se verifica explícitamente en la validación
   (si un archivo o un flag de CLI trae un `Grupo` de profundidad 3, se
   rechaza esa View/query completa con un error de validación, no se
   intenta truncar ni aplanar en silencio) — defensa en dos capas, no solo
   una.
2. **Ergonomía de expresarlo desde la CLI**: la misión no pide agrupación
   sin límite (`docs/00-entendimiento.md`, "Criterio de éxito": "consultar
   vistas filtradas y ordenadas", sin exigir árboles booleanos generales),
   así que pagar la complejidad de una gramática o de una validación más
   laxa por una expresividad que nadie pidió no se justifica hoy. Si en el
   futuro hace falta más, se revisa este ADR explícitamente.

**Dónde sí está el costo real**, y que la elección de combinador NO
determina: la clase de almacenamiento del tipo de dato. Se propone (a nivel
ilustrativo — el detalle exacto de nombres de tabla es libre para quien
implemente el índice, siempre que preserve estas dos propiedades) un
índice derivado con esta forma:

- `filas(row_id, database_id, titulo, creado_en, actualizado_en)`: un
  registro por Row, campos base.
- `valores_escalares(row_id, property_id, valor_texto, valor_numero,
  valor_bool)`, clave `(row_id, property_id)`: un registro por
  `PropertyValue` de tipo escalar (`texto`, `agente`, `select` guardando el
  id de opción, `fecha` guardando el string `YYYY-MM-DD` tal cual sin
  parsear — igual que ADR-002 lo deja opaco —, `checkbox` como 0/1,
  `numero` como `REAL`), con índice compuesto por `(property_id,
  valor_texto)` / `(property_id, valor_numero)`.
- `valores_multi(row_id, property_id, opcion_id)`, clave `(row_id,
  property_id, opcion_id)`: un registro por elemento de un `multi_select`,
  índice por `(property_id, opcion_id)`.

Se prefiere esta forma tipo EAV con columnas tipadas por clase de
almacenamiento, en vez de una tabla ancha por Database con una columna SQL
real por Property (la alternativa más "SQL-idiomática"), precisamente
porque la tabla ancha necesita `ALTER TABLE` cada vez que cambia el esquema
de una Database — acoplando el índice derivado a como se resuelva I9
(migración de esquema, todavía abierta). Con la forma EAV, agregar o quitar
una Property nunca requiere DDL, solo insertar o borrar registros — el
índice sigue siendo "reconstruible sin riesgo" (ADR-001) sin depender de
sincronizar cambios de esquema con cambios de tabla.

Con esta forma, cada `CondicionHoja` sobre una Property escalar es un
`EXISTS`/join acotado por `property_id` contra `valores_escalares`; sobre
`multi_select` es un `EXISTS`/join contra `valores_multi`. **Combinar N de
esas condiciones con `AND` o con `OR` dentro de un `WHERE` tiene el mismo
costo de traducción y de ejecución en SQLite** — el motor no distingue
"caro" de "barato" por el conectivo lógico una vez que cada hoja ya es una
expresión booleana independiente. Lo que sí varía genuinamente el costo es
el **tipo de campo** (escalar de una tabla vs. multivaluado que necesita
`EXISTS`) y el **manejo de ausencia/`NULL`** por operador (ver reglas de
borde). Esa es la respuesta concreta a "pensar el costo real de traducir
cada opción a SQL": la variable de costo es la familia de tipo, no el
combinador.

**Reglas de borde de traducción, decididas explícitamente** (para que
ninguna quede a interpretación de quien implemente el traductor):

- **Operadores negativos y ausencia** (lógica de tres valores de SQL): se
  define que `no_contiene`, `distinto`, `no_es_ninguno_de` y afines tratan
  una Row sin esa Property (o sin ese valor) como que **sí** satisface la
  condición negativa — una fila sin la propiedad "no la contiene", "es
  distinta" de cualquier valor. Esto es lo intuitivo para un agente que
  pide "las que no tienen X", pero es **lo opuesto** de lo que da la
  propagación `NULL` por defecto de SQL (`NOT (NULL LIKE ...)` es `NULL`,
  que en `WHERE` se evalúa como falso, excluyendo justo las filas que el
  agente esperaba encontrar). El traductor tiene que emitir explícitamente
  `(valor IS NULL OR NOT (...))` para cada operador negativo, no confiar
  en la propagación de `NULL` de SQL.
- **`contiene`/`no_contiene` sobre texto usa `INSTR`, no `LIKE`**: usar
  `LIKE '%'||?||'%'` obligaría a escapar `%`/`_` en el valor que provee el
  agente (entrada arbitraria) para que no se interprete como wildcard;
  `INSTR(columna, ?) > 0` es una búsqueda de substring literal sin
  metacaracteres que escapar, cerrando esa clase de bug por completo en
  vez de mitigarla con `ESCAPE`.
- **`igual`/`contiene` sobre texto son sensibles a mayúsculas y acentos**
  (comparación byte-exacta, sin normalización Unicode ni fold de
  mayúsculas): se decide explícitamente en vez de heredar el
  comportamiento por defecto de SQLite, que es inconsistente entre `=`
  (case-sensitive) y `LIKE` (case-insensitive solo para ASCII a-z, no para
  acentos) — una mezcla que produciría resultados distintos según qué
  operador se use sobre el mismo valor. Búsqueda case-insensitive queda
  fuera de v1, no pedida por el criterio de éxito de la misión.
- **`Grupo` vacío es un error de validación, no se traduce a SQL**: un
  `Grupo` con `condiciones: []` no se interpreta como "siempre verdadero"
  ni "siempre falso" (ambas lecturas son razonables en lógica formal para
  AND-vacío vs. OR-vacío respectivamente, lo cual es exactamente el
  problema — la ambigüedad matemática se convierte en un bug silencioso si
  el traductor asume una de las dos). Se rechaza en validación con un
  error explícito. El único lugar donde "sin condiciones" es válido y
  significa "todas las filas" es `filtros` ausente/`null` en la raíz de la
  View o la query — un caso especial resuelto antes de tocar el traductor,
  nunca un `Grupo` vacío disfrazado.
- **Opción de `select`/`multi_select` inexistente al momento de resolver
  la View** (por ejemplo, alguien borró la opción a mano del archivo de la
  Database después de crear el filtro): la condición simplemente no
  matchea ninguna fila (comparar contra un id que no existe en
  `config.opciones` no es un error de sintaxis SQL), pero la CLI reporta
  un diagnóstico visible ("la View X filtra por una opción que ya no
  existe en la Property Y") en vez de fallar en silencio con un resultado
  vacío sin explicación — mismo espíritu que el checklist de ADR-002
  ("nunca... silenciosa").
- **`orden` por Property**: se traduce como un `LEFT JOIN` (no `INNER`)
  contra `valores_escalares` filtrado por `property_id`, para que una Row
  sin esa Property siga apareciendo en el resultado. Las filas sin valor
  se ordenan siempre al final, sin importar `asc`/`desc`
  (`ORDER BY ... NULLS LAST` explícito) — decisión explícita, no el
  comportamiento por defecto de SQLite (que pone `NULL` primero en `ASC`).
  `orden` sobre `fecha` o sobre `creado_en`/`actualizado_en` ordena
  correctamente por comparación de string plana, sin parsear a `Date`: un
  string `YYYY-MM-DD` o un ISO-8601 UTC completo con milisegundos ordena
  lexicográficamente igual que cronológicamente, así que no hace falta
  ninguna conversión — consistente con que ADR-002 ya declara esos campos
  opacos. `orden` sobre `select` ordena por el id de la opción
  (lexicográfico), **no** por la posición de la opción en
  `config.opciones` de la Property — más simple de traducir (columna
  plana, sin resolver posición por cada fila) a costa de un orden menos
  "natural"; se documenta como limitación conocida, no como omisión.
  `orden` sobre `texto` usa la colación `BINARY` por defecto de SQLite
  (orden por valor de byte UTF-8), que no es un orden alfabético natural
  para español acentuado (`á` no cae junto a `a`); se documenta como
  limitación conocida y se deja fuera de este ADR una colación
  específica para español — determinístico y usable, no "bonito".
  **`multi_select` no es un campo válido de `orden`** (rechazado en
  validación): no hay una respuesta única de qué valor de un campo
  multivaluado determina el orden.

### 3. Persistencia: View con nombre y query ad-hoc coexisten, mismo motor

`docs/01-modelo-dominio.md` y `docs/adr/001-persistencia.md` ya fijan que
una View con `nombre` persiste dentro del archivo JSON de su Database (no
en archivo propio) y participa del sync bidireccional — este ADR no
reabre eso. Lo que decide acá es que **además** existe la query ad-hoc por
flags de CLI que no persiste nada ni toca el archivo de la Database, y que
**ambas usan exactamente la misma forma de `filtros`/`orden`/
`columnas_visibles` y el mismo validador/traductor** — no hay una gramática
para "View guardada" y otra distinta para "query de una vez". Concretamente
(nombres de flag ilustrativos, ajustables en implementación sin reabrir
este ADR — lo que no cambia sin nueva revisión es la forma del `Grupo` y el
resto de las reglas de la sección 2):

```
nido db query <database_id> --filtro '<json Grupo>' \
  --orden "propiedad_a:asc,propiedad_b:desc" \
  --columnas "propiedad_a,propiedad_c"

nido db query <database_id> --view <nombre>

nido view create <database_id> --nombre "<nombre>" \
  --filtro '<json Grupo>' --orden "..." --columnas "..."
```

El filtro ad-hoc se pasa como JSON inline (la misma forma persistida), no
como una mini-gramática de shell separada (`campo:operador:valor,...`):
inventar una segunda gramática solo para la CLI significaría mantener dos
parsers, dos validadores y dos superficies de casos borde de escaping de
shell (comas, comillas, `:` dentro de un valor de texto) para expresar
exactamente lo mismo que ya hay que validar para la View persistida. Un
agente generando JSON no paga costo de ergonomía extra por esto. `orden` sí
tiene una sintaxis plana simple (`campo:direccion,campo:direccion`) porque
no tiene el problema de anidamiento de `filtros` — es una lista ordenada,
no un árbol.

**Por qué coexisten y no "solo View con nombre" ni "solo ad-hoc"**: forzar
que toda consulta pase por crear una View persistida primero obligaría a
escribir al archivo de la Database — bajo CAS por archivo (ADR-001) — por
cada consulta exploratoria de un agente, incluidas las que nunca se van a
reusar. Eso es exactamente la clase de escritura innecesaria y de colisión
de CAS entre agentes que ADR-001 quiere minimizar (dos agentes corriendo
consultas de una vez sobre la misma Database competirían por el mismo
archivo sin necesidad real). La query ad-hoc es de solo lectura sobre el
índice derivado y no participa del CAS en absoluto.

En v1, `--view <nombre>` y (`--filtro`/`--orden`/`--columnas`) son
**mutuamente excluyentes**: no hay semántica de "partir de una View
guardada y sobreescribir su orden" en esta decisión — combinarlas exige
definir si el override reemplaza o se combina con AND al filtro guardado,
una pregunta que no hace falta responder para el criterio de éxito actual.
Queda explícitamente diferido, no resuelto por omisión.

### 4. Granularidad de invalidez de una View: extiende ADR-002, no la reabre

ADR-002 (checklist de entrada no confiable, punto 9) fija "falla cerrada,
nunca silenciosa ni total" a nivel de **archivo completo**. Este ADR aplica
el mismo principio a una granularidad más fina, porque las Views de una
Database viven todas dentro del mismo archivo JSON: una View individual
mal formada (`Grupo` de profundidad > 2, operador que no existe para la
familia del campo referenciado, `campo` que referencia un `property_id` que
ya no existe en el esquema de la Database — cruce directo con I9, todavía
abierta) **no invalida el archivo de la Database entero**. Se excluye solo
esa View de la lista de Views resolubles, se reporta como diagnóstico
individual, y las Properties, Rows y el resto de las Views válidas de esa
misma Database siguen funcionando con normalidad. Invalidar toda la
Database por una sola View rota sería un radio de daño desproporcionado
frente al problema real.

## Alternativas consideradas

- **Solo AND, sin OR ni agrupación**: se descartó por insuficiente para el
  caso real más común después de "todas estas condiciones": "estado es A o
  B, y además está vencida". Los operadores `es_alguno_de`/
  `contiene_alguno_de` cubren el caso de un solo campo con múltiples
  valores aceptables, pero no cubren OR entre condiciones de **campos
  distintos** (por ejemplo, "sin asignar O vencida"), que sí necesita un
  combinador real.
- **Árbol de AND/OR anidado sin límite de profundidad**: se descartó no
  porque cueste más traducir a SQL (no cuesta más: SQL soporta anidamiento
  arbitrario nativo, un traductor recursivo es igual de simple en cualquier
  profundidad), sino porque el costo real cae en validar entrada no
  confiable de forma acotada (una Database editada a mano o corrupta puede
  traer un árbol patológicamente profundo) y en que la misión no pide esa
  expresividad. Profundidad 2 da el 100% de los casos reales identificados
  sin ese costo.
- **Tabla ancha por Database con una columna SQL real por Property**: más
  "SQL-idiomática" y con mejor uso de índices nativos por columna, pero
  acopla el índice derivado a `ALTER TABLE` sincronizado con cada cambio de
  esquema — justo el problema que I9 (migración de esquema) todavía no
  resolvió. La forma EAV con columnas tipadas por clase de almacenamiento
  evita esa dependencia a costa de un `EXISTS`/join por condición en vez de
  una columna plana, aceptable en la escala declarada por ADR-001
  ("Databases de cientos a pocos miles de Rows").
- **`LIKE` con wildcards para `contiene`**: se descartó por el problema de
  escapar `%`/`_` en un valor de búsqueda arbitrario provisto por un
  agente; `INSTR` no tiene metacaracteres que escapar, cerrando la clase de
  bug en la raíz en vez de mitigarla con `ESCAPE`.
- **Propagación `NULL` por defecto de SQL para operadores negativos**: se
  descartó porque produce el resultado opuesto al intuitivo — "las filas
  que no tienen esta propiedad" quedarían excluidas de un filtro
  `no_contiene`, justo las filas que ese filtro debería encontrar primero.
- **Exigir que toda consulta pase por una View persistida (sin ad-hoc)**:
  se descartó porque fuerza una escritura al archivo de la Database (bajo
  CAS de ADR-001) por cada consulta exploratoria de un agente, generando
  colisiones de concurrencia innecesarias para operaciones que son de
  solo lectura por naturaleza.
- **Una gramática de texto plano separada para el filtro ad-hoc de CLI
  (`campo:operador:valor` encadenado)**: se descartó porque duplica el
  validador/traductor de la forma `Grupo` ya definida para la View
  persistida, sumando una segunda superficie de casos borde de escaping de
  shell sin necesidad — reusar JSON inline para ambos casos es más chico de
  mantener y de testear.

## Consecuencias

**Más fácil:**

- Un solo validador y un solo traductor filtro→SQL sirve tanto para Views
  persistidas como para queries ad-hoc — una sola superficie de casos
  borde para testear, no dos.
- Agregar o quitar una Property nunca requiere `ALTER TABLE` en el índice
  derivado (forma EAV): el índice sigue siendo "descartable y
  reconstruible sin riesgo" (ADR-001) sin acoplarse a cómo se resuelva I9.
- La combinación AND/OR/agrupación acotada es gratis de traducir a SQL: no
  hay una ruta de código separada "cara" para OR vs. AND, así que ampliar
  qué combinaciones se exponen en la CLI no exige tocar el traductor.
- Las reglas explícitas de ausencia/`NULL` (sección 2) cierran por
  adelantado la clase de bug de lógica de tres valores más común en
  filtros SQL escritos a mano, en vez de descubrirla en producción cuando
  un agente reporte un resultado "que debería estar pero no está".
- Una View rota no puede tumbar toda una Database: el radio de daño de un
  archivo con una View mal formada queda acotado a esa View sola.

**Más difícil (costo aceptado explícitamente):**

- Cada condición de filtro sobre una Property (no sobre un campo base) es
  un `EXISTS`/join contra `valores_escalares` o `valores_multi`, no una
  columna plana de una tabla ancha — más caro por condición que el diseño
  alternativo descartado, aceptable a la escala declarada por ADR-001 pero
  a revisar si esa escala cambia.
- La profundidad de agrupación 2 es un límite real: si en el futuro
  aparece un caso de uso genuino que necesite un tercer nivel, hace falta
  reabrir este ADR explícitamente, no forzar el límite dentro del esquema
  actual (mismo patrón de costo aceptado que ADR-002 ya documenta para el
  encabezado de Page).
- El traductor tiene que implementar las reglas de ausencia/`NULL` de
  forma explícita por cada operador negativo (no puede confiar en el
  comportamiento por defecto de SQL) — es disciplina de implementación
  concreta, no algo que "el motor ya da gratis".
- `orden` sobre `select` (por id, no por posición declarada en
  `config.opciones`) y sobre `texto` (colación `BINARY`, no
  locale-aware) son decisiones que priorizan traducción simple sobre
  presentación "natural"; si un caso de uso futuro necesita orden
  declarado de opciones o colación de español, es una extensión explícita
  a este ADR, no algo que el formato actual ya resuelva.
- Distinguir `campo_base` de `propiedad` en `RefCampo`, y por tipo de
  `campo_base` qué operadores unarios aplican (`titulo` sí admite
  `vacio`/`no_vacio`, `id`/`creado_en`/`actualizado_en` no), es una rama
  más de validación que mantener — se acepta porque cierra un caso donde
  aceptar el filtro en silencio sería una tautología sin sentido, no un
  filtro real.
