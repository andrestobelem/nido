# Sprint 8 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

T-0013, la CLI `nido` sobre `@nido/core` — el ticket donde se cumple el
criterio de éxito explícito de la misión.

## Qué se entregó

**T-0013 — hecho.** `packages/cli` (bin `nido`): `page create/get/update`,
`db create/get`, `row create/get`, `view query`. 321 tests en el
monorepo, `bun test`/`tsc` sin errores.

**Verificado en vivo, no solo con tests** (por Claude, orquestando, con
la CLI real contra un workspace temporal):

```
$ nido page create --titulo "Bienvenida" --cuerpo "..."
$ nido db create --titulo "Tareas" --propiedades '[...texto, select, numero...]'
$ nido row create --db <id> --valores '[...]'   (x3, prioridades distintas)
$ nido view query --db <id> --filtros '{"prioridad" != "baja"}' --orden '[puntos desc]'
→ 2 filas, excluyó correctamente la de prioridad "baja", orden por puntos desc correcto
```

Los cuatro puntos del criterio de éxito de `docs/00-entendimiento.md` se
cumplen: crear páginas, crear bases con propiedades tipadas, agregar
filas, consultar vistas filtradas/ordenadas — con salida JSON y humana.

## Decisión de diseño destacable

`page update` no estaba en el mínimo original del ticket, pero se agregó
porque sin él no existe ningún comando que reescriba un archivo
existente — todos los de creación reservan un id nuevo. Sin un comando
de actualización, no había forma de probar un `ConflictoDeEscritura` real
entre dos procesos CLI concurrentes, que es exactamente la garantía que
`ADR-001`/`T-0017` existen para dar. Se agregó, se probó con dos procesos
`bun` reales lanzados en paralelo (no `Promise.all` en el mismo proceso),
y el conflicto se reportó correctamente.

## Hallazgo real de la revisión

El core aceptaba `Property[]`/`PropertyValue[]` mal formados en runtime:
la garantía de tipos de TypeScript no es una garantía real cuando el dato
entra desde afuera (un flag de CLI con JSON sintácticamente válido pero
de forma incorrecta). Se corrigió agregando validación de forma explícita
en `invariantes.ts`, con tests — es la primera vez que un ticket de CLI
expone un hueco real en una capa anterior del core, justo el tipo de cosa
que solo aparece cuando alguien más además de tests unitarios controla
la entrada.
