/**
 * Lectura y validación de UN archivo (T-0017), el subconjunto del checklist
 * de ADR-002 sección 5 que puede resolverse sin conocer el resto del árbol:
 *
 * - Punto 1 (confinamiento de path): delegado a `./confinamiento.ts`.
 * - Punto 2 (parseo total, no tolerante) y punto 3 (forma/esquema exacto):
 *   delegados a `../formato/page.ts` y `../formato/database-row.ts`
 *   (T-0015/T-0016) — este módulo no reimplementa ningún parser, solo los
 *   invoca.
 * - Punto 4 (consistencia id-vs-filename, cierra *id falsificado*): el `id`
 *   del objeto ya parseado tiene que ser igual al id derivado del nombre de
 *   archivo — implementado acá, porque ninguno de los dos módulos de
 *   `../formato/` conoce el nombre de archivo (son puros: string <-> objeto,
 *   sin I/O).
 * - Punto 8 (`PropertyValue` contra el esquema de su Database), solo para
 *   `leerRow`: delegado a `validarRow` de `../invariantes.ts` (T-0009), que
 *   recibe el esquema de la Database ya resuelto por quien llama — este
 *   módulo no lo resuelve leyendo del disco recursivamente (eso mezclaría
 *   este archivo con el índice de T-0018).
 *
 * Los puntos 5, 6, 7 y 9 del mismo checklist (unicidad global de id,
 * resolución de `parent_id`, ciclos, "falla cerrada" a nivel de todo un
 * índice) necesitan conocimiento de todo el árbol de archivos — quedan para
 * T-0018/T-0012, fuera de alcance de este módulo.
 *
 * Cada `leerX` también captura el hash de los bytes crudos leídos (ADR-002
 * sección 4, vía `./hash.ts`) y lo devuelve junto con el objeto parseado:
 * es el valor que hay que pasarle después a `escribirConCas`/`escribirX`
 * (`./escritura.ts`) como `hashEsperado` para cerrar el ciclo de CAS de
 * ADR-001 punto 2 ("al leer, se captura un hash... antes de confirmar la
 * escritura, se compara contra el capturado").
 */

import { basename } from "node:path";
import { parsearDatabase, parsearRow } from "../formato/database-row.ts";
import { parsearPage } from "../formato/page.ts";
import { tieneErroresFatales, validarRow, type ErrorValidacion } from "../invariantes.ts";
import type { Database, Page, Row } from "../types.ts";
import { idDesdeNombreArchivo, resolverPathConfinado } from "./confinamiento.ts";
import { leerBytesCrudosConHash, type HashDeContenido } from "./hash.ts";

export class NodoNoEncontrado extends Error {
  constructor(pathAbsoluto: string) {
    super(`no existe el archivo "${pathAbsoluto}"`);
  }
}

export interface NodoLeido<T> {
  valor: T;
  /** Hash de los bytes crudos capturado en esta misma lectura — ver `./hash.ts` y `./escritura.ts`. */
  hash: HashDeContenido;
  /**
   * Hallazgos con `severidad: "advertencia"` (ADR-002/006: por ejemplo, un
   * `PropertyValue` huérfano en una Row). No invalidan el nodo por sí solos
   * —por eso `valor` está presente igual— pero tampoco se descartan en
   * silencio (ADR-002 sección 5, punto 9): quien llama decide qué hacer con
   * ellos. Vacío si no hubo ninguno. Siempre vacío para `leerPage`/
   * `leerDatabase`, que no tienen ninguna validación que pueda producir una
   * advertencia.
   */
  advertencias: ErrorValidacion[];
}

/** `NodoLeido<T>` si la lectura y validación tuvieron éxito, o la lista (no vacía) de `ErrorValidacion` fatales que la rechazaron. */
export type ResultadoLectura<T> = NodoLeido<T> | ErrorValidacion[];

/** Azúcar para distinguir el resultado sin repetir `Array.isArray` en cada llamador — mismo patrón que `esErrorDeParseo` de `../formato/page.ts`. */
export function esErrorDeLectura<T>(resultado: ResultadoLectura<T>): resultado is ErrorValidacion[] {
  return Array.isArray(resultado);
}

function errorIdNoCoincide(idContenido: string, idArchivo: string): ErrorValidacion {
  return {
    codigo: "ID_NO_COINCIDE_CON_ARCHIVO",
    mensaje: `el id declarado en el contenido ("${idContenido}") no coincide con el id derivado del nombre de archivo ("${idArchivo}")`,
    severidad: "error",
    nodoId: idArchivo,
  };
}

/**
 * Resuelve el path confinado, lee sus bytes crudos y decodifica el texto —
 * el paso común a `leerPage`/`leerDatabase`/`leerRow` antes de que cada uno
 * llame a su parser específico. Lanza `NodoNoEncontrado` si el archivo no
 * existe: a diferencia de una escritura (donde "no existe todavía" es el
 * caso normal de crear), una lectura sobre un path que no existe no tiene
 * nada que devolver.
 */
async function leerContenidoConHash(
  raizWorkspace: string,
  pathRelativo: string,
): Promise<{ pathAbsoluto: string; idArchivo: string; contenido: string; hash: HashDeContenido }> {
  const pathAbsoluto = await resolverPathConfinado(raizWorkspace, pathRelativo);
  const idArchivo = idDesdeNombreArchivo(basename(pathAbsoluto));

  const leido = await leerBytesCrudosConHash(pathAbsoluto);
  if (leido === null) throw new NodoNoEncontrado(pathAbsoluto);

  return { pathAbsoluto, idArchivo, contenido: new TextDecoder().decode(leido.bytes), hash: leido.hash };
}

export async function leerPage(raizWorkspace: string, pathRelativo: string): Promise<ResultadoLectura<Page>> {
  const { idArchivo, contenido, hash } = await leerContenidoConHash(raizWorkspace, pathRelativo);

  const resultado = parsearPage(contenido);
  if (Array.isArray(resultado)) return resultado;
  if (resultado.id !== idArchivo) return [errorIdNoCoincide(resultado.id, idArchivo)];

  return { valor: resultado, hash, advertencias: [] };
}

export async function leerDatabase(raizWorkspace: string, pathRelativo: string): Promise<ResultadoLectura<Database>> {
  const { idArchivo, contenido, hash } = await leerContenidoConHash(raizWorkspace, pathRelativo);

  const resultado = parsearDatabase(contenido);
  if (Array.isArray(resultado)) return resultado;
  if (resultado.id !== idArchivo) return [errorIdNoCoincide(resultado.id, idArchivo)];

  return { valor: resultado, hash, advertencias: [] };
}

/**
 * `database` es el esquema ya resuelto de la Database padre de esta Row
 * (punto 8 del checklist) — este módulo no lo busca por su cuenta, quien
 * llama es responsable de tenerlo a mano (ver comentario de cabecera).
 */
export async function leerRow(
  raizWorkspace: string,
  pathRelativo: string,
  database: Database,
): Promise<ResultadoLectura<Row>> {
  const { idArchivo, contenido, hash } = await leerContenidoConHash(raizWorkspace, pathRelativo);

  const resultado = parsearRow(contenido);
  if (Array.isArray(resultado)) return resultado;
  if (resultado.id !== idArchivo) return [errorIdNoCoincide(resultado.id, idArchivo)];

  const erroresDeEsquema = validarRow(database, resultado);
  if (tieneErroresFatales(erroresDeEsquema)) return erroresDeEsquema;

  return { valor: resultado, hash, advertencias: erroresDeEsquema };
}
