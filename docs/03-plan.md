# Plan, ordenado por dependencia

> Cada paso desbloquea al siguiente. No es un cronograma con fechas: es el
> orden en que las cosas se vuelven posibles.
>
> **Revisado tras revisión adversarial** — ver
> `docs/sprints/00-revision-plan.md` para el detalle de qué cambió y por
> qué. La versión anterior de este documento trataba la herramienta de
> tickets como bloqueante del ADR de persistencia; no lo es.

## Bloque A — Documentación (Paso 0, sin código)

1. Entendimiento, modelo de dominio, incógnitas y este plan
   (`docs/00-*.md` a `docs/03-plan.md`).
2. Revisión adversarial del plan y aplicación de los cambios must-fix
   (hecho, ver `docs/sprints/00-revision-plan.md`).

## Bloque B — Herramienta de tickets e incógnitas críticas (en paralelo)

Estos dos frentes no se bloquean entre sí. Corren en paralelo desde que
termina el Bloque A.

3. **Herramienta de tickets** (Paso 1): archivos planos versionados en git
   en `docs/tickets/`, CLI con pocos comandos, salida JSON. Usa su propio
   mecanismo de escritura atómica (reserva de id por creación exclusiva de
   archivo). Su storage es independiente del que se elija para nido en el
   punto 4 — no es dogfooding todavía, eso es trabajo futuro declarado como
   tal en `docs/sprints/00-revision-plan.md`.
4. **ADR de persistencia** (I1, que incluye I3): git-as-db vs SQLite vs
   archivos planos + índice, con el sync bidireccional y la garantía de
   atomicidad entre agentes como criterios de aceptación explícitos.
5. **Mecanismo de sync bidireccional** (I2, extendida con validación de
   entrada no confiable) — depende de 4.

## Bloque C — Construcción

6. **Modelo de dominio formalizado en tipos** — depende de 4 y 5, y de
   resolver I9 (migración de esquema).
7. **Core de nido** (librería, sin CLI todavía): crear/leer/actualizar
   páginas y bases, propiedades tipadas, filas, views con filtro y orden.
8. **Gate de aceptación de round-trip**, antes de tocar la sync de verdad:
   criterios ejecutables con `bun test` de qué significa "sin pérdida"
   (¿campo a campo? ¿qué pasa con datos agregados a mano que no mapean a
   ninguna Property?), con casos obligatorios de escritura concurrente y de
   archivo borrado, y una política de conflicto declarada explícitamente
   (last-write-wins / reject-and-flag / merge de tres vías).
9. **Sincronización bidireccional, implementación concreta** — contra los
   criterios del punto 8.
10. **CLI `nido`** sobre el core: comandos `page create/get`,
    `db create/query`, etc., con salida JSON y salida humana.

## Equipo, metodología y régimen continuo

11. **Equipo de agentes + metodología Scrum (Paso 2 y 3)** — arranca apenas
    existe la herramienta de tickets (punto 3). Su primer sprint tiene como
    objetivo los puntos 4 y 5 (las incógnitas más bloqueantes), y confirma
    o revierte el recorte de `relacion` a v2 propuesto en
    `docs/01-modelo-dominio.md`. También resuelve I8 (heurística del
    coordinador) antes o junto con el punto 12.
12. **Servidor MCP** sobre el mismo core del punto 7 — después de que la
    CLI del punto 10 esté estable.
13. **Rituales continuos y workflows de ejecución (Paso 4)** — modo de
    operación de régimen permanente una vez que 3 a 10 existen.

## Definición de "MVP" (para no confundir con el plan completo)

El criterio de éxito de la misión (ver `docs/00-entendimiento.md`) se
cumple en el punto 10 de este plan, validado con un agente operando por
vez (la concurrencia entre agentes se prueba, pero no es el caso central
del MVP — ver riesgos aceptados en `docs/sprints/00-revision-plan.md`).
Todo lo que sigue (11 en su forma de rituales continuos, 12, 13) es lo que
hace sostenible seguir construyendo, no lo que define si nido ya es usable.
