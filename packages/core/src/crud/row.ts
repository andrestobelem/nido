/**
 * CRUD de alto nivel para Row (T-0019). A diferencia de `./page.ts`/
 * `./database.ts`, valida contra el esquema de la Database padre
 * (`validarRow` de `../invariantes.ts` — la misma función que ya usan
 * `../almacenamiento/lectura.ts` y `../indice/construccion.ts`, no una
 * reimplementación) ANTES de escribir: un error fatal
 * (`PROPERTY_REQUERIDA_SIN_VALOR`, `PROPERTY_VALUE_DUPLICADO`,
 * `TIPO_INVALIDO`) aborta sin escribir nada (`RowInvalida`, ver
 * `./errores.ts`). Una advertencia (`PROPERTY_VALUE_HUERFANO`, ADR-006) no
 * bloquea la escritura — se devuelve junto al resultado, mismo contrato que
 * `NodoLeido.advertencias` en `../almacenamiento/lectura.ts`.
 */

import type { HashDeContenido } from "../almacenamiento/hash.ts";
import { escribirRow } from "../almacenamiento/escritura.ts";
import { leerRow as leerRowAlmacenamiento, type ResultadoLectura } from "../almacenamiento/lectura.ts";
import { tieneErroresFatales, validarRow, type ErrorValidacion } from "../invariantes.ts";
import type { Database, PropertyValue, Row } from "../types.ts";
import { RowInvalida } from "./errores.ts";
import { crearConIdReintentando, pathDeRow } from "./ids.ts";
import type { NodoRowEscrito } from "./tipos.ts";

export interface CrearRowInput {
  titulo: string;
  valores: PropertyValue[];
}

/** Valida `row` contra el esquema de `database`; lanza `RowInvalida` si hay algún error fatal, o devuelve las advertencias (posiblemente vacías) si no. */
function validarOLanzar(database: Database, row: Row): ErrorValidacion[] {
  const errores = validarRow(database, row);
  if (tieneErroresFatales(errores)) {
    throw new RowInvalida(row.id, errores.filter((error) => error.severidad === "error"));
  }
  return errores;
}

/** Genera un id, fija `creadoEn === actualizadoEn` a la hora actual, valida contra `database.propiedades` y escribe vía CAS de creación. La validación corre antes de cualquier I/O de escritura: una Row inválida nunca llega a tocar el disco. */
export async function crearRow(raizWorkspace: string, database: Database, input: CrearRowInput): Promise<NodoRowEscrito> {
  return crearConIdReintentando(async (id) => {
    const ahora = new Date().toISOString();
    const row: Row = {
      id,
      tipo: "fila",
      parentId: database.id,
      titulo: input.titulo,
      creadoEn: ahora,
      actualizadoEn: ahora,
      valores: input.valores,
    };
    const advertencias = validarOLanzar(database, row);
    const resultado = await escribirRow(raizWorkspace, pathDeRow(id), row, null);
    return { valor: row, hash: resultado.hash, advertencias };
  });
}

export function leerRow(raizWorkspace: string, database: Database, id: string): Promise<ResultadoLectura<Row>> {
  return leerRowAlmacenamiento(raizWorkspace, pathDeRow(id), database);
}

export type CambiosRow = Partial<Pick<Row, "titulo" | "valores">>;

/**
 * Actualiza una Row existente con CAS (ADR-001 punto 2), validando el
 * resultado contra `database.propiedades` antes de escribir — igual que
 * `crearRow`, un error fatal aborta (`RowInvalida`) sin tocar el disco, y no
 * confunde eso con un conflicto de CAS (que es `ConflictoDeEscritura`,
 * propagado tal cual desde `../almacenamiento/escritura.ts`).
 */
export async function actualizarRow(
  raizWorkspace: string,
  database: Database,
  rowActual: Row,
  hashEsperado: HashDeContenido,
  cambios: CambiosRow,
): Promise<NodoRowEscrito> {
  const actualizada: Row = { ...rowActual, ...cambios, actualizadoEn: new Date().toISOString() };
  const advertencias = validarOLanzar(database, actualizada);
  const resultado = await escribirRow(raizWorkspace, pathDeRow(rowActual.id), actualizada, hashEsperado);
  return { valor: actualizada, hash: resultado.hash, advertencias };
}
