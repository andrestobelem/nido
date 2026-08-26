# Coordinador — heurística de priorización (I8)

> Este documento responde I8 (`docs/02-incognitas.md`) y describe el
> comportamiento del coordinador de Paso 4 (`docs/03-plan.md`, punto 13):
> un proceso que se despierta periódicamente, mira `docs/tickets/` a través
> de la CLI, y decide qué ticket priorizar a continuación. **No es un ADR**
> (acordado en `docs/sprints/03-planning.md`): no es una decisión de
> arquitectura del dominio de nido, es una regla operativa del propio
> proceso de equipo, del mismo tipo que "cómo se corre un sprint". Se
> documenta acá, en texto libre, y se actualiza en el lugar sin necesidad de
> pasar por el formato de `docs/adr/000-formato-de-adr.md`.

## El problema que resuelve

"Mirar el tablero y decidir" no es reproducible entre corridas si dos
personas (o dos ejecuciones del propio coordinador) pueden mirar el mismo
backlog y elegir tickets distintos como "lo que sigue". Este documento fija
una función pura: mismo backlog exacto → mismo ticket elegido, siempre.

**Entrada**: la salida completa de `bun packages/tickets/src/cli.ts list
--json` (sin filtros — el coordinador necesita ver también los tickets
`hecho` y `en_progreso`, no solo los `pendiente`, porque son los que
determinan si una dependencia está resuelta y dónde está el cuello de
botella real).

**Salida**: como mucho un ticket a priorizar a continuación, o un reporte
explícito de por qué no hay ninguno (nunca un empate sin desambiguar, nunca
"no sé").

**Lo que el coordinador hace con esa salida** ("destraba y prioriza, no
implementa"): usa la CLI de tickets para dejar constancia — un
`move <id> pendiente` si estaba `bloqueado` y ya no corresponde, un
`comment` señalando el foco recomendado o el cuello de botella. Nunca
escribe código ni toca el core de nido; eso es trabajo de quien tome el
ticket.

## Definiciones

Trabajando sobre el tipo `Ticket` de `packages/tickets/src/types.ts`
(`id`, `estado`, `asignadoA`, `dependeDe`, `creadoEn`, ...):

- **Dependencia resuelta**: la dependencia `d` de un ticket `t` está
  resuelta si existe un ticket con `id === d` en el backlog y su `estado`
  es `"hecho"`. Si `d` no aparece en el backlog (referencia colgante —
  dato corrupto o filtro mal aplicado), se trata como **no resuelta**: la
  heurística nunca asume "probablemente está bien" ante un dato que no
  puede verificar.
- **Dependencias resueltas de `t`**: `t.dependeDe.every(d => resuelta(d))`.
  Un ticket sin dependencias (`dependeDe: []`) las tiene resueltas
  trivialmente.
- **Listo (candidato)**: un ticket con `estado` en `{"pendiente",
  "bloqueado"}` cuyas dependencias están todas resueltas. Un ticket
  `bloqueado` cuyas dependencias ya se resolvieron es, por definición,
  listo — es exactamente el caso que hay que "destrabar" (ver más abajo).
  Un ticket `en_progreso` o `en_revision` **no** es candidato aunque sus
  dependencias estén resueltas: ya tiene foco puesto encima, no es "lo que
  sigue". Un ticket `hecho` tampoco: ya está terminado.
- **Sucesores transitivos de `t`**: el conjunto de tickets que dependen de
  `t`, directa o indirectamente — es decir, todo ticket `u` tal que existe
  una cadena `u.dependeDe ∋ … ∋ t`. Se calcula recorriendo el grafo de
  dependencias en el sentido inverso (de `t` hacia quienes lo listan en su
  `dependeDe`), con un conjunto de visitados para no recorrer dos veces el
  mismo ticket — esto además actúa como red de seguridad si alguna vez
  hubiera un ciclo en los datos (no debería: `link` y `create` en
  `packages/tickets/src/store.ts` ya lo previenen), evitando una recursión
  infinita en vez de asumir que el grafo siempre es válido.

## El algoritmo

```ts
// Ticket: igual forma que packages/tickets/src/types.ts

function resuelta(porId: Map<string, Ticket>, depId: string): boolean {
  const dep = porId.get(depId);
  return dep !== undefined && dep.estado === "hecho";
}

function dependenciasResueltas(porId: Map<string, Ticket>, t: Ticket): boolean {
  return t.dependeDe.every((d) => resuelta(porId, d));
}

function sucesoresTransitivos(
  tickets: Ticket[],
  id: string,
  visitados: Set<string> = new Set(),
): Set<string> {
  for (const t of tickets) {
    if (t.dependeDe.includes(id) && !visitados.has(t.id)) {
      visitados.add(t.id);
      sucesoresTransitivos(tickets, t.id, visitados);
    }
  }
  return visitados;
}

function siguienteTicket(tickets: Ticket[]): {
  listo: Ticket | null;
  ranking: { ticket: Ticket; puntaje: number }[];
  cuelloDeBotella: { ticket: Ticket; pendientesQueSostiene: number }[];
} {
  const porId = new Map(tickets.map((t) => [t.id, t]));

  // Paso 1 — destrabar: "bloqueado" con dependencias ya resueltas
  // cuenta como candidato, igual que "pendiente".
  const candidatos = tickets.filter(
    (t) =>
      (t.estado === "pendiente" || t.estado === "bloqueado") &&
      dependenciasResueltas(porId, t),
  );

  // Paso 2 — puntaje: cuántos tickets desbloquea transitivamente.
  const ranking = candidatos
    .map((t) => ({ ticket: t, puntaje: sucesoresTransitivos(tickets, t.id).size }))
    // Paso 3 — orden: puntaje desc, luego creadoEn asc, luego id asc
    // (el id ya es equivalente a creadoEn en este sistema porque
    // packages/tickets/src/id.ts reserva ids en orden de creación, pero
    // se deja como desempate final explícito para no depender de eso).
    .sort(
      (a, b) =>
        b.puntaje - a.puntaje ||
        a.ticket.creadoEn.localeCompare(b.ticket.creadoEn) ||
        a.ticket.id.localeCompare(b.ticket.id),
    );

  // Cuello de botella: tickets en_progreso/en_revision, rankeados por
  // cuántos pendientes/bloqueados sostienen — útil precisamente cuando
  // `ranking` queda vacío.
  const pendientesOBloqueados = new Set(
    tickets.filter((t) => t.estado === "pendiente" || t.estado === "bloqueado").map((t) => t.id),
  );
  const cuelloDeBotella = tickets
    .filter((t) => t.estado === "en_progreso" || t.estado === "en_revision")
    .map((t) => ({
      ticket: t,
      pendientesQueSostiene: [...sucesoresTransitivos(tickets, t.id)].filter((id) =>
        pendientesOBloqueados.has(id),
      ).length,
    }))
    .filter((x) => x.pendientesQueSostiene > 0)
    .sort((a, b) => b.pendientesQueSostiene - a.pendientesQueSostiene);

  return { listo: ranking[0]?.ticket ?? null, ranking, cuelloDeBotella };
}
```

En criollo: **de los tickets que ya se pueden empezar (sin bloqueos sin
terminar), gana el que más tickets desbloquea en cadena; empate se rompe
por quién se creó primero.** Si no hay ninguno que ya se pueda empezar, el
coordinador no elige nada nuevo — reporta cuál de los tickets ya en curso
es el verdadero cuello de botella, para que el foco (humano o del propio
equipo) vaya ahí en vez de a un ticket nuevo.

## Ejemplo 1 — Sprint 3 planning (backlog real, snapshot de
`docs/sprints/03-planning.md`)

Justo después de que T-0002 pasó a `hecho`, el backlog tenía T-0004,
T-0005, T-0006, T-0007, T-0008 en `pendiente`, todos con dependencias
resueltas (T-0004 depende de T-0003, ya `hecho`; los otros cuatro no tienen
dependencias). Los cinco son candidatos.

Puntaje (sucesores transitivos, usando el grafo real: T-0009 depende de
T-0001+T-0002+T-0004+T-0008; T-0010→T-0009; T-0011→T-0010; T-0012→T-0011;
T-0013→T-0012; T-0014→T-0013):

| Ticket | Sucesores transitivos | Puntaje |
|---|---|---|
| T-0004 | T-0009, T-0010, T-0011, T-0012, T-0013, T-0014 | 6 |
| T-0008 | T-0009, T-0010, T-0011, T-0012, T-0013, T-0014 | 6 |
| T-0005 | (ninguno) | 0 |
| T-0006 | (ninguno) | 0 |
| T-0007 | (ninguno) | 0 |

Empate entre T-0004 y T-0008 en 6. Desempate por `creadoEn`: T-0004
(`2026-08-26T05:51:20.411Z`) es anterior a T-0008
(`2026-08-26T05:51:44.680Z`). **Ganador: T-0004.**

Esto coincide con lo que el equipo hizo en la realidad sin usar todavía
esta heurística formal: T-0004 y T-0008 son justamente los dos tickets que
Nico señaló como los que "más desbloquean" en los comentarios de T-0001 y
T-0002, y son los dos que quedaron asignados a la misma persona (Marga) por
ser los de mayor impacto en la cadena. La heurística no inventa una
prioridad nueva — formaliza la que el equipo ya venía siguiendo a ojo.

Importante: que T-0004 "gane" no significa que T-0005/T-0006/T-0007/T-0008
tengan que esperar. Son independientes entre sí (ninguno depende de otro
de la lista) y de hecho el sprint los corrió en paralelo
(`docs/sprints/03-planning.md`). La heurística ordena "si tuviera que
elegir un solo foco, cuál", no serializa el trabajo del equipo a un ticket
por vez — eso ya lo decide la disponibilidad real de agentes, no esta
regla.

## Ejemplo 2 — Backlog actual (hoy, 2026-08-26, antes de cerrar T-0007)

Estado real vía `bun packages/tickets/src/cli.ts list --json`:

- `hecho`: T-0001, T-0002, T-0003.
- `en_progreso`: T-0004, T-0005, T-0006, T-0007, T-0008.
- `pendiente`: T-0009 (depende de T-0001, T-0002, T-0004, T-0008),
  T-0010→T-0009, T-0011→T-0010, T-0012→T-0011, T-0013→T-0012,
  T-0014→T-0013.

Paso 1 (candidatos): ningún `pendiente` tiene sus dependencias todas
resueltas — T-0009 sigue esperando a T-0004 y T-0008 (ambos `en_progreso`,
no `hecho`), y T-0010 a T-0014 dependen transitivamente de T-0009. No hay
ningún ticket `bloqueado`. **`candidatos` queda vacío.**

El coordinador no elige un ticket nuevo. En vez de quedarse callado, calcula
el cuello de botella: de los `en_progreso`, cuántos `pendiente` sostiene
cada uno.

| Ticket en curso | Asignado a | Pendientes que sostiene |
|---|---|---|
| T-0004 | Marga | 6 (T-0009…T-0014) |
| T-0008 | Marga | 6 (T-0009…T-0014) |
| T-0005 | Efra | 0 |
| T-0006 | Tomás | 0 |
| T-0007 | Nico | 0 |

Reporte del coordinador: *"sin candidatos nuevos para priorizar; el cuello
de botella de todo el Bloque C (T-0009 a T-0014, seis tickets) son T-0004 y
T-0008, ambos en curso y ambos de Marga — el foco correcto ahora es cerrar
esos dos, no abrir un tercero."* Esto es "destraba y prioriza, no
implementa" en la práctica: el coordinador señala dónde presionar, no
agarra T-0009 él mismo ni le saca el ticket a Marga.

## Ejemplo 3 (hipotético) — el caso de "destrabar" en sí

Ningún ticket del backlog real está hoy en estado `bloqueado`, así que el
caso que le da el nombre a "destraba" no tiene un ejemplo real todavía.
Para que quede definido de forma inequívoca: si T-0010 estuviera en
`bloqueado` (por ejemplo, alguien lo marcó a mano porque hacía falta una
confirmación externa) y T-0009 pasara a `hecho`, en la próxima corrida el
coordinador lo detecta como candidato (sus dependencias — solo T-0009 —
ya están resueltas), ejecuta `move T-0010 pendiente` para dejar constancia
explícita de que ya no corresponde tenerlo bloqueado, y a partir de ahí
compite por puntaje como cualquier otro candidato. Si en cambio sus
dependencias siguieran sin resolverse, permanece `bloqueado` y se reporta
igual — en una lista de "sigue bloqueado, esperando: [...]" — para
visibilidad, aunque no sea el elegido.

## Casos borde

- **Backlog vacío o todo `hecho`**: `candidatos` vacío y `cuelloDeBotella`
  vacío (no hay ningún `en_progreso`/`en_revision`). El coordinador reporta
  "nada para priorizar, backlog al día" — una señal sana, no un error.
- **Dependencia colgante** (un `dependeDe` que apunta a un id que no existe
  en el listado): tratada como no resuelta (ver "Definiciones"). El ticket
  que la tiene nunca es candidato hasta que se corrija el dato; se reporta
  como anomalía, nunca se "adivina" que probablemente está bien.
- **Ciclo en el grafo de dependencias**: no debería ocurrir — `create` solo
  admite depender de tickets que ya existen (no se puede crear un ciclo
  hacia un ticket futuro) y `link` corta explícitamente si detecta uno
  (`creaCiclo` en `packages/tickets/src/store.ts`). Aun así,
  `sucesoresTransitivos` usa un conjunto de visitados, así que ante un dato
  corrupto que igual formara un ciclo, termina (no cuelga) en vez de asumir
  que nunca puede pasar.
- **Empate exacto de puntaje y de `creadoEn`**: no debería ocurrir — todas
  las escrituras del store pasan por el mutex de `packages/tickets/src/lock.ts`,
  que serializa la creación y por lo tanto los timestamps. El desempate
  final por `id` ascendente está igual, para que la función quede
  totalmente determinística sin depender de esa garantía externa.

## Qué esta heurística no decide (alcance explícito)

- **A quién asignarlo.** `asignadoA` no entra en el cálculo de qué ticket
  es "lo que sigue" — eso es una decisión separada y más simple: si el
  ticket elegido ya tiene `asignadoA`, la acción es avisarle a esa persona
  que quedó destrabado; si no tiene, es el próximo candidato para asignar a
  quien esté libre. Mezclar "qué prioridad tiene" con "quién lo hace"
  complicaría la regla sin necesidad — son dos decisiones independientes.
- **Un campo explícito de "foco del sprint" marcado por el PM.** Se
  consideró como alternativa (mencionada en la pregunta original de I8) y
  se descartó para esta versión porque el modelo de `Ticket` de
  `packages/tickets/src/types.ts` no tiene ese campo hoy — agregarlo sería
  un cambio de esquema fuera del alcance de este ticket. Si en algún
  momento hace falta que un humano pueda forzar un foco distinto al que da
  esta regla, la vía es agregar un campo (por ejemplo `prioridadManual`) y
  hacer que el coordinador lo respete *antes* de correr el puntaje — no
  reemplazar la regla, aumentarla.
- **La cadencia de reloj del coordinador** ("cada tantos minutos"). Este
  documento fija la función de decisión, no el mecanismo de disparo
  periódico — eso es un detalle de implementación de Paso 4
  (`docs/03-plan.md`, punto 13), independiente de la heurística en sí: la
  misma función sirve sin cambios sea que el disparo sea un cron, un loop
  con sleep, o una invocación manual.

## Alternativas consideradas (y por qué se descartaron para v1)

- **"El más antiguo sin bloqueos" (FIFO puro, sin puntaje de desbloqueo)**:
  es reproducible y más simple de explicar, pero ignora la forma real del
  grafo. En el Ejemplo 1, un FIFO puro habría elegido el más viejo entre
  los cinco candidatos por `creadoEn` sin mirar cuánto desbloquea cada uno
  — en este caso puntual coincide con T-0004 igual (es el más viejo de los
  dos con puntaje máximo), pero en un backlog donde el ticket más viejo
  disponible no es el que más bloquea a otros, FIFO puro priorizaría lo
  urgente-por-antigüedad sobre lo urgente-por-impacto, que es exactamente
  el tipo de decisión que un coordinador "que prioriza" debería poder
  distinguir.
- **Puntaje por dependientes directos únicamente (sin transitividad)**: más
  barato de calcular, pero subestima sistemáticamente el principio de una
  cadena larga. T-0001 tiene un solo dependiente directo (T-0002) pero
  desbloquea transitivamente a siete tickets — contar solo directos le
  daría el mismo puntaje que a un ticket sin ningún efecto cascada.
- **Elegir el candidato con más tickets bloqueados que dependen de él en
  este preciso momento, contando también los ya `hecho`**: no aporta nada
  distinto de la regla elegida en la práctica (ver "Definiciones": un
  ticket no puede tener un sucesor transitivo `hecho` mientras él mismo no
  lo esté, porque ese sucesor habría necesitado sus propias dependencias
  resueltas primero), y complica la explicación sin cambiar ningún
  resultado.
