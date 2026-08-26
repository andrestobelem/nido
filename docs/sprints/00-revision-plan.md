# Revisión adversarial del plan — Paso 0

**Tipo**: workflow de decisión (no es un ritual de sprint; ver
`docs/03-plan.md` para dónde arrancan los rituales de Scrum).
**Cuándo**: antes de escribir la primera línea de código de nido.
**Cómo**: `adversarial-plan-review` sobre `docs/00-entendimiento.md`,
`docs/01-modelo-dominio.md`, `docs/02-incognitas.md` y `docs/03-plan.md`.
Cuatro ángulos (correctness, security, maintainability, scope) más una
síntesis.

## Por qué se hizo

El plan y el modelo de dominio de Paso 0 son la base de todo lo que sigue.
Un error de orden de dependencias o una invariante contradictoria ahí se
propaga a cada ticket del backlog. Vale la pena una revisión adversarial
antes de comprometerse.

## Cambios aplicados (must-fix, consenso de los 4 ángulos)

| Cambio | Dónde |
|---|---|
| Separar grafo de contención (`parent_id`, árbol estricto) del grafo de referencia (`relacion`, puede ciclar) | `docs/01-modelo-dominio.md`, invariante 5 |
| `agente` es un string identificador simple en v1, no una entidad `Agent` | `docs/01-modelo-dominio.md`, tipos de Property |
| Opciones de `select`/`multi_select` tienen `id` estable, no se referencian por texto | `docs/01-modelo-dominio.md`, entidad Property |
| Workspace no es una Page; View participa del sync dentro del archivo de su Database | `docs/01-modelo-dominio.md` |
| I3 (concurrencia) deja de ser incógnita flotante: se resuelve junto con I1/I2, el ADR de persistencia debe declarar la garantía de atomicidad como criterio de aceptación | `docs/02-incognitas.md`, I1/I3 |
| La herramienta de tickets no bloquea el ADR de persistencia: se recorta a archivos planos + git, con su propio mecanismo de escritura atómica, y se declara explícitamente que su storage **no** es el de nido | `docs/03-plan.md`, y diseño de `packages/tickets` |
| Nueva incógnita: migración de esquema (qué pasa con Rows existentes al agregar/quitar una Property requerida) | `docs/02-incognitas.md`, I9 |
| I2 (mecanismo de sync) se extiende con validación de entrada no confiable: ids falsificados o duplicados, `parent_id` colgante, path traversal, árbol tocado por git fuera del motor de sync | `docs/02-incognitas.md`, I2 |
| I7 (formato de ADR) se resuelve ahora, no queda como incógnita abierta | `docs/adr/000-formato-de-adr.md` |
| Nuevo gate antes de implementar sync: criterios de aceptación de round-trip ejecutables con `bun test`, incluyendo caso de escritura concurrente y de archivo borrado | `docs/03-plan.md`, paso 10 |

## Cambio de alcance aplicado (no solo must-fix)

`relacion` (referencia entre filas de distintas Databases) se saca del v1
real y se documenta como diferido a v2. Es el recorte de riesgo más grande
disponible: el criterio de éxito de la misión no lo exige, y es la parte
del modelo con más riesgo para el primer ciclo de sync bidireccional.
Marcado en `docs/01-modelo-dominio.md` como decisión a confirmar en el
primer sprint del equipo, no como decisión unilateral de este documento.

## Diferido, con razón explícita

- Trazabilidad de qué agente escribió último un objeto (más allá del hash
  de sync). Útil para diagnosticar pérdida de datos si ocurre; no bloquea
  el arranque.
- Lista de operaciones de git prohibidas para agentes autónomos (rebase,
  force-push, `git clean`) — solo aplica si el ADR de persistencia elige
  git-as-db, así que se escribe junto con ese ADR, no antes.
- Migrar el backlog de tickets al propio nido, una vez que el core exista.

## Riesgos aceptados explícitamente

1. Sin locking distribuido real en v1: la garantía mínima es
   detectar-y-reportar conflicto más escritura atómica (por ejemplo,
   write-then-rename). Alcanza para el tamaño de equipo previsto. Debe
   quedar escrito en el ADR de persistencia, no implícito.
2. La herramienta de tickets usa un modelo de storage distinto al de nido.
   Aceptado para no acoplarla a una decisión de arquitectura que todavía no
   se tomó. El costo es una migración futura, ya declarada como tal.
3. El "nido usable" del criterio de éxito se valida con un agente operando
   por vez. Concurrencia entre varios agentes se prueba, pero no es el
   caso central del MVP.

## Resultado completo

El resultado íntegro del workflow (los cuatro ángulos sin resumir) queda en
el journal del workflow, no se transcribe entero aquí para no duplicar
contenido que puede quedar desactualizado. Este documento es la síntesis
que se usó para decidir.
