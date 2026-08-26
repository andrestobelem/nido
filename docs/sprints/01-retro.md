# Sprint 1 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- Un sprint chico (dos tickets, ambos decisiones de diseño) permitió foco
  real: ninguno quedó a medio hacer, los dos cerraron con artefacto escrito
  y ticket movido a `hecho` por la propia herramienta.
- Cargar el backlog completo desde `docs/03-plan.md` al arrancar Paso 1 dio
  visibilidad inmediata de qué desbloquea qué — sprint 1 se eligió
  precisamente por ser lo más bloqueante (T-0001 desbloquea 6 tickets
  encadenados).
- El ADR de persistencia se fundamentó con evidencia externa real
  (Logseq, Decap CMS, Dolt, Obsidian Git), no con preferencia. Para la
  decisión más cara de revertir del plan, eso importa más que la velocidad.
- Dogfooding inmediato de `packages/tickets` (usarlo para cargar y cerrar
  su propio primer backlog) sirvió como prueba de humo real, además de
  documentación.

## Qué no funcionó / qué mejorar

- La revisión adversarial de `packages/tickets` corrió en paralelo al resto
  del trabajo de sprint, no antes. Encontró bugs serios de concurrencia
  (lost updates, bypass de detección de ciclos) que, de haber otro trabajo
  concurrente real usando la herramienta durante esa ventana, habrían
  causado corrupción silenciosa sin que nadie lo notara. La corrección
  llegó a tiempo porque el volumen de uso real todavía era bajo, pero fue
  suerte de timing, no de proceso.
- **Cambio de proceso para sprint 2**: cualquier pieza de infraestructura
  que el equipo vaya a usar en paralelo (no un documento, sino código)
  pasa por revisión adversarial **antes** de que otros tickets dependan de
  ella para escribir, no en paralelo. Cuando el resultado de un ticket es
  una decisión de documento (como T-0001, T-0003), no aplica esta regla —
  ahí alcanza con la revisión que ya exige `docs/adr/000-formato-de-adr.md`.

## Retro de la metodología misma

- **Qué ritual sobró**: ninguno todavía. El sprint fue tan chico que un
  grooming separado del backlog no hizo falta — el backlog ya venía
  ordenado por dependencia desde el plan.
- **Qué falta**: grooming se vuelve necesario recién cuando aparezcan
  tickets no previstos en el plan original, o cuando el backlog crezca lo
  suficiente como para que el orden de `docs/03-plan.md` deje de ser
  suficiente guía. No hace falta anticiparlo con un ritual fijo; se agrega
  cuando la señal aparezca (tickets sin dependencias claras acumulándose).
- **Qué cambiar para el próximo sprint**: adoptar la regla de revisión
  adversarial pre-dependencia descrita arriba. Mantener el tamaño de sprint
  chico un ciclo más — sprint 2 tiene un solo ticket realmente bloqueante
  en el tope de la cadena (T-0002, mecanismo de sync), así que no hace
  falta forzar más volumen para justificar el ritual.

## Estado del backlog al cierre

`hecho`: T-0003, T-0001 (2). `pendiente`: T-0002, T-0004 a T-0014 (12).
T-0002 es ahora el ticket más bloqueante disponible (desbloquea la cadena
completa de construcción) — candidato natural para sprint 2.
