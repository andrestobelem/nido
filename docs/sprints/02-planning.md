# Sprint 2 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

Sprint 1 cerró con el ADR de persistencia (`docs/adr/001-persistencia.md`):
archivos planos + índice derivado en `bun:sqlite`, con atomicidad vía CAS
por archivo. Eso deja varias piezas todavía sin definir, que son
precisamente el alcance de T-0002 (I2): formato exacto de archivo,
serialización canónica y determinista, y la validación de entrada no
confiable en cada lectura.

Siguiendo la retro de sprint 1 (`docs/sprints/01-retro.md`): T-0002 es una
decisión de documento (ADR), no código todavía — la regla de "revisión
adversarial antes de que otros dependan de código" no aplica aquí. Sí va a
aplicar cuando lleguemos a T-0010 (core) y T-0012 (implementación de sync).

## Objetivo del sprint

Un solo ticket, otra vez a propósito: **T-0002 — Mecanismo de sync
bidireccional**, asignado a Marga. Desbloquea T-0009 (modelo en tipos) y,
por cadena, T-0010 a T-0014.

## Compromiso

Marga entrega un ADR (`docs/adr/002-*.md`) que fije:

1. Formato de archivo por tipo de nodo (Page, Database, Row) — Markdown con
   frontmatter, JSON, o una combinación justificada.
2. Regla de serialización canónica: mismo objeto → mismos bytes, para que
   un ciclo repo→base→repo sin cambios reales no genere diffs de git
   espurios.
3. Checklist concreto de validación de entrada no confiable en cada
   lectura (la lista de `docs/02-incognitas.md` I2 extendida: `parent_id`
   colgante, id falsificado o duplicado, path traversal, árbol tocado por
   git fuera del motor de sync).
4. Cómo se aplica en la práctica el CAS por archivo de `docs/adr/001-persistencia.md`
   (qué se hashea exactamente, dónde se guarda el hash usado para comparar).

## Riesgo conocido

I9 (migración de esquema) sigue abierta y T-0002 no tiene por qué
resolverla — puede dejarla como caso explícitamente fuera de alcance del
ADR de sync, a resolver en T-0009.
