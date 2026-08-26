# Sprint 5 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

T-0010 ("Core de nido") resultó demasiado grande para un solo ticket; se
dividió en T-0015 a T-0019 (`docs/sprints/05-planning.md`). Las cinco
capas, en orden de dependencia real:

1. **T-0015** — serializador de Page (Markdown + encabezado propio).
2. **T-0016** — serializador canónico de Database/Row (JSON).
3. **T-0017** — motor de escritura con CAS por archivo.
4. **T-0018** — índice derivado en `bun:sqlite`, resolución de Views.
5. **T-0019** — CRUD de alto nivel + migración de esquema. Cierra T-0010.

## Qué se entregó

Las cinco, **todas hecho**, con `packages/core` pasando de tipos puros
(T-0009) a una librería que de verdad lee y escribe el filesystem: 261
tests, `bun test` y `bunx tsc --noEmit` sin errores.

Cada capa pasó por su propio ciclo implementar → revisar → corregir antes
de cerrarse (regla de sprint 1, aplicada por primera vez a código que
otro ticket va a usar de inmediato — a diferencia de T-0009, donde solo
T-0010 dependía de ello más adelante en el tiempo). El resultado justificó
la regla con creces:

- **T-0015** (3 rondas): fecha ISO-8601 que solo validaba cantidad de
  dígitos, no rangos reales; salto de línea literal sin chequear en
  `id`/`parent_id`, después en `creado_en`/`actualizado_en`.
- **T-0016** (1 ronda, sin hallazgos bloqueantes): gaps de cobertura de
  test honestamente documentados (round-trip por igualdad de bytes, no
  solo de objeto; orden interno de Property/View no canonicalizado —
  anotado en T-0019 para decidir a propósito).
- **T-0017** (2 rondas): **hallazgo crítico** — el CAS no detectaba
  conflictos bajo concurrencia real (300/300 sobrescrituras silenciosas
  en la reproducción de la revisión), exactamente lo que ADR-001 prohíbe.
  Corregido sin volver al mutex global que ADR-002 descarta: `link()`
  atómico para creación, lock por archivo individual (no global) para
  actualización.
- **T-0018** (1 ronda, sin hallazgos): verificación exhaustiva de NULL en
  operadores negativos, precedencia AND/OR con `multi_select`, profundidad
  2 a prueba de bypass del compilador, reconstrucción determinista.
- **T-0019** (3 rondas): **tres hallazgos críticos encadenados**, todos
  relacionados con la garantía central de ADR-006 (nunca promover una
  Property requerida sin verificar de verdad todas las Rows) — ver detalle
  en el mensaje del commit `7acf526`.

## Lo que esto confirma sobre el proceso

La regla de "revisar antes de que otro dependa del código" no fue
ceremonia: en T-0017 y T-0019 encontró bugs que, sin corrección, habrían
dejado que el core de nido violara sus propias garantías no negociables
(sync sin pérdida, migración de esquema segura) mientras el resto del
sprint construía encima. El costo (rondas adicionales de revisión) fue
bajo comparado con el de descubrir esto después, con T-0011/T-0012/T-0013
ya construidos sobre una base rota.
