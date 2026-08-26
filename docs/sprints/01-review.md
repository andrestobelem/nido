# Sprint 1 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

Dos tickets (ver `docs/sprints/01-planning.md`): T-0001 (ADR de
persistencia, I1+I3) y T-0003 (confirmar o revertir el recorte de
`relacion`).

## Qué se entregó

- **T-0003 — hecho.** Lucía confirmó el recorte: `relacion` queda diferida
  a v2. Documentado en `docs/01-modelo-dominio.md` v1.2.
- **T-0001 — hecho.** Marga entregó `docs/adr/001-persistencia.md`:
  archivos planos versionados en git como única fuente de verdad, con un
  índice derivado en `bun:sqlite` (reconstruible, nunca fuente de verdad)
  para resolver Views. Garantía de atomicidad declarada: comparar
  hash/mtime antes de escribir (CAS por archivo) + escritura vía
  write-then-rename, sin locking distribuido. La decisión se fundamentó con
  evidencia externa concreta (Logseq migrando a SQLite por límites de
  performance file-based, techo práctico de Decap CMS, por qué Dolt no usa
  blobs de git sin más, riesgos documentados del plugin Obsidian Git con
  merge automático) — no fue una preferencia sin sustento.

Las dos entregas se cerraron con el comando `tickets move ... hecho`, no a
mano: son la primera prueba real de que el backlog cargado en Paso 1
efectivamente funciona como mecanismo de coordinación.

## Qué desbloquea

T-0001 desbloquea directamente T-0002 (mecanismo de sync) y, por cadena,
T-0009 a T-0014 (six tickets). T-0003 desbloquea T-0004. El ADR también
deja una nota explícita relevante para sprint 2: el mecanismo de
concurrencia de nido (CAS por archivo) es **distinto** al de
`packages/tickets` (mutex global) — no hay que confundirlos ni reusar uno
para el otro.

## Trabajo no comprometido que también se hizo

En paralelo al sprint, una revisión adversarial de `packages/tickets`
encontró bugs reales de concurrencia (lost updates en escrituras
simultáneas sobre el mismo ticket, y un bypass de la detección de ciclos
bajo dos `link` concurrentes en direcciones opuestas). Se corrigieron antes
del cierre del sprint: mutex global por store, escritura atómica
(write-then-rename), y un parser de argv más estricto en la CLI (rechaza
flags desconocidos en vez de ignorarlos, y ya no confunde el valor literal
`"--json"` de un flag con el flag global de salida). La suite pasó de 25 a
32 tests.

No estaba en el plan de sprint 1, pero calificaba como bloqueante real: es
la herramienta que todo el resto del equipo usa para coordinarse, y el
propio `CLAUDE.md` la declara infraestructura crítica.
