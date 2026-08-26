# Sprint 8 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

T-0013 es el ticket donde se cumple el criterio de éxito explícito de la
misión (`docs/00-entendimiento.md`): un agente puede, solo con la CLI
`nido`, crear páginas, crear bases con propiedades tipadas, agregar
filas, y consultar vistas filtradas/ordenadas, con salida JSON y humana.
Con T-0012 cerrado, `@nido/core` ya tiene todo lo necesario (T-0015 a
T-0019): esto es exponerlo como CLI, no diseñar nada nuevo del dominio.

## Objetivo del sprint

**T-0013 — CLI `nido`**, asignado a Tomás (pragmático, ya construyó la
CLI de `packages/tickets`, mismo patrón de parseo de argv schema-driven
que ya demostró evitar el bug de `--json` tragado como valor). Revisión
de Efra antes de cerrar.

Comandos mínimos que cubren el criterio de éxito:
- `nido page create/get`
- `nido db create/get`
- `nido row create/get`
- `nido view query` (filtros/orden ad-hoc en JSON, o contra una View
  persistida — ADR-004 ya decidió que ambas coexisten)

ADR-005 ya fija el límite: el core (`packages/core`) no sabe nada de
argv ni de la decisión humano-vs-JSON — eso vive enteramente en
`packages/cli`, paquete nuevo.

## Riesgo conocido

Es la superficie más grande de decisiones de UX de CLI del proyecto
(cómo se especifica un esquema de propiedades o un filtro desde la
terminal). Se resuelve con JSON inline por flag para las estructuras
complejas (esquema de Property, árbol de filtros), consistente con cómo
ya se pasa `--depende-de` en `packages/tickets`, en vez de intentar
modelar cada campo como un flag propio.
