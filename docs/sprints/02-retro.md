# Sprint 2 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- El ADR-002 se apoyó explícitamente en las decisiones de ADR-001 en vez de
  reabrirlas (reutiliza el patrón JSON canónico de `packages/tickets`,
  respeta el CAS por archivo ya decidido) — dos sprints seguidos generando
  decisiones que se acumulan en vez de contradecirse entre sí.
- Fundamentar con evidencia externa concreta (otra vez, como en sprint 1)
  evitó una elección "híbrido porque suena balanceado": las tres
  evaluaciones convergieron en el mismo punto de forma independiente
  (Row forzada en Markdown no tiene justificación real), lo cual es una
  señal más fuerte de que la decisión es correcta que si la hubiera tomado
  un solo evaluador.

## Qué no funcionó / qué mejorar

- Segundo sprint seguido de un solo ticket. Tenía sentido mientras T-0002
  era la única pieza en el tope de la cadena — ya no es el caso: con T-0002
  hecho, T-0004, T-0005, T-0006, T-0007 y T-0008 quedan **todos**
  desbloqueados y son independientes entre sí (ninguno depende de otro
  pendiente). Seguir con sprints de un ticket a partir de ahora sería
  proceso por costumbre, no por necesidad real — exactamente lo que la
  regla de prioridad de la misión pide evitar.

## Retro de la metodología misma

- **Qué ritual sobra**: ninguno.
- **Qué falta**: nada nuevo — la regla de revisión adversarial
  pre-dependencia adoptada en la retro de sprint 1 no aplicó este sprint
  (T-0002 fue otra vez una decisión de documento, no código), y sigue en
  pie para cuando T-0010/T-0012 produzcan código real.
- **Qué cambiar para el próximo sprint**: dejar de forzar sprints de un
  ticket. Sprint 3 arranca con los cinco tickets independientes
  (T-0004, T-0005, T-0006, T-0007, T-0008) en paralelo, porque ahora sí hay
  volumen real de trabajo desacoplado entre sí — el tamaño de sprint
  converge al tamaño del trabajo disponible, no a un número fijo elegido de
  antemano.

## Estado del backlog al cierre

`hecho`: T-0001, T-0002, T-0003 (3). `pendiente`: T-0004 a T-0014 (11), de
los cuales T-0004, T-0005, T-0006, T-0007 y T-0008 están disponibles para
arrancar en paralelo ahora mismo.
