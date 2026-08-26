# Sprint 3 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- El mecanismo de "archivo exclusivo por persona + aplicar cambios
  compartidos después, en un solo paso" evitó por completo el riesgo de
  concurrencia sobre `docs/01-modelo-dominio.md`/`docs/02-incognitas.md`
  que la planning de este sprint anticipó. Cinco agentes en paralelo, cero
  conflictos.
- El coordinador (`docs/coordinador.md`, T-0007) se verificó contra datos
  reales del propio backlog en el momento de escribirse, no contra un
  ejemplo inventado — y coincidió con la priorización que el equipo ya
  había hecho a ojo en sprint 3 (T-0004/T-0008 como foco). Es una señal
  fuerte de que la heurística es correcta, no solo plausible.
- Ampliar el tamaño del sprint cuando el trabajo lo justificaba (la
  decisión de la retro de sprint 2) funcionó: cinco tickets cerrados en
  paralelo, mismo tiempo de reloj que hubiera tomado uno solo.

## Qué no funcionó / qué mejorar

- El agente de T-0004 y el de T-0008 (ambos "Marga") propusieron la misma
  etiqueta de versión (`v1.3`) para el historial de `docs/01-modelo-dominio.md`,
  sin coordinarse entre sí — esperable, dado que corrieron en paralelo sin
  verse. Quien aplica los cambios compartidos (este sprint, Claude
  orquestando) tuvo que resolver la colisión a mano, fusionando ambas en
  una sola entrada. No es un problema — es exactamente para lo que existe
  el paso de "aplicar después, en un solo lugar" — pero vale la pena
  anotarlo: cualquier convención de numeración compartida (versiones de
  historial, números de ADR) necesita reservarse de antemano en el
  planning, no dejarse para que cada agente la invente en paralelo. Los
  números de ADR sí se reservaron por adelantado en
  `docs/sprints/03-planning.md`; el número de versión del historial no.

## Retro de la metodología misma

- **Qué ritual sobra**: ninguno.
- **Qué falta**: nada nuevo.
- **Qué cambiar para el próximo sprint**: cuando el planning reserve
  archivos exclusivos por ticket, reservar también cualquier identificador
  compartido que dependa de orden (versión de historial, número de
  siguiente ticket si se crean nuevos), no solo los nombres de archivo.

## Estado del backlog al cierre

`hecho`: T-0001 a T-0008 (8). `pendiente`: T-0009 a T-0014 (6). Las nueve
incógnitas de Paso 0 (I1 a I9) quedan todas resueltas. T-0009 es el único
candidato disponible para sprint 4 — primer ticket que produce código de
nido, no solo documentos.
