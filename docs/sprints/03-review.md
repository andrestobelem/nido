# Sprint 3 — Review

**Fecha**: 2026-08-26

## Qué se comprometió

Cinco tickets independientes en paralelo (ver `docs/sprints/03-planning.md`):
T-0004, T-0005, T-0006, T-0007, T-0008.

## Qué se entregó

Los cinco, **todos hecho**:

- **T-0004 (Marga)** — `docs/adr/003-tipos-de-property.md`: confirma sin
  cambios el subconjunto de siete tipos de Property, con razón explícita
  de descarte para cada uno de los ocho tipos de Notion no incluidos.
- **T-0005 (Efra)** — `docs/adr/004-expresividad-de-views.md`: operadores
  agrupados por familia de tipo, combinación AND/OR con agrupación acotada
  a profundidad 2 (justificado por el costo real de traducción a SQL, no
  por AND vs OR en sí), View con nombre que coexiste con query ad-hoc.
- **T-0006 (Tomás)** — `docs/adr/005-core-compartido-cli-mcp.md`: el core
  es una librería TypeScript en proceso (`packages/core`); el MCP nunca
  envuelve subprocesos de la CLI. Límites explícitos de qué expone y qué
  no.
- **T-0007 (Nico)** — `docs/coordinador.md`: heurística determinística
  (candidatos con dependencias resueltas, gana el que más desbloquea
  transitivamente, empate por antigüedad), verificada contra el backlog
  real del propio sprint 3 y con casos borde documentados.
- **T-0008 (Marga)** — `docs/adr/006-migracion-de-esquema.md`: agregar
  Property requerida se rechaza salvo Database vacía, con una operación
  explícita de "promoción" que solo tiene éxito si todas las Rows ya
  tienen valor; quitar nunca borra en silencio.

**Las nueve incógnitas de `docs/02-incognitas.md` (I1 a I9) quedan todas
resueltas.** Cierra el ciclo que arrancó en Paso 0.

## Cómo se evitó que se pisaran entre sí

Cada persona escribió en un archivo exclusivo (los ADR 003 a 006 más
`docs/coordinador.md`), sin editar directamente `docs/01-modelo-dominio.md`
ni `docs/02-incognitas.md`. Las actualizaciones a esos dos documentos
compartidos se aplicaron después, en un solo paso, no en paralelo — el
mecanismo funcionó sin ningún conflicto ni pérdida de contenido.

## Qué desbloquea

T-0009 (formalizar el modelo en tipos) queda desbloqueado — depende de
T-0001, T-0002, T-0004 y T-0008, los cuatro ya `hecho`. Es el candidato
natural de sprint 4, y el primero que va a producir código de nido en
serio (no solo decisiones de documento).
