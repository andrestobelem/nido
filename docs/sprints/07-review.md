# Sprint 7 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

T-0012, con una auditoría de alcance previa a implementar (planning de
sprint 7): confirmar contra el código real qué de la sync bidireccional
faltaba, antes de comprometer trabajo.

## Qué se entregó

**T-0012 — hecho**, con alcance deliberadamente reducido tras la
auditoría de Marga. El título original ("implementar sincronización
bidireccional") sobre-prometía: la arquitectura de ADR-001 (archivos como
única fuente de verdad, índice siempre reconstruido, nunca cacheado) ya
resuelve la sync por construcción — no hay un estado previo contra el
cual "reconciliar", así que no existe una tercera pieza de detección de
cambios incremental pendiente para v1.

Lo que la auditoría identificó como faltante, y se implementó:

- `packages/core/src/sync/reporte.ts` (`sincronizarWorkspace`): agrupa y
  cuenta los diagnósticos que `construirIndice` (T-0018) ya produce, para
  que la CLI y el futuro MCP no ensamblen eso a mano cada uno por su lado
  — consistente con `docs/00-entendimiento.md` ("ninguna superficie
  reimplementa la lógica de la otra").
- `packages/core/test/sync-git-real.test.ts`: el escenario "árbol tocado
  por git fuera del motor de sync" (I2 extendida, caso 4) probado con
  **git real** vía `Bun.$` — dos branches editando el mismo campo,
  merge con marcadores de conflicto reales en disco — no solo con
  contenido malformado escrito a mano como hasta ahora.

Explícitamente descartado como fuera de alcance, con razón documentada:
una operación separada de "exportar/importar todo" (sería una segunda
fuente de verdad ficticia sobre una arquitectura que deliberadamente no
tiene una).

## Por qué este resultado es una señal sana, no una falla de sprint

La regla de prioridad de la misión es "gana lo que acerque a nido a estar
usable" — construir una capa de sync "de más" para justificar el nombre
del ticket habría sido trabajo sin valor real. Que ADR-001 haya predicho
correctamente esto (lo dice explícitamente: "el sync bidireccional deja
de ser un problema de ingeniería... se cumple por construcción") y que la
auditoría lo haya confirmado en vez de inventar trabajo, es la decisión
de arquitectura de sprint 1 pagando dividendos seis sprints después.
