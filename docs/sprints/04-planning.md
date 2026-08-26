# Sprint 4 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

Las nueve incógnitas de Paso 0 están resueltas (`docs/sprints/03-review.md`).
T-0009 es el único ticket disponible — y el primero que produce código de
nido en serio, no una decisión de documento. A partir de acá aplica la
regla adoptada en la retro de sprint 1: la revisión adversarial de
infraestructura corre **antes** de que otro ticket dependa de ella, no en
paralelo ni después.

## Objetivo del sprint

**T-0009 — Formalizar el modelo de dominio en tipos**, asignado a Marga
(diseño de tipos) y Tomás (implementación pragmática), con revisión de
Efra antes de cerrar.

Alcance explícito, para no reabrir T-0010 antes de tiempo: T-0009 define
los **tipos TypeScript y las validaciones de invariante puras** (sin
leer/escribir archivos todavía — eso es T-0010 y T-0012). Traduce a código:

- Las entidades de `docs/01-modelo-dominio.md` (Workspace, Page, Database,
  Property, Row, PropertyValue, View) con la forma exacta que fijaron los
  ADR 001 a 006 (tipos de Property de ADR-003, filtros de View de ADR-004,
  reglas de migración de esquema de ADR-006).
- Validadores puros de las invariantes 1 a 7 del modelo, y de la forma
  esperada de cada `PropertyValue` según el tipo de su Property.
- Se crea el paquete `packages/core` (`@nido/core`), sin `bin`, sin leer
  `argv`/`env` — tal como fijó `docs/adr/005-core-compartido-cli-mcp.md`.

## Compromiso

- Marga y Tomás entregan `packages/core` con tipos + validadores + tests.
- Antes de mover T-0009 a `hecho`, corre una revisión adversarial de Efra
  (nueva regla de proceso, no en paralelo con la implementación).
- Cualquier hallazgo real que la revisión confirme se corrige antes de
  cerrar el ticket.

## Riesgo conocido

Si la revisión encuentra problemas de fondo en el diseño de tipos, corregir
después de que T-0010 ya construyó sobre ellos sería mucho más caro. Por
eso la revisión va antes de cerrar, no después.
