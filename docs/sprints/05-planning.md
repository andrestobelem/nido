# Sprint 5 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

T-0010 ("Core de nido") resultó demasiado grande para comprometerlo como
un solo ticket con confianza real de "done con tests pasando" — mezcla
serialización de archivo, escritura atómica con CAS, un índice derivado en
SQLite, y CRUD de alto nivel, cada una una pieza de diseño no trivial por
derecho propio. Se dividió en grooming (backlog crece cuando aparece
trabajo no previsto — regla adoptada en la retro de sprint 2):

- **T-0015**: serializador de Page (Markdown + encabezado propio).
- **T-0016**: serializador canónico de Database/Row (JSON).
- **T-0017**: motor de escritura con CAS por archivo + checklist de
  validación de un archivo individual.
- **T-0018**: índice derivado en `bun:sqlite`, resolución de Views.
- **T-0019**: CRUD de alto nivel que integra las cuatro capas anteriores,
  más migración de esquema (ADR-006).

T-0010 ahora depende de T-0019 y se cierra cuando este lo hace — queda
como el ticket "paraguas" que representa la librería completa.

## Objetivo del sprint

Atacar las capas por orden de dependencia real, no todas a la vez:

1. **T-0015 y T-0016 en paralelo** (Tomás en ambas — son serializadores
   independientes, escriben a archivos distintos de `packages/core/src/`,
   sin overlap real).
2. **T-0017** (Marga), una vez que existen los serializadores — necesita
   saber qué bytes escribir.
3. **T-0018** (Marga), una vez que existe el motor de escritura/lectura.
4. **T-0019** (Tomás), integrando todo — el único que cierra T-0010.

Cada capa pasa por el ciclo implementar → revisar (Efra) → corregir antes
de considerarse hecha, igual que T-0009 — es infraestructura que las capas
siguientes van a depender de inmediato.

## Compromiso

Cerrar T-0015 a T-0019 en este sprint, y con ellos T-0010. Si alguna capa
resulta a su vez demasiado grande para una sola pasada, se vuelve a dividir
— la lección de este mismo sprint es que subestimar el tamaño de un ticket
de código es más caro de corregir después que de dividir antes.

## Riesgo conocido

Es la mayor cantidad de código nuevo de un solo sprint hasta ahora. El
gate de aceptación de round-trip (T-0011, todavía no arrancado) es
justamente el control que falta después de este sprint, antes de construir
la sync real (T-0012) encima.
