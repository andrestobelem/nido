# Sprint 2 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

Un ticket (ver `docs/sprints/02-planning.md`): T-0002, mecanismo de sync
bidireccional (I2).

## Qué se entregó

**T-0002 — hecho.** Marga entregó `docs/adr/002-formato-de-archivos-y-sync.md`:
formato híbrido por tipo de nodo — Page en Markdown con un encabezado
propio de seis campos fijos (deliberadamente **no** un motor YAML/frontmatter
de librería, para no importar ni riesgo de ejecución de código al leer ni
el no-determinismo de round-trip documentado en `js-yaml`), Database y Row
en JSON canónico con orden de claves fijo. Fija también qué se hashea para
el CAS de `docs/adr/001-persistencia.md` (los bytes crudos del archivo, no
una re-serialización canónica — para no volverse ciego a ediciones externas
que no cambian el valor semántico) y un checklist de 9 pasos de validación
de entrada no confiable, respondiendo uno por uno los cuatro casos que la
revisión adversarial de Paso 0 había marcado en I2 extendida.

La decisión, igual que T-0001, se fundamentó con evidencia externa concreta
en vez de preferencia: vectores de ejecución de código documentados en
`gray-matter` (la librería de frontmatter más usada en JS/Bun), el problema
de no-determinismo de `js-yaml` (issue #208), el "Norway problem" de YAML
1.1, y un caso real de Obsidian donde el propio motor de frontmatter
reescribía fechas sin cambio semántico — justo la clase de diff espurio que
el criterio 1 (round-trip determinista) prohíbe.

## Qué desbloquea

T-0002 desbloquea, junto con T-0004 y T-0008 (todavía pendientes), a T-0009
(formalizar el modelo en tipos) y por cadena a T-0010 a T-0014.

## Nota para T-0009 (todavía no arrancado)

El ADR-002 deja explícito que la resolución de I9 (migración de esquema)
tiene que respetar la serialización canónica y el checklist de validación
que ya fijó, no reabrirlos — información directamente relevante cuando
T-0008 y T-0009 arranquen.
