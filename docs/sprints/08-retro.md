# Sprint 8 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- Agregar `page update` sin que estuviera en el alcance mínimo original,
  porque sin él la garantía central de ADR-001 (CAS entre agentes) no se
  podía probar de verdad desde la CLI, fue la decisión correcta — un
  ticket "completo" que no puede demostrar su propia garantía de
  concurrencia no está realmente completo.
- La revisión encontró un hueco real que ninguna capa anterior había
  detectado (validación de forma de `Property[]`/`PropertyValue[]` en
  runtime) precisamente porque fue la primera vez que datos con forma
  arbitraria (JSON de un flag de CLI) llegaron al core en vez de objetos
  ya construidos por tests que siempre los armaban bien. Confirma el
  valor de probar de punta a punta con la superficie real, no solo con
  llamadas directas a funciones del core.
- Verificar el criterio de éxito de la misión con la CLI real, en vivo,
  en vez de confiar solo en que los tests pasan, le dio a este hito el
  peso que merece.

## Qué no funcionó / qué mejorar

- Nada nuevo que anotar.

## Retro de la metodología misma

- **Qué ritual sobra**: ninguno.
- **Qué falta**: nada nuevo.
- **Qué cambiar para el próximo sprint**: ninguno.

## Estado del backlog al cierre

`hecho`: T-0001 a T-0013, T-0015 a T-0019 (18 de 19 tickets). `pendiente`:
T-0014 (servidor MCP) — el único ticket restante del plan actual
(`docs/03-plan.md`). Con T-0013 cerrado, el criterio de éxito de la
misión ya está cumplido; T-0014 es lo que falta para que el plan
completo, no la mission misma, esté hecho.
