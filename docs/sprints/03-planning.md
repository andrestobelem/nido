# Sprint 3 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

Sprint 1 y 2 cerraron, uno un ticket a la vez, porque cada uno era la
única pieza en el tope de la cadena de dependencias. Ya no es el caso: con
T-0002 hecho, cinco tickets quedan disponibles y son independientes entre
sí (`docs/sprints/02-retro.md`). Sprint 3 los ataca en paralelo — el
tamaño converge al volumen real de trabajo desacoplado, no a un número fijo.

## Objetivo del sprint

- **T-0004** (subconjunto de tipos de Property, I4) — Marga.
- **T-0005** (expresividad de las Views, I5) — Efra.
- **T-0006** (forma del core compartido CLI/MCP, I6) — Tomás.
- **T-0007** (heurística de priorización del coordinador, I8) — Nico.
- **T-0008** (migración de esquema en Database con filas, I9) — Marga.

## Cómo se evita que se pisen entre sí

Cuatro de los cinco tocan, en principio, los mismos documentos compartidos
(`docs/01-modelo-dominio.md`, `docs/02-incognitas.md`). Para que los cinco
agentes no editen esos archivos al mismo tiempo (el mismo tipo de problema
de concurrencia que se corrigió en `packages/tickets` esta semana, pero
sobre archivos Markdown sin lock), cada persona entrega su decisión en un
archivo **propio y exclusivo** (un ADR con número reservado, o un doc
nuevo), y propone como texto el cambio a aplicar en los documentos
compartidos. La aplicación a `docs/01-modelo-dominio.md` y
`docs/02-incognitas.md` se hace en un solo paso, después, no en paralelo.

Números de ADR reservados para este sprint: 003 (T-0004), 004 (T-0005),
005 (T-0006), 006 (T-0008). T-0007 no es una decisión de arquitectura de
nido — se documenta en `docs/coordinador.md`, no como ADR.

## Riesgo conocido

Ninguno de estos cinco tickets produce código todavía (son decisiones de
diseño), así que la regla de revisión adversarial pre-dependencia de la
retro de sprint 1 no aplica este sprint tampoco. Va a aplicar recién en
T-0010/T-0012.
