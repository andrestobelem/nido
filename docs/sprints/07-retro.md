# Sprint 7 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- Auditar el alcance real antes de implementar evitó el riesgo más
  probable de este ticket en particular: inventar una capa de
  "reconciliación" que la arquitectura ya no necesita, solo para que el
  ticket "se sienta completo". La honestidad de la auditoría ("no falta
  nada de fondo en export/import") vale más que el volumen de código que
  se podría haber escrito sin necesidad.
- Verificar el caso de git real con git de verdad (`Bun.$`, no una
  simulación de sus efectos) cierra una laguna de testing que llevaba
  seis sprints abierta sin que nadie la notara — el caso estaba nombrado
  desde la revisión adversarial de Paso 0 pero nunca ejercitado end-to-end.

## Qué no funcionó / qué mejorar

- Nada nuevo que anotar.

## Retro de la metodología misma

- **Qué ritual sobra**: ninguno.
- **Qué falta**: considerar agregar, como paso reusable antes de
  implementar cualquier ticket cuyo nombre venga del plan original (no
  de una incógnita ya resuelta), una auditoría corta de "¿esto ya está
  cubierto por decisiones posteriores?" — dos de los últimos tres tickets
  de código (T-0011 y T-0012) se beneficiaron de no asumir que el alcance
  original seguía vigente sin revisarlo.
- **Qué cambiar para el próximo sprint**: ninguno.

## Estado del backlog al cierre

`hecho`: T-0001 a T-0012, T-0015 a T-0019 (17 tickets). `pendiente`:
T-0013 (CLI `nido` — donde se cumple el criterio de éxito de la misión),
T-0014 (MCP). T-0013 es el único candidato para sprint 8.
