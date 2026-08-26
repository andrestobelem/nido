# Gate de aceptación: round-trip sin pérdida (T-0011)

Este documento declara, en un solo lugar, qué significa "round-trip sin
pérdida" para nido en términos ejecutables (`bun test`), y qué tests
concretos lo verifican. No fija ninguna decisión nueva: los criterios ya
están fijados por `docs/adr/001-persistencia.md` y
`docs/adr/002-formato-de-archivos-y-sync.md`; este documento enlaza a esas
secciones en vez de repetirlas, y agrega el único caso que ninguna capa
anterior (T-0015 a T-0019) ejercitaba explícitamente: **archivo borrado
externamente**.

Es un gate, no una pieza de dominio: `packages/core/test/gate-round-trip.test.ts`
no agrega ningún comportamiento nuevo a `../src/`, solo confirma con tests
de aceptación de más alto nivel que lo que T-0015–T-0019 ya implementan se
sostiene end-to-end. T-0012 (sync real: detectar cambios externos al árbol
y reconciliarlos) construye encima de este gate, no al revés.

## Qué se garantiza

1. **Repo → base → repo sin pérdida de contenido**, para Page, Database y
   Row, incluyendo contenido adversarial: unicode multi-byte, emoji
   (incluyendo secuencias compuestas con ZWJ/modificador de tono), comillas
   dobles/simples y backslashes en texto libre, valores límite de `numero`
   (`MAX_SAFE_INTEGER`, `MIN_SAFE_INTEGER`, `MAX_VALUE`, `EPSILON`, cero
   positivo), valores límite de `fecha` (año 1, año 9999, 29 de febrero), y
   `multi_select` con muchas opciones (60) y duplicados deliberados en el
   valor de entrada. La relectura simula **un proceso nuevo**: se
   reconstruye el índice desde cero con `construirIndice` en vez de reusar
   el objeto en memoria recién escrito — la garantía que importa es "lo que
   quedó en disco es correcto", no "el objeto en memoria de este mismo
   proceso sigue siendo correcto".

   Esto es exactamente la propiedad que `docs/00-entendimiento.md` declara
   no negociable ("todo lo que vive en la base se puede materializar como
   archivos... y toda edición de esos archivos se puede reflejar de vuelta")
   y que `docs/adr/001-persistencia.md` resuelve estructuralmente al hacer
   de los archivos planos la única fuente de verdad — este gate confirma
   que esa resolución efectivamente se sostiene con datos reales, no solo
   en el diseño.

2. **Serialización canónica y determinista**, tal como la fija
   `docs/adr/002-formato-de-archivos-y-sync.md` sección 3: orden fijo de
   claves, fechas ISO-8601 completas verbatim (nunca reparseadas),
   `multi_select` ordenado y deduplicado, campos opcionales ausentes vs.
   `null` sin ambigüedad. Este gate no repite los tests de la regla en sí
   (ya cubiertos por `packages/core/test/formato-database-row.test.ts` y
   `formato-page.test.ts`); lo que aporta es confirmar que esa
   canonicalización sobrevive un ciclo completo de escritura-y-relectura
   con datos adversariales reales, no solo con los casos mínimos de la capa
   de formato.

3. **Falla clara y tipada ante un archivo que debería existir y ya no
   existe** — el caso nuevo de este ticket, sea porque se borró a mano,
   porque un merge/checkout lo quitó por fuera del motor de sync, o
   cualquier otra causa externa al motor de escritura de nido:
   - Una lectura puntual (`leerPage`/`leerDatabase`/`leerRow` de
     `../src/crud/*.ts`, que delegan en `../src/almacenamiento/lectura.ts`)
     sobre un archivo que ya no está lanza `NodoNoEncontrado` — nunca un
     error críptico del filesystem, nunca un valor adivinado.
   - `construirIndice` (`../src/indice/construccion.ts`) reconstruido desde
     cero después del borrado simplemente no incluye ese nodo, sin ningún
     diagnóstico espurio: un archivo que desapareció antes de que el
     escaneo lo viera no es distinguible de un archivo que nunca existió
     (ADR-002 sección 5, punto 9 — "carrera benigna").
   - Si el archivo borrado es una Database que tenía Rows, esas Rows quedan
     huérfanas: `construirIndice` las excluye del índice y las reporta
     explícitamente con diagnóstico `PARENT_ID_INVALIDO` — nunca
     desaparecen en silencio.
   - Un intento de actualización (`actualizarPage`/`actualizarDatabase`/
     `actualizarRow`) con un hash capturado antes del borrado recibe
     `ConflictoDeEscritura` — el mismo error tipado que un conflicto de
     contenido, porque para el CAS de ADR-001 "el archivo cambió" y "el
     archivo desapareció" son la misma clase de evento (el hash esperado ya
     no coincide con el estado real en disco).
   - Resolver una View sobre una Database borrada (`resolverVistaDeDatabase`)
     recibe `DatabaseNoIndexada` — nunca un error interno de `bun:sqlite` o
     de `node:fs` sin contexto de dominio.

## Qué tests lo verifican

Todo en `packages/core/test/gate-round-trip.test.ts`:

- `gate round-trip: Page con contenido adversarial, reconstruyendo el
  índice desde cero` — título/cuerpo con unicode, emoji, comillas,
  backslashes; verificado tanto vía `construirIndice` (proceso nuevo) como
  vía `leerPage` puntual.
- `gate round-trip: Database + Row con contenido adversarial,
  reconstruyendo el índice desde cero` — tres tests:
  - las siete `Property` del subconjunto v1 (`docs/adr/003-tipos-de-property.md`)
    con valores adversariales, incluyendo `multi_select` con 60 opciones y
    duplicados en el valor de entrada.
  - valores límite adicionales de `numero`/`fecha` en filas separadas.
  - una `View` con filtro y orden multi-campo sobre esas properties,
    resuelta vía `resolverVistaDeDatabase` (que internamente reconstruye su
    propio índice fresco — es, por construcción, la vía "proceso nuevo"
    para una View).
- `gate: archivo borrado externamente — falla de forma clara, nunca en
  silencio ni con un stack críptico` — siete tests, uno por cada
  combinación de {Page, Database, Row} × {lectura puntual, reconstrucción
  de índice, actualización con CAS} más el caso de Rows huérfanas y el de
  `resolverVistaDeDatabase`. El borrado se hace con `node:fs` `unlink`
  directo, nunca vía la API de nido — así el test refleja el caso real que
  le importa a T-0012 (un archivo que cambió por fuera del motor de sync).

## Qué queda explícitamente fuera de este gate

- **CAS bajo escritura concurrente real** (dos escrituras que corren en
  paralelo sobre el mismo archivo, `Promise.allSettled` sobre dos
  intentos): ya cubierto por
  `packages/core/test/almacenamiento-escritura.test.ts`, describe block
  `"CAS bajo concurrencia real (dos escrituras que corren en paralelo, no
  una tras otra)"` — dos tests, uno para el caso de actualización y otro
  para el caso de creación, cada uno confirmando "exactamente una tiene
  éxito, la otra recibe `ConflictoDeEscritura` (nunca las dos)". Este gate
  no los reimplementa; los referencia.
- **La política de conflicto en sí** (detectar-y-reportar vía CAS,
  escritura atómica temporal-y-`rename`/`link`, nunca fusión silenciosa) ya
  está declarada y justificada en `docs/adr/001-persistencia.md` (puntos
  1–4 de la Decisión) y, para qué bytes exactos se hashean, en
  `docs/adr/002-formato-de-archivos-y-sync.md` sección 4. Este gate la
  ejercita (sección "archivo borrado externamente" arriba) pero no la
  redefine.
- **Migración de esquema con Rows existentes** (agregar/promover/quitar una
  Property, huérfanos de `PropertyValue`): ADR-006, con su propio archivo
  de tests, `packages/core/test/crud-migracion-esquema.test.ts`.
- **Sync real**: detectar qué cambió en el árbol de archivos desde la
  última vez que nido lo miró (un archivo editado a mano, un `git
  checkout`/merge/cherry-pick que movió el árbol a un estado nuevo) y
  reconciliarlo — eso es T-0012, todavía no implementado. Este gate
  confirma que la base sobre la que T-0012 va a construir (formato,
  almacenamiento, índice, CRUD) sostiene un round-trip sin pérdida y falla
  de forma clara ante un archivo faltante; no implementa ninguna detección
  de cambios ni ninguna reconciliación.
- **El checklist completo de validación de entrada no confiable** (ADR-002
  sección 5, los nueve puntos) contra archivos manipulados adversarialmente
  a mano (`id` falsificado, `parent_id` colgante, ciclos, path traversal):
  ya tiene su propia cobertura en
  `packages/core/test/almacenamiento-confinamiento.test.ts`,
  `indice-construccion.test.ts` e `invariantes.test.ts`. El caso de
  "archivo borrado" de este gate es un caso nuevo dentro de ese mismo
  checklist (punto 9, "falla cerrada"), no un reemplazo del resto.
