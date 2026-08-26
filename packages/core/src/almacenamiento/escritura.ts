/**
 * Escritura atómica con CAS de UN archivo (T-0017), ADR-001 puntos 2 y 3 +
 * ADR-002 sección 4.
 *
 * - **Atomicidad física**: siempre se escribe primero a un archivo temporal
 *   en el mismo directorio que el path final (mismo filesystem — el
 *   `rename`/`link` es atómico a nivel POSIX), nunca se escribe directo al
 *   path final. Mismo patrón (temporal-y-commit, nombre `.tmp-<uuid>`) que
 *   `packages/tickets/src/store.ts:67-69` — ADR-001 consecuencias es
 *   explícito en que ese primitivo en sí se reusa, aunque la estrategia de
 *   concurrencia alrededor (CAS por archivo, no el mutex global de
 *   `packages/tickets/src/lock.ts`) es distinta.
 * - **CAS real bajo concurrencia**, no solo en el caso secuencial: un
 *   simple "releer y comparar el hash, después `rename()` incondicional" no
 *   es atómico frente a otro escritor concurrente del mismo path — dos
 *   llamadas que arrancan del mismo `hashEsperado` podrían pasar ambas el
 *   chequeo (ninguna renombró todavía) y ambas confirmar, pisándose en
 *   silencio. Por eso el commit final se separa en dos caminos, cada uno con
 *   una garantía atómica real distinta según lo que ADR-001 exige para ese
 *   caso:
 *   - `hashEsperado === null` (ADR-001 punto 1, "creación"): commit vía
 *     `link()` del temporal al path final. `link()` falla atómicamente a
 *     nivel de kernel con `EEXIST` si el destino ya existe — no hay ventana
 *     entre comprobar "¿existe?" y crear, porque es la misma operación.
 *     Cubre tanto "el archivo ya existía de antes" como "otra escritura
 *     concurrente lo acaba de crear": cualquiera de los dos casos hace
 *     fallar el `link()` con el mismo `EEXIST`.
 *   - `hashEsperado !== null` (ADR-001 punto 2, "actualización"): no existe
 *     un primitivo POSIX de "renombrar solo si el contenido del destino no
 *     cambió", así que la comprobación (releer+rehashear) y la acción
 *     (`rename`) corren dentro de un lock exclusivo acotado a este path
 *     (`conLockDeArchivo`, más abajo) — nunca el mutex global de directorio
 *     que ADR-002 descarta, sino una exclusión mutua de "CAS por archivo":
 *     solo serializa a dos escritores del mismo archivo, nunca a dos
 *     escritores de archivos sin relación.
 *
 * No conoce `Page`/`Database`/`Row` en su primitivo genérico
 * (`escribirConCas`, que opera sobre `string`) — los wrappers típados al
 * final del archivo (`escribirPage`/`escribirDatabase`/`escribirRow`) son
 * los que conectan esto con los serializadores de `../formato/*.ts`, más el
 * mismo chequeo de consistencia id-vs-filename que `lectura.ts` aplica al
 * leer (defensivo: así este motor nunca escribe, de entrada, un archivo que
 * la próxima lectura rechazaría por ese motivo).
 */

import { link, open, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { serializarDatabase, serializarRow } from "../formato/database-row.ts";
import { serializarPage } from "../formato/page.ts";
import type { Database, Page, Row } from "../types.ts";
import { idDesdeNombreArchivo, resolverPathConfinado } from "./confinamiento.ts";
import { hashDeArchivo, hashesIguales, type HashDeContenido } from "./hash.ts";

export class ConflictoDeEscritura extends Error {
  constructor(pathAbsoluto: string) {
    super(
      `conflicto de escritura en "${pathAbsoluto}": el contenido en disco cambió desde que se leyó (o el archivo fue creado/eliminado por otra operación concurrente) — se abortó sin sobrescribir nada (ADR-001 punto 2)`,
    );
  }
}

export class InconsistenciaIdArchivo extends Error {
  constructor(idObjeto: string, idArchivo: string) {
    super(
      `no se escribe: el id del objeto ("${idObjeto}") no coincide con el id derivado del nombre de archivo ("${idArchivo}")`,
    );
  }
}

/**
 * El lock exclusivo por archivo (ver `conLockDeArchivo`) no pudo adquirirse
 * tras el reintento acotado — contención sostenida sobre el mismo path, no
 * un conflicto de contenido. Distinto de `ConflictoDeEscritura`: acá ni
 * siquiera se llegó a comparar el hash.
 */
export class EsperaDeLockAgotada extends Error {
  constructor(pathLock: string) {
    super(`no se pudo adquirir el lock de escritura "${pathLock}" tras reintentar — contención sostenida sobre el mismo archivo`);
  }
}

export interface ResultadoEscritura {
  path: string;
  /** Hash de los bytes recién escritos (capturado inmediatamente después del commit) — pasarlo como `hashEsperado` de la próxima actualización evita otra lectura solo para conseguirlo. */
  hash: HashDeContenido;
}

function pathTemporalJuntoA(pathAbsoluto: string): string {
  return join(dirname(pathAbsoluto), `.${basename(pathAbsoluto)}.tmp-${crypto.randomUUID()}`);
}

// ---------------------------------------------------------------------------
// Lock exclusivo *por archivo* para la ventana check-then-rename del caso de
// actualización. Deliberadamente NO es el mutex global de
// `packages/tickets/src/lock.ts` (ADR-002 lo descarta explícitamente): el
// path del lock se deriva del path del archivo que se está escribiendo, así
// que solo serializa a dos escritores del mismo archivo — dos agentes
// editando archivos sin relación nunca comparten este lock ni se bloquean
// entre sí. El primitivo de bajo nivel (creación exclusiva `open(path,"wx")`
// con reintento) es el mismo idioma que ya usa `packages/tickets/src/id.ts`
// y `packages/tickets/src/lock.ts` — reusar el idioma no es reusar el
// mecanismo (uno es un mutex por directorio, esto es exclusión por recurso).
// ---------------------------------------------------------------------------

const ESPERA_LOCK_MS = 5;
const INTENTOS_LOCK_MAXIMOS = 2000; // ~10s de espera máxima ante contención real
const LOCK_VIEJO_MS = 10_000; // un lock más viejo que esto se considera abandonado (proceso que murió sin liberarlo)

function pathLockPara(pathAbsoluto: string): string {
  return `${pathAbsoluto}.lock`;
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function liberarLockSiEsViejo(pathLock: string): Promise<void> {
  try {
    const info = await stat(pathLock);
    if (Date.now() - info.mtimeMs > LOCK_VIEJO_MS) {
      await rm(pathLock, { force: true });
    }
  } catch {
    // el lock pudo haberse liberado entre el intento fallido y este stat
  }
}

async function adquirirLockDeArchivo(pathLock: string) {
  for (let intento = 0; intento < INTENTOS_LOCK_MAXIMOS; intento++) {
    try {
      return await open(pathLock, "wx");
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      await liberarLockSiEsViejo(pathLock);
      await esperar(ESPERA_LOCK_MS);
    }
  }
  throw new EsperaDeLockAgotada(pathLock);
}

/**
 * Exclusión mutua acotada a `pathAbsoluto` (no global): mientras `fn` corre,
 * ningún otro llamador que pida el lock de este mismo path puede entrar,
 * pero un lock sobre un path distinto no espera nada acá.
 */
async function conLockDeArchivo<T>(pathAbsoluto: string, fn: () => Promise<T>): Promise<T> {
  const pathLock = pathLockPara(pathAbsoluto);
  const handle = await adquirirLockDeArchivo(pathLock);
  try {
    return await fn();
  } finally {
    await handle.close();
    await rm(pathLock, { force: true });
  }
}

/**
 * Caso "creación" (`hashEsperado === null`, ADR-001 punto 1): commit vía
 * `link()` del temporal al path final en vez de `rename()` incondicional.
 * `link()` falla con `EEXIST` si el destino ya existe — atómico a nivel de
 * kernel, sin ventana entre comprobar y actuar. A diferencia de `rename()`,
 * `link()` no consume el nombre de origen: el temporal sigue existiendo
 * junto al final (mismo inodo) hasta que se limpia explícitamente acá.
 */
async function commitDeCreacion(pathTemporal: string, pathAbsoluto: string): Promise<void> {
  try {
    await link(pathTemporal, pathAbsoluto);
  } catch (error) {
    if ((error as { code?: string }).code === "EEXIST") {
      throw new ConflictoDeEscritura(pathAbsoluto);
    }
    throw error;
  } finally {
    await rm(pathTemporal, { force: true });
  }
}

/**
 * Caso "actualización" (`hashEsperado !== null`, ADR-001 punto 2): bajo el
 * lock por archivo, relee el hash actual en disco y lo compara contra
 * `hashEsperado` justo antes del `rename` — comprobación y acción atómicas
 * entre sí frente a cualquier otro escritor que también pase por este mismo
 * lock. Si hay descalce, no renombra: el temporal queda para que lo limpie
 * el llamador (mismo contrato que antes de esta función).
 */
async function commitDeActualizacion(
  pathTemporal: string,
  pathAbsoluto: string,
  hashEsperado: HashDeContenido,
): Promise<void> {
  await conLockDeArchivo(pathAbsoluto, async () => {
    const hashActual = await hashDeArchivo(pathAbsoluto);
    if (!hashesIguales(hashActual, hashEsperado)) {
      throw new ConflictoDeEscritura(pathAbsoluto);
    }
    await rename(pathTemporal, pathAbsoluto);
  });
}

/**
 * Primitivo genérico: escritura atómica con CAS de contenido ya
 * serializado (string) en `pathAbsoluto`. No valida path traversal ni
 * consistencia de id — eso es responsabilidad de los wrappers típados de
 * abajo (o de quien llame directo a este primitivo, si alguna vez hace
 * falta escribir algo que no es un `Page`/`Database`/`Row`).
 */
export async function escribirConCas(
  pathAbsoluto: string,
  contenido: string,
  hashEsperado: HashDeContenido,
): Promise<ResultadoEscritura> {
  const pathTemporal = pathTemporalJuntoA(pathAbsoluto);
  await Bun.write(pathTemporal, contenido);

  try {
    if (hashEsperado === null) {
      await commitDeCreacion(pathTemporal, pathAbsoluto);
    } else {
      await commitDeActualizacion(pathTemporal, pathAbsoluto, hashEsperado);
    }
  } catch (error) {
    await rm(pathTemporal, { force: true });
    throw error;
  }

  return { path: pathAbsoluto, hash: await hashDeArchivo(pathAbsoluto) };
}

async function escribirNodo(
  raizWorkspace: string,
  pathRelativo: string,
  idObjeto: string,
  contenidoSerializado: string,
  hashEsperado: HashDeContenido,
): Promise<ResultadoEscritura> {
  const pathAbsoluto = await resolverPathConfinado(raizWorkspace, pathRelativo);
  const idArchivo = idDesdeNombreArchivo(basename(pathAbsoluto));
  if (idObjeto !== idArchivo) {
    throw new InconsistenciaIdArchivo(idObjeto, idArchivo);
  }
  return escribirConCas(pathAbsoluto, contenidoSerializado, hashEsperado);
}

/** Serializa `page` (ver `../formato/page.ts`) y la escribe atómicamente con CAS. */
export function escribirPage(
  raizWorkspace: string,
  pathRelativo: string,
  page: Page,
  hashEsperado: HashDeContenido,
): Promise<ResultadoEscritura> {
  return escribirNodo(raizWorkspace, pathRelativo, page.id, serializarPage(page), hashEsperado);
}

/** Serializa `database` (ver `../formato/database-row.ts`) y la escribe atómicamente con CAS. */
export function escribirDatabase(
  raizWorkspace: string,
  pathRelativo: string,
  database: Database,
  hashEsperado: HashDeContenido,
): Promise<ResultadoEscritura> {
  return escribirNodo(raizWorkspace, pathRelativo, database.id, serializarDatabase(database), hashEsperado);
}

/** Serializa `row` (ver `../formato/database-row.ts`) y la escribe atómicamente con CAS. */
export function escribirRow(
  raizWorkspace: string,
  pathRelativo: string,
  row: Row,
  hashEsperado: HashDeContenido,
): Promise<ResultadoEscritura> {
  return escribirNodo(raizWorkspace, pathRelativo, row.id, serializarRow(row), hashEsperado);
}
