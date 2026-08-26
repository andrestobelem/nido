# Sprint 6 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

T-0011 (gate de aceptación de round-trip), con roles invertidos a
propósito: Efra implementó, Marga revisó.

## Qué se entregó

**T-0011 — hecho**, aprobado en la primera ronda de revisión. 12 tests
nuevos en `packages/core/test/gate-round-trip.test.ts` (273 tests totales
en el repo) más `docs/gate-round-trip.md`.

Lo más relevante no es el volumen, es cómo se verificó: la revisión hizo
**mutation testing real** — rompió a propósito la deduplicación de
`multi_select` en el serializador (`formato/database-row.ts`) y confirmó
que el gate lo detecta (2 de 12 tests fallaron con un error concreto),
antes de revertir el cambio. Es la primera vez en el proyecto que se
verifica explícitamente que un conjunto de tests de aceptación no es
tautológico — que efectivamente falla cuando el sistema está roto, no
solo que pasa cuando está bien.

También se agregó el caso que ninguna capa anterior cubría: qué pasa
cuando un archivo se borra externamente del árbol (fuera del motor de
nido). Cada punto de contacto falla de forma clara y tipada, nunca en
silencio.

## Sobre el cambio de proceso de sprint 5

La mejora acordada (ronda de confirmación tras agotar intentos, sin
cierre automático si queda algo sin resolver) no llegó a activarse este
sprint — se aprobó en el primer intento, así que el camino feliz del
workflow no ejercitó la rama nueva. Sigue pendiente de una prueba real
en un ticket que sí necesite varias rondas.
