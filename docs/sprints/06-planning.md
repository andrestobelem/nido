# Sprint 6 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

Sprint 5 cerró T-0010 completo (T-0015 a T-0019): `packages/core` ya lee
y escribe archivos reales con CAS, resuelve Views contra un índice
derivado. T-0011 es el único ticket disponible — un gate, no una nueva
pieza de dominio: consolida criterios de aceptación explícitos de
round-trip sin pérdida antes de que T-0012 (sync real) construya encima.

**Cambio de proceso de la retro de sprint 5**, aplicado desde este
sprint: el ciclo implementar → revisar → corregir agrega una ronda de
confirmación si el último intento permitido corrige un hallazgo — esa
ronda no cuenta para más correcciones, solo confirma. Si aun así queda
algo sin resolver, el ticket no se cierra a `hecho` automáticamente: se
deja en `en_revision` con el hallazgo pendiente anotado, para que un
humano o el equipo decida el siguiente paso.

## Objetivo del sprint

**T-0011 — Gate de aceptación de round-trip**, asignado a Efra (testing
y casos borde) para implementar, con revisión de Marga (persistencia) —
invirtiendo los roles habituales a propósito: quien más escéptica es del
trabajo ajeno, esta vez construye, y quien diseñó la persistencia,
revisa.

Alcance: tests de aceptación end-to-end en `packages/core/test/` que
crean Page/Database/Row con contenido adversarial (unicode, valores
límite de cada tipo), los escriben a disco, y verifican una relectura
completa desde cero (simulando un proceso nuevo, no el mismo objeto en
memoria) sin pérdida. Casos de escritura concurrente ya cubiertos por
capa (T-0017/T-0019) se referencian, no se duplican; este ticket agrega
el caso de **archivo borrado externamente** (qué reporta el índice/CRUD
cuando un archivo que debería existir ya no está) que ninguna capa
anterior cubrió explícitamente. Más un documento corto
(`docs/gate-round-trip.md`) que declare los criterios de aceptación y
enlace a los ADRs que ya los fijan, sin repetirlos.

## Riesgo conocido

Ninguno nuevo — es consolidación de garantías ya decididas, no una
decisión de diseño nueva.
