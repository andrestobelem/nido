/**
 * Validaciones puras de las invariantes de docs/01-modelo-dominio.md (T-0009).
 * Todas reciben objetos ya construidos en memoria y nunca tocan el
 * filesystem ni bun:sqlite — eso es de T-0010/T-0012. Ninguna función acá
 * lanza excepción: cada una devuelve una lista de `ErrorValidacion`
 * estructurados, y quien la use decide qué hacer con ellos (rechazar,
 * reportar, ignorar advertencias, etc.) — "fail closed, nunca silencioso"
 * de ADR-002, pero la decisión de qué es fatal queda del lado del llamador.
 */

import type { Database, Property, PropertyValue, Row, ValorPropertyValue } from "./types.ts";

// ---------------------------------------------------------------------------
// Errores estructurados
// ---------------------------------------------------------------------------

export type CodigoErrorValidacion =
  | "PROPERTY_REQUERIDA_SIN_VALOR"
  | "PROPERTY_VALUE_DUPLICADO"
  | "PROPERTY_VALUE_HUERFANO"
  | "TIPO_INVALIDO"
  | "CICLO_EN_CONTENCION"
  | "ID_DUPLICADO"
  | "PARENT_ID_INVALIDO"
  /**
   * Agregado junto con `packages/core/src/formato/page.ts`: el encabezado
   * de un archivo de Page (ADR-002 sección 2) no matchea su grammar fijo —
   * delimitador `---` faltante, clave ausente/repetida/desconocida, o un
   * valor que no cumple el patrón esperado para su clave. Es una categoría
   * de error distinta de las siete anteriores: esas describen una violación
   * de invariante de dominio sobre un objeto *ya parseado*; esta describe
   * que el parseo mismo del *formato de archivo* falló, antes de que exista
   * un objeto sobre el que evaluar ninguna invariante. Ninguno de los
   * códigos existentes representa eso, así que reusar uno habría sido
   * impreciso en vez de simplificar.
   */
  | "ENCABEZADO_INVALIDO"
  /**
   * Agregado junto con `packages/core/src/formato/database-row.ts` (T-0016):
   * el mismo caso que `ENCABEZADO_INVALIDO`, pero para el formato JSON de
   * Database/Row en vez del encabezado propio de Page — `JSON.parse` falló,
   * o el objeto resultante no tiene exactamente las claves y tipos que
   * ADR-002 sección 3 fija para ese tipo de nodo. No se reusa
   * `ENCABEZADO_INVALIDO` porque ese nombre está atado específicamente al
   * "encabezado" de Page (ADR-002 sección 2, un formato de texto propio,
   * no JSON); no se reusa `TIPO_INVALIDO` por la misma razón que motivó
   * agregar `ENCABEZADO_INVALIDO` en primer lugar: esa describe un
   * `PropertyValue` cuyo tipo no coincide con el de su `Property` en un
   * objeto ya parseado, no un fallo de parseo del formato de archivo en sí.
   */
  | "ESTRUCTURA_INVALIDA"
  /**
   * Agregado junto con `packages/core/src/almacenamiento/lectura.ts`
   * (T-0017): checklist de ADR-002 sección 5, punto 4 ("consistencia
   * id-vs-filename", cierra *id falsificado*) — el `id` que declara el
   * contenido ya parseado de un archivo no coincide con el id derivado de su
   * nombre de archivo (`<id>.md`/`<id>.json` sin extensión).
   *
   * No es `ID_DUPLICADO`: ese código es la unicidad de id *entre archivos
   * distintos* (punto 5 del mismo checklist, fuera de alcance de T-0017
   * porque necesita conocer todo el árbol, no un archivo aislado). Tampoco es
   * `ESTRUCTURA_INVALIDA`/`ENCABEZADO_INVALIDO`: esos describen que el
   * parseo del formato de archivo en sí falló; acá el parseo tuvo éxito y el
   * objeto resultante es válido en sí mismo — lo que falla es la
   * correspondencia entre ese objeto ya parseado y el archivo que lo
   * contiene.
   */
  | "ID_NO_COINCIDE_CON_ARCHIVO";

/**
 * `severidad: "error"` es una violación real de una invariante (rechaza el
 * objeto). `severidad: "advertencia"` es un hallazgo que se reporta pero
 * que, por decisión explícita de un ADR (ver `PROPERTY_VALUE_HUERFANO`),
 * no invalida por sí solo al objeto que lo contiene.
 */
export interface ErrorValidacion {
  codigo: CodigoErrorValidacion;
  mensaje: string;
  severidad: "error" | "advertencia";
  propertyId?: string;
  rowId?: string;
  nodoId?: string;
}

/** Azúcar para la política más común: rechazar solo si hay algo con severidad "error". */
export function tieneErroresFatales(errores: ErrorValidacion[]): boolean {
  return errores.some((error) => error.severidad === "error");
}

// ---------------------------------------------------------------------------
// Invariantes 2 y 3: PropertyValue de una Row contra el esquema de su Database
// ---------------------------------------------------------------------------

const PATRON_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function esNumeroValido(valor: number): boolean {
  return Number.isFinite(valor) && !Object.is(valor, -0);
}

function esFechaValida(valor: string): boolean {
  return PATRON_FECHA.test(valor);
}

/**
 * Formatea `valor` para un mensaje de diagnóstico legible. A diferencia de
 * `JSON.stringify` puro, no colapsa `NaN`/`Infinity`/`-Infinity` a la
 * cadena `"null"` ni pierde el signo de `-0` (que se serializa como `"0"`).
 * El diagnóstico de un rechazo tiene que decir la verdad sobre qué valor se
 * recibió — un mensaje que dice "recibió null" para un `NaN` real contradice
 * el espíritu de "diagnóstico visible" de ADR-002/006.
 */
function formatearValorParaDiagnostico(valor: unknown): string {
  if (typeof valor === "number") {
    if (Number.isNaN(valor)) return "NaN";
    if (valor === Number.POSITIVE_INFINITY) return "Infinity";
    if (valor === Number.NEGATIVE_INFINITY) return "-Infinity";
    if (Object.is(valor, -0)) return "-0";
  }
  return JSON.stringify(valor);
}

function errorTipoInvalido(propiedad: Property, mensaje: string): ErrorValidacion {
  return {
    codigo: "TIPO_INVALIDO",
    mensaje,
    severidad: "error",
    propertyId: propiedad.id,
  };
}

/**
 * Invariante 3: el tipo de un valor concreto coincide con el tipo declarado
 * de su Property (incluyendo las reglas de valor de ADR-002/ADR-004:
 * `numero` finito sin -0, `fecha` con forma YYYY-MM-DD, opciones de
 * select/multi_select existentes en `config.opciones`).
 */
function validarTipoValor(propiedad: Property, valor: ValorPropertyValue): ErrorValidacion | null {
  switch (propiedad.tipo) {
    case "texto":
    case "agente":
      if (typeof valor !== "string") {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (${propiedad.tipo}) espera un string, recibió ${formatearValorParaDiagnostico(valor)}`,
        );
      }
      return null;

    case "numero":
      if (typeof valor !== "number" || !esNumeroValido(valor)) {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (numero) espera un número finito sin NaN/Infinity/-0, recibió ${formatearValorParaDiagnostico(valor)}`,
        );
      }
      return null;

    case "fecha":
      if (typeof valor !== "string" || !esFechaValida(valor)) {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (fecha) espera un string "YYYY-MM-DD", recibió ${formatearValorParaDiagnostico(valor)}`,
        );
      }
      return null;

    case "checkbox":
      if (typeof valor !== "boolean") {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (checkbox) espera un boolean, recibió ${formatearValorParaDiagnostico(valor)}`,
        );
      }
      return null;

    case "select": {
      if (typeof valor !== "string") {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (select) espera el id de una opción (string), recibió ${formatearValorParaDiagnostico(valor)}`,
        );
      }
      const idsValidos = new Set(propiedad.config.opciones.map((opcion) => opcion.id));
      if (!idsValidos.has(valor)) {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (select) no tiene una opción con id "${valor}" en su config`,
        );
      }
      return null;
    }

    case "multi_select": {
      if (!Array.isArray(valor) || !valor.every((elemento) => typeof elemento === "string")) {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (multi_select) espera un array de ids de opción, recibió ${formatearValorParaDiagnostico(valor)}`,
        );
      }
      const idsValidos = new Set(propiedad.config.opciones.map((opcion) => opcion.id));
      const idsInvalidos = valor.filter((id) => !idsValidos.has(id));
      if (idsInvalidos.length > 0) {
        return errorTipoInvalido(
          propiedad,
          `la property "${propiedad.nombre}" (multi_select) no tiene opciones con id ${idsInvalidos
            .map((id) => `"${id}"`)
            .join(", ")} en su config`,
        );
      }
      return null;
    }
  }
}

/**
 * Cuenta cuántas veces aparece cada `propertyId` en `valores`. Un `Map` de
 * `propertyId → valor` (como el que usa el chequeo de "falta valor
 * requerido") colapsa duplicados sin dejar rastro — este conteo es lo que
 * permite detectarlos antes de perder esa información.
 */
function contarValoresPorPropertyId(valores: PropertyValue[]): Map<string, number> {
  const conteo = new Map<string, number>();
  for (const valor of valores) {
    conteo.set(valor.propertyId, (conteo.get(valor.propertyId) ?? 0) + 1);
  }
  return conteo;
}

/**
 * Invariantes 2 y 3 de docs/01-modelo-dominio.md.
 *
 * - Cada Property requerida del esquema de `database` tiene un
 *   PropertyValue en `row` (si no, error fatal: `PROPERTY_REQUERIDA_SIN_VALOR`).
 * - `row.valores` tiene como mucho un `PropertyValue` por `propertyId`
 *   (invariante 2: correspondencia 1:1, no "1 o más"). Dos o más valores
 *   para la misma Property es fatal: `PROPERTY_VALUE_DUPLICADO`.
 * - Cada PropertyValue de `row` cuyo `propertyId` no existe en el esquema es
 *   un huérfano. Según la aclaración de la invariante 2 en
 *   docs/01-modelo-dominio.md (ADR-006): esto NO rechaza la Row entera, solo
 *   esa entrada puntual — se reporta como `severidad: "advertencia"`, no
 *   como error fatal.
 * - Cada PropertyValue cuyo `propertyId` sí existe se valida contra el tipo
 *   declarado de esa Property (`TIPO_INVALIDO`, fatal).
 */
export function validarRow(database: Database, row: Row): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const propiedadesPorId = new Map(database.propiedades.map((propiedad) => [propiedad.id, propiedad]));
  const valoresPorPropertyId = new Map(row.valores.map((valor) => [valor.propertyId, valor]));

  for (const propiedad of database.propiedades) {
    if (propiedad.requerida && !valoresPorPropertyId.has(propiedad.id)) {
      errores.push({
        codigo: "PROPERTY_REQUERIDA_SIN_VALOR",
        mensaje: `falta un valor para la property requerida "${propiedad.nombre}" (${propiedad.id})`,
        severidad: "error",
        propertyId: propiedad.id,
        rowId: row.id,
      });
    }
  }

  for (const [propertyId, cantidad] of contarValoresPorPropertyId(row.valores)) {
    if (cantidad > 1) {
      errores.push({
        codigo: "PROPERTY_VALUE_DUPLICADO",
        mensaje: `la property "${propertyId}" tiene ${cantidad} PropertyValue en la misma Row; la invariante 2 exige como mucho uno`,
        severidad: "error",
        propertyId,
        rowId: row.id,
      });
    }
  }

  for (const propertyValue of row.valores) {
    const propiedad = propiedadesPorId.get(propertyValue.propertyId);
    if (!propiedad) {
      errores.push({
        codigo: "PROPERTY_VALUE_HUERFANO",
        mensaje: `el valor referencia la property "${propertyValue.propertyId}", que no existe en el esquema actual de la Database`,
        severidad: "advertencia",
        propertyId: propertyValue.propertyId,
        rowId: row.id,
      });
      continue;
    }
    const errorTipo = validarTipoValor(propiedad, propertyValue.valor);
    if (errorTipo) {
      errores.push({ ...errorTipo, rowId: row.id });
    }
  }

  return errores;
}

// ---------------------------------------------------------------------------
// Invariante 1: toda Row pertenece a exactamente una Database conocida
// ---------------------------------------------------------------------------

/**
 * Invariante 1: `row.parentId` tiene que resolver a una Database conocida.
 * Pura: recibe el conjunto de ids de Database ya conocidos por el llamador
 * (quien decide cómo los obtuvo — eso sí puede requerir I/O, pero no acá).
 */
export function validarRowPerteneceADatabase(
  row: Row,
  idsDeDatabasesConocidas: ReadonlySet<string>,
): ErrorValidacion[] {
  if (!idsDeDatabasesConocidas.has(row.parentId)) {
    return [
      {
        codigo: "PARENT_ID_INVALIDO",
        mensaje: `la Row "${row.id}" tiene parent_id "${row.parentId}", que no corresponde a ninguna Database conocida`,
        severidad: "error",
        rowId: row.id,
        nodoId: row.parentId,
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Invariante 5: el grafo de contención (parent_id) es un árbol estricto
// ---------------------------------------------------------------------------

export interface NodoConParent {
  id: string;
  parentId: string | null;
}

/**
 * Invariante 5: el grafo de `parentId` es un árbol estricto, sin ciclos.
 * Mismo patrón que `creaCiclo` de packages/tickets/src/store.ts: para cada
 * nodo, camina la cadena de parents acotada por la cantidad total de nodos;
 * si revisita un nodo antes de llegar a `null`, hay un ciclo. Un nodo cuya
 * cadena nunca termina en `null` (porque cicla, participe él directamente o
 * porque cae en un ciclo de otros nodos más arriba) se reporta igual: su
 * posición en el árbol queda indefinida.
 */
export function validarArbolContencion(nodos: NodoConParent[]): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const parentPorId = new Map(nodos.map((nodo) => [nodo.id, nodo.parentId]));

  for (const nodo of nodos) {
    const visitados = new Set<string>();
    let actual: string | null = nodo.id;
    let enCiclo = false;

    while (actual !== null) {
      if (visitados.has(actual)) {
        enCiclo = true;
        break;
      }
      visitados.add(actual);
      const siguiente = parentPorId.get(actual);
      // parent_id fuera de este conjunto de nodos: no es un ciclo acá, es
      // responsabilidad de otra validación (parent_id colgante).
      if (siguiente === undefined) break;
      actual = siguiente;
    }

    if (enCiclo) {
      errores.push({
        codigo: "CICLO_EN_CONTENCION",
        mensaje: `el nodo "${nodo.id}" participa de (o desciende de) un ciclo en el grafo de contención (parent_id)`,
        severidad: "error",
        nodoId: nodo.id,
      });
    }
  }

  return errores;
}

// ---------------------------------------------------------------------------
// Invariante 7 (unicidad, parte estática): sin dos nodos con el mismo id
// ---------------------------------------------------------------------------

/** No hay dos nodos con el mismo `id` en la colección (parte estática de la invariante 7). */
export function validarIdsUnicos(nodos: { id: string }[]): ErrorValidacion[] {
  const conteoPorId = new Map<string, number>();
  for (const nodo of nodos) {
    conteoPorId.set(nodo.id, (conteoPorId.get(nodo.id) ?? 0) + 1);
  }

  const errores: ErrorValidacion[] = [];
  for (const [id, cantidad] of conteoPorId) {
    if (cantidad > 1) {
      errores.push({
        codigo: "ID_DUPLICADO",
        mensaje: `el id "${id}" aparece ${cantidad} veces en la colección`,
        severidad: "error",
        nodoId: id,
      });
    }
  }
  return errores;
}
