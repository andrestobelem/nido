# Sprint 1 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.
**Duración**: sin fecha de cierre fija. Es el primer sprint; el tamaño se
ajusta según converja, como pide la misión. Este arranca chico a propósito:
dos tickets, ambos decisiones de diseño, ninguno de implementación.

## Contexto

Paso 0 y Paso 1 están cerrados: documentación base con revisión adversarial
aplicada (`docs/sprints/00-revision-plan.md`) y la herramienta de tickets
funcionando, con la que se cargó el backlog completo de 14 tickets
derivados de `docs/03-plan.md` (`docs/tickets/T-0001.json` a `T-0014`).

El Bloque B del plan dice que la herramienta de tickets y las incógnitas
críticas corren en paralelo, sin bloquearse entre sí. Ya terminó la
herramienta de tickets. Sprint 1 ataca las incógnitas más bloqueantes.

## Objetivo del sprint

Cerrar las dos decisiones que desbloquean la mayor parte del resto del
backlog:

1. **T-0001 — ADR de persistencia (I1 + I3)**, asignado a Marga. Bloquea
   directamente T-0002, T-0009, y por cadena, T-0010 a T-0014: seis de los
   catorce tickets del backlog.
2. **T-0003 — Confirmar o revertir el recorte de `relacion` a v2**,
   asignado a Lucía. Bloquea T-0004, y es la decisión de alcance que más
   cambia la forma del modelo si se revierte.

No se agrega nada más al sprint. T-0002 depende de T-0001 y no puede
arrancar en paralelo de verdad (el mecanismo de sync depende de qué
persistencia se elige), así que forzarlo dentro del sprint sería trabajo a
medio hacer. El resto del backlog (T-0004 a T-0014) espera.

## Compromiso

- Marga entrega el ADR de persistencia en `docs/adr/001-persistencia.md`,
  siguiendo el formato de `docs/adr/000-formato-de-adr.md`, con la garantía
  de atomicidad entre agentes como criterio de aceptación explícito (no
  implícito — ver `docs/sprints/00-revision-plan.md`, riesgo aceptado #1).
- Lucía entrega la decisión sobre `relacion` como una actualización a
  `docs/01-modelo-dominio.md` (confirmando el recorte o revirtiéndolo), con
  la razón por escrito.
- Efra revisa ambas decisiones antes de que se marquen `hecho` — no como
  ritual separado, sino como parte de "done" (ver Calidad en `CLAUDE.md`:
  ningún ticket es done sin verificación).
- Nico corre el sprint review cuando ambos tickets estén `hecho`, no antes.

## Riesgo conocido

Si T-0001 tarda, seis tickets se quedan esperando. Es un riesgo aceptado a
propósito: apurar el ADR de persistencia sin resolver bien I3
(concurrencia) es peor que tardar, porque toda la cadena de construcción
hereda esa decisión.
