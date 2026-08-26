# Modelo de dominio — v1

> Modelo inicial. Se remodela cuando aprendemos algo nuevo. Cada remodelado
> deja un registro en la sección "Historial de cambios", al final.

## Entidades

### Workspace

Raíz única del contenido. V1 asume un solo workspace por instancia de nido:
no hay requisito de multiusuario humano que justifique más de uno.

El Workspace no es una Page. Las páginas de nivel superior tienen
`parent_id = null` y `workspace_id` implícito (hay uno solo). Esto es una
aclaración explícita, no una consecuencia obvia del resto del modelo: antes
de esta revisión el documento no decía si el Workspace contaba como un nodo
más del árbol de Page o no.

- `id`
- `nombre`

### Page

Nodo de contenido genérico. Es la unidad base del árbol.

- `id`: estable, no depende de la posición ni del título.
- `titulo`
- `cuerpo`: contenido en texto/Markdown. V1 no modela bloques ricos
  (tablas, embeds, etc.), solo texto estructurado en Markdown.
- `parent_id`: otra Page, o null si es de nivel superior en el Workspace.
- `tipo`: `pagina` o `fila` (ver Row más abajo — una Row es una Page
  especializada).
- `creado_en`, `actualizado_en`
- `sync`: metadata de materialización (path en el repo, hash de contenido,
  última sincronización).

### Database

Una Database es una Page especial: define un esquema de propiedades y
contiene filas. Sigue el mismo modelo que Notion (una "full-page database").
V1 no distingue "inline database" (embebida dentro de otra página).

- Hereda todos los campos de Page.
- `propiedades`: lista ordenada de `Property` (el esquema).

### Property

Definición de una columna del esquema de una Database.

- `id`
- `nombre`
- `tipo`: uno de los tipos soportados (ver "Tipos de Property soportados").
- `config`: configuración específica del tipo. Para `select` y
  `multi_select`, `config` incluye la lista de opciones, y cada opción tiene
  su propio `id` estable además del texto visible. Una `PropertyValue`
  referencia la opción por `id`, no por texto: así, renombrar una opción no
  rompe los valores que ya la usan.
- `requerida`: booleano.

### Row

Una Row es una Page cuyo `parent_id` es una Database, y que tiene un
`PropertyValue` por cada `Property` del esquema de esa Database.

- Hereda todos los campos de Page (`tipo = "fila"`).
- `valores`: lista de `PropertyValue`, uno por cada `Property` del esquema
  padre.

### PropertyValue

Valor concreto de una Property en una Row.

- `property_id`: referencia a la Property que tipa este valor.
- `valor`: el dato, con la forma que corresponda al tipo de la Property.

### View

Consulta guardada sobre una Database.

- `id`: estable, igual que en Page. Una View sí participa del sync
  bidireccional (invariante 6): se materializa como parte del archivo de su
  Database, no como archivo propio.
- `nombre`
- `database_id`
- `filtros`: condiciones sobre Property (igualdad, comparación, contiene,
  combinables con AND/OR — expresividad exacta a definir, ver incógnita
  correspondiente).
- `orden`: lista de `(property_id, direccion)`, para permitir orden
  multi-campo.
- `columnas_visibles`: subconjunto de Property a mostrar (opcional).

## Tipos de Property soportados (propuesta inicial)

Notion tiene ~15 tipos de propiedad. No todos aportan valor a un consumidor
agente. Propuesta de subconjunto v1, a confirmar como incógnita de diseño:

- `texto`
- `numero`
- `select` (una opción de una lista cerrada, referenciada por `id` — ver
  Property)
- `multi_select` (varias opciones de una lista cerrada, mismo esquema de
  `id` que `select`)
- `fecha`
- `checkbox`
- `agente`: identifica al agente dueño o asignado a un valor. En v1 es un
  **string identificador simple** (el nombre o id del agente), no una
  entidad `Agent` con esquema propio. No hace falta más que eso: nido no
  tiene autenticación ni perfiles de agente, y no-objetivo de multiusuario
  humano tampoco lo exige. Si en el futuro hace falta más que un
  identificador (por ejemplo, capacidades o historial de un agente), se
  promueve a una entidad propia; hasta entonces, esta es una decisión
  explícita, no un vacío del modelo.

### Diferido a v2: `relacion`

La propuesta original incluía un tipo `relacion` (referencia a filas de
otra Database). Se saca del v1 real por decisión de alcance: el criterio de
éxito de la misión (`docs/00-entendimiento.md`, sección "Criterio de éxito,
en concreto") no exige relaciones entre bases, y `relacion` es la parte del
modelo con mayor riesgo para el primer ciclo de sync bidireccional —
introduce integridad referencial cruzada entre archivos, justo en la
funcionalidad que la misión declara no negociable. Queda documentada como
extensión futura, no como olvido. **Confirmado en Sprint 1** (T-0003, `docs/sprints/01-planning.md`): se
mantiene el recorte. El criterio de éxito de la misión no exige relaciones
entre bases, y `relacion` sigue siendo la parte de mayor riesgo para el
primer ciclo de sync bidireccional. Revertirlo queda abierto para v2, una
vez que el core y la sync de v1 estén probados.

## Invariantes

1. Toda Row pertenece a exactamente una Database (su `parent_id`).
2. El conjunto de `PropertyValue` de una Row corresponde 1:1 al esquema de su
   Database: ni faltan valores para propiedades requeridas, ni hay valores
   para propiedades que no existen en el esquema.
3. El tipo de cada `PropertyValue` coincide con el tipo declarado de su
   `Property`.
4. Una Page que no es Row no tiene `PropertyValue` estructurado en v1: su
   contenido es texto libre en `cuerpo`.
5. Sobre las Page hay dos grafos distintos, que no compiten por la misma
   arista:
   - **Grafo de contención** (`parent_id`): determina dónde vive cada nodo
     en el árbol y, por lo tanto, qué archivo lo representa en el repo. Es
     siempre un árbol estricto — cada nodo tiene un único `parent_id`, sin
     ciclos.
   - **Grafo de referencia** (`relacion`, diferido a v2 — ver arriba):
     conecta Row con Row, potencialmente entre Databases distintas. No
     determina ubicación de archivo y puede formar ciclos sin violar nada
     (dos filas pueden referenciarse mutuamente).
   Antes de esta revisión, el documento describía ambos como si fueran el
   mismo tipo de arista compitiendo por unicidad. No lo son: uno decide
   layout, el otro no.
6. Todo objeto persistido tiene una representación de archivo materializable
   en el repo. Toda edición de esa representación es reproducible de vuelta
   en la base. Esta es la invariante central de la misión: sync bidireccional
   sin pérdida.
7. Los `id` son estables: no cambian por reordenar, renombrar o mover un
   nodo. El sync depende de esta estabilidad para poder emparejar un archivo
   con su objeto en la base tras una edición externa.

## Lo que este modelo deja afuera, a propósito

- Bloques ricos de contenido (tablas embebidas, columnas, sub-páginas
  inline, embeds). V1 trata el cuerpo de una Page como Markdown plano.
- Permisos y multiusuario humano: no-objetivo de la misión.
- Versionado de contenido más allá de lo que dé la persistencia elegida (si
  se elige git-as-db, el historial de git ya cubre buena parte de esto).
- Comentarios sobre páginas o filas de nido. La herramienta de tickets tiene
  su propio modelo de comentarios (entre agentes, sobre tickets), que es un
  dominio distinto y no se mezcla con este.

## Historial de cambios

- **v1** (Paso 0): modelo inicial, derivado directamente de la misión.
- **v1.1** (Paso 0, tras revisión adversarial del plan —
  `docs/sprints/00-revision-plan.md`): se separó el grafo de contención del
  grafo de referencia (invariante 5), se sacó `relacion` a diferido v2, se
  aclaró que `agente` es un string identificador simple en v1, se declaró
  estabilidad de `id` para las opciones de `select`/`multi_select`, se
  aclaró que Workspace no es una Page y que View participa del sync
  bidireccional dentro del archivo de su Database.
- **v1.2** (Sprint 1, T-0003): se confirmó el recorte de `relacion` a v2 —
  ver nota en la sección correspondiente.
