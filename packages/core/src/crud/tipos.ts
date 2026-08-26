/**
 * Formas de resultado compartidas por el CRUD de alto nivel (T-0019).
 */

import type { HashDeContenido } from "../almacenamiento/hash.ts";
import type { ErrorValidacion } from "../invariantes.ts";
import type { Row } from "../types.ts";

/**
 * Resultado de una creación o actualización de alto nivel: el objeto final
 * tal cual quedó en memoria, y el hash de los bytes recién escritos — listo
 * para pasar como `hashEsperado` de la próxima actualización (mismo
 * contrato que `ResultadoEscritura` de `../almacenamiento/escritura.ts`,
 * pero con el objeto completo en vez de solo su `path`).
 */
export interface NodoEscrito<T> {
  valor: T;
  hash: HashDeContenido;
}

/**
 * Igual que `NodoEscrito<Row>`, más las advertencias no fatales que haya
 * dejado `validarRow` (ADR-006: `PropertyValue` huérfanos) — mismo campo y
 * mismo significado que `NodoLeido.advertencias` en
 * `../almacenamiento/lectura.ts`.
 */
export interface NodoRowEscrito extends NodoEscrito<Row> {
  advertencias: ErrorValidacion[];
}
