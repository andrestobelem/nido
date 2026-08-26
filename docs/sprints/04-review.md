# Sprint 4 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

Un ticket (`docs/sprints/04-planning.md`): T-0009, con revisión
adversarial obligatoria antes de cerrar.

## Qué se entregó

**T-0009 — hecho.** Primer código real de nido: el paquete
`packages/core` (`@nido/core`), solo tipos y validación pura, sin I/O
(alcance respetado: nada de `bun:sqlite`, filesystem, ni CLI, eso queda
para T-0010/T-0012).

- `src/types.ts`: Workspace, Page, Database, Property (unión discriminada
  por tipo), Row, PropertyValue, View — con la profundidad 2 del árbol de
  filtros de View impuesta **a nivel de tipos**, no solo documentada.
- `src/invariantes.ts`: validadores puros de las invariantes 1, 2, 3, 5 y
  7 del modelo, con la aclaración de ADR-006 (`PropertyValue` huérfano no
  rechaza la Row entera) correctamente implementada como advertencia, no
  como error.
- 65 tests totales en el repo (33 nuevos de este paquete), `bun test` y
  `bunx tsc --noEmit` sin errores.

## El ciclo implementar → revisar → corregir, en la práctica

Funcionó exactamente como se planeó. La primera revisión de Efra encontró
cuatro hallazgos reales, verificados con ejecución directa del código (no
especulación):

1. `validarRow` no detectaba `PropertyValue` duplicados para la misma
   Property (falso negativo real de la invariante 2).
2. `Database.cuerpo` estaba tipado como obligatorio, contradiciendo el
   propio ejemplo de ADR-002 de un campo que debe poder estar ausente.
3. `orden` de una View no admitía ordenar por campos base
   (`creado_en`/`actualizado_en`), que ADR-004 exige explícitamente.
4. Los mensajes de diagnóstico usaban `JSON.stringify` sobre `NaN`/`Infinity`/`-0`,
   que colapsan a `"null"`/`"0"` — el mensaje de error mentía sobre el
   valor que en realidad se había rechazado.

Los cuatro se corrigieron con sus tests. La segunda revisión, hecha de
forma independiente (Efra corrió `bun test`/`tsc` ella misma, no confió en
el reporte de la corrección), confirmó el cierre. Quedaron anotadas dos
ambigüedades de especificación (no bugs): si una fecha con forma válida
pero calendario inválido (`2026-02-30`) debería rechazarse, y qué pasa
cuando un `PropertyValue` es huérfano y duplicado a la vez. Ninguna
bloquea el cierre; el equipo las confirma a propósito más adelante, no
ahora por default.

## Qué desbloquea

T-0010 (Core de nido, la librería con operaciones CRUD reales) — primer
ticket que va a usar estos tipos para leer y escribir de verdad.
