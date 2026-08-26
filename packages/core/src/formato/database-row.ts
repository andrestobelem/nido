/**
 * Serializador/parser canónico JSON de Database y Row (T-0016, ADR-002
 * sección 3). Puro: string <-> objeto tipado, sin I/O real de archivos (sin
 * `Bun.file`, sin `node:fs`, sin `bun:sqlite`) — eso es de T-0017/T-0018.
 *
 * Nombres de clave en disco: ADR-002 sección 3 fija el orden de Database y
 * Row usando el vocabulario snake_case de `docs/01-modelo-dominio.md`
 * (`parent_id`, `creado_en`, `actualizado_en`; y, para `valores` de una Row,
 * `property_id`). `packages/core/src/formato/page.ts` (T-0015, mismo ADR,
 * mismo sprint) confirma que esto no es solo prosa de dominio: su
 * encabezado de Page literalmente escribe `parent_id`/`creado_en`/
 * `actualizado_en` en el archivo y traduce hacia/desde los campos camelCase
 * de `Page` (`parentId`/`creadoEn`/`actualizadoEn`). Este módulo sigue el
 * mismo criterio para Database/Row, por consistencia dentro del mismo
 * formato de archivo: en disco, snake_case; en memoria (el tipo `Database`/
 * `Row` de `types.ts`), camelCase — y este módulo es la única frontera que
 * traduce entre las dos convenciones.
 *
 * Alcance de esa traducción: se aplica a los campos propios de Database/Row
 * que ADR-002 sección 3 enumera explícitamente (`parentId`↔`parent_id`,
 * `creadoEn`↔`creado_en`, `actualizadoEn`↔`actualizado_en`) y al
 * `propertyId`↔`property_id` de cada `PropertyValue` dentro de `valores`
 * (la sección 3 lo nombra explícitamente para la regla de orden). NO se
 * aplica dentro de `propiedades` ni de `vistas`: esas listas se preservan
 * "tal cual vienen, sin reordenar" (instrucción explícita de este ticket) y
 * su contenido interno (p. ej. `View.databaseId`/`View.columnasVisibles`,
 * o el árbol de `filtros`) no está entre las reglas que ADR-002 sección 3
 * fija para Database/Row — el formato de persistencia de `Property`/`View`
 * en sí no es parte del alcance de este ticket (linda con ADR-004, que este
 * módulo no lee). `Property` en particular no necesita ninguna traducción
 * de todos modos: sus campos (`id`, `nombre`, `tipo`, `requerida`, `config.
 * opciones[].{id,nombre}`) ya son iguales en ambas convenciones.
 *
 * Alcance de la validación en el parseo: este módulo valida la forma propia
 * de Database/Row (claves exactas, tipos primitivos, fechas ISO completas,
 * y cada `PropertyValue` de `valores`) porque el tipo runtime de `valor`
 * (string/number/boolean/string[]) alcanza para aplicarle las reglas de
 * ADR-002 sin necesitar el esquema de la Database (una Property no viaja
 * junto a su PropertyValue). No valida la forma interna de cada `Property`
 * ni de cada `View` dentro de `propiedades`/`vistas` — ver el párrafo
 * anterior; solo se verifica que sean arrays.
 *
 * Códigos de error: se reutiliza `ErrorValidacion` de `invariantes.ts` tal
 * cual (mismo tipo, sin modificarlo). Para el código, se agregó
 * `"ESTRUCTURA_INVALIDA"` a la unión `CodigoErrorValidacion` en
 * `invariantes.ts`, con el mismo criterio que `page.ts` (T-0015) usó para
 * agregar `"ENCABEZADO_INVALIDO"`: ninguno de los códigos existentes
 * describe "el parseo del formato de archivo en sí falló" (son todos sobre
 * invariantes de un objeto ya parseado), así que reusar uno habría sido
 * impreciso.
 */

import type { ErrorValidacion } from "../invariantes.ts";
import type { Database, Property, PropertyValue, Row, ValorPropertyValue, View } from "../types.ts";

// ---------------------------------------------------------------------------
// Helpers compartidos
// ---------------------------------------------------------------------------

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function errorEstructura(mensaje: string, extra: Partial<ErrorValidacion> = {}): ErrorValidacion {
  return { codigo: "ESTRUCTURA_INVALIDA", mensaje, severidad: "error", ...extra };
}

/**
 * Mismo criterio que `formatearValorParaDiagnostico` de `invariantes.ts`
 * (no exportado desde ahí, así que se duplica acá en vez de modificar ese
 * archivo): un diagnóstico tiene que decir la verdad sobre qué valor se
 * recibió, sin que `JSON.stringify` colapse `NaN`/`Infinity`/`-Infinity` a
 * `"null"` ni pierda el signo de `-0`.
 */
function formatearParaDiagnostico(valor: unknown): string {
  if (typeof valor === "number") {
    if (Number.isNaN(valor)) return "NaN";
    if (valor === Number.POSITIVE_INFINITY) return "Infinity";
    if (valor === Number.NEGATIVE_INFINITY) return "-Infinity";
    if (Object.is(valor, -0)) return "-0";
  }
  return JSON.stringify(valor);
}

/** Comparación de string ascendente lisa (no localeCompare — ADR pide comparación de string, no colación por locale). */
function compararAscendente(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * `creado_en`/`actualizado_en` siempre como `Date.prototype.toISOString()`
 * completo (ADR-002 sección 3). Normaliza en vez de asumir que el string
 * que ya trae el objeto está en forma canónica — defensivo, para que
 * `serializarDatabase`/`serializarRow` nunca emitan una fecha truncada o con
 * offset no-UTC aunque el objeto en memoria no la tuviera perfecta.
 */
function normalizarFechaISO(valor: string, contexto: string): string {
  const fecha = new Date(valor);
  if (Number.isNaN(fecha.getTime())) {
    throw new Error(`${contexto}: no se puede serializar, no es una fecha válida: "${valor}"`);
  }
  return fecha.toISOString();
}

const PATRON_FECHA_ISO_COMPLETA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Válida sólo si `valor` ya está en la forma canónica exacta que emite
 * `toISOString()` (milisegundos + `Z`) y además representa una fecha de
 * calendario real (rechaza cosas como un 30 de febrero, que `new Date`
 * normalizaría en silencio a otro día). El round-trip
 * `new Date(valor).toISOString() === valor` cierra ambos casos a la vez.
 */
function esFechaIsoValida(valor: string): boolean {
  if (!PATRON_FECHA_ISO_COMPLETA.test(valor)) return false;
  const fecha = new Date(valor);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString() === valor;
}

/**
 * Canonicaliza un valor de PropertyValue antes de serializar:
 * - `multi_select` (representado en runtime como `string[]`, el único tipo
 *   de PropertyValue que es array — no hace falta el esquema para saberlo):
 *   se ordena lexicográficamente y se deduplica.
 * - `numero`: se rechaza defensivamente NaN/Infinity/-Infinity/-0. La
 *   validación "real" es responsabilidad de `validarRow` (invariantes.ts)
 *   antes de llegar acá; esto es la red de seguridad de "sé defensivo".
 * - `fecha` (string "YYYY-MM-DD") y `texto`/`agente`/`select` (string) y
 *   `checkbox` (boolean): se devuelven tal cual, verbatim — en particular,
 *   nunca se construye un `Date` a partir de un string acá, así se cierra
 *   por diseño la clase de bug de reparseo de fecha que ADR-002 cita
 *   (Obsidian/mcpvault #77).
 */
function canonicalizarValor(valor: ValorPropertyValue, contexto: string): ValorPropertyValue {
  if (Array.isArray(valor)) {
    return [...new Set(valor)].sort(compararAscendente);
  }
  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || Object.is(valor, -0)) {
      throw new Error(
        `${contexto}: no se puede serializar un numero invalido (NaN/Infinity/-Infinity/-0): ${formatearParaDiagnostico(valor)} — debería haber sido rechazado por validarRow antes de llegar al serializador`,
      );
    }
    return valor;
  }
  return valor;
}

// ---------------------------------------------------------------------------
// Serialización
// ---------------------------------------------------------------------------

/**
 * ADR-002 sección 3, orden fijo de Database (claves en disco, snake_case —
 * ver comentario de cabecera del módulo):
 * id, tipo, parent_id, titulo, cuerpo (solo si está presente), propiedades,
 * vistas, creado_en, actualizado_en.
 */
export function serializarDatabase(db: Database): string {
  const salida: Record<string, unknown> = {
    id: db.id,
    tipo: db.tipo,
    parent_id: db.parentId,
    titulo: db.titulo,
  };
  // Opcional ausente vs. null (ADR-002 sección 3): la clave solo aparece si
  // `cuerpo` está presente. Un `null` explícito (violación del tipo, pero
  // esto es la frontera defensiva de escritura) se trata igual que ausente.
  if (db.cuerpo !== undefined && db.cuerpo !== null) {
    salida.cuerpo = db.cuerpo;
  }
  // Preservan el orden que ya traen, y su contenido interno tal cual (sin
  // traducir claves) — no se reordenan ni se reescriben (ADR-002 sección 3;
  // ver comentario de cabecera sobre el alcance de la traducción de claves).
  salida.propiedades = db.propiedades;
  salida.vistas = db.vistas;
  salida.creado_en = normalizarFechaISO(db.creadoEn, `Database ${db.id}, creadoEn`);
  salida.actualizado_en = normalizarFechaISO(db.actualizadoEn, `Database ${db.id}, actualizadoEn`);
  return `${JSON.stringify(salida, null, 2)}\n`;
}

/**
 * ADR-002 sección 3, orden fijo de Row (claves en disco, snake_case):
 * id, tipo, parent_id, titulo, creado_en, actualizado_en, valores.
 * `valores` se ordena por `property_id` ascendente antes de serializar.
 */
export function serializarRow(row: Row): string {
  const valoresOrdenados = [...row.valores]
    .sort((a, b) => compararAscendente(a.propertyId, b.propertyId))
    .map((propertyValue) => ({
      property_id: propertyValue.propertyId,
      valor: canonicalizarValor(
        propertyValue.valor,
        `Row ${row.id}, property ${propertyValue.propertyId}`,
      ),
    }));

  const salida: Record<string, unknown> = {
    id: row.id,
    tipo: row.tipo,
    parent_id: row.parentId,
    titulo: row.titulo,
    creado_en: normalizarFechaISO(row.creadoEn, `Row ${row.id}, creadoEn`),
    actualizado_en: normalizarFechaISO(row.actualizadoEn, `Row ${row.id}, actualizadoEn`),
    valores: valoresOrdenados,
  };
  return `${JSON.stringify(salida, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Parseo (total: un error de sintaxis rechaza el archivo completo)
// ---------------------------------------------------------------------------

function intentarParsearJson(contenido: string): { valor: unknown } | { errores: ErrorValidacion[] } {
  try {
    return { valor: JSON.parse(contenido) };
  } catch (error) {
    return {
      errores: [
        errorEstructura(
          `el contenido no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }
}

/** Exige el conjunto exacto de claves: ni falta una requerida, ni sobra una inesperada (ADR-002 sección 5, punto 3). */
function validarClavesExactas(
  objeto: Record<string, unknown>,
  requeridas: readonly string[],
  opcionales: readonly string[] = [],
): ErrorValidacion[] {
  const errores: ErrorValidacion[] = [];
  const permitidas = new Set<string>([...requeridas, ...opcionales]);
  for (const clave of requeridas) {
    if (!(clave in objeto)) {
      errores.push(errorEstructura(`falta la clave requerida "${clave}"`));
    }
  }
  for (const clave of Object.keys(objeto)) {
    if (!permitidas.has(clave)) {
      errores.push(errorEstructura(`clave inesperada "${clave}" — no forma parte del esquema de este tipo de nodo`));
    }
  }
  return errores;
}

/** `valor` es una forma válida de `ValorPropertyValue` (defensivo con `numero`, igual que en serialización). */
function esValorPropertyValueValido(valor: unknown): valor is ValorPropertyValue {
  if (typeof valor === "string" || typeof valor === "boolean") return true;
  if (typeof valor === "number") return Number.isFinite(valor) && !Object.is(valor, -0);
  if (Array.isArray(valor)) return valor.every((elemento) => typeof elemento === "string");
  return false;
}

/**
 * Parsea y valida la forma de `valores` de una Row. No conoce el esquema de
 * la Database (eso es `validarRow` en invariantes.ts): solo verifica que
 * cada elemento tenga exactamente `{ property_id, valor }` y que `valor`
 * tenga una de las cuatro formas runtime válidas (con `numero` rechazando
 * NaN/Infinity/-Infinity/-0 defensivamente).
 */
function parsearValores(
  bruto: unknown,
  rowId: string | undefined,
): { valores: PropertyValue[] } | { errores: ErrorValidacion[] } {
  if (!Array.isArray(bruto)) {
    return { errores: [errorEstructura('el campo "valores" debe ser un array', { rowId })] };
  }

  const errores: ErrorValidacion[] = [];
  const valores: PropertyValue[] = [];

  for (const [indice, entrada] of bruto.entries()) {
    if (!esRegistro(entrada)) {
      errores.push(errorEstructura(`el elemento ${indice} de "valores" no es un objeto`, { rowId }));
      continue;
    }
    const clavesInesperadas = Object.keys(entrada).filter((clave) => clave !== "property_id" && clave !== "valor");
    if (clavesInesperadas.length > 0) {
      errores.push(
        errorEstructura(
          `el elemento ${indice} de "valores" tiene claves inesperadas: ${clavesInesperadas.join(", ")}`,
          { rowId },
        ),
      );
    }
    if (typeof entrada.property_id !== "string") {
      errores.push(
        errorEstructura(`el elemento ${indice} de "valores" tiene "property_id" inválido (debe ser string)`, {
          rowId,
        }),
      );
      continue;
    }
    if (!("valor" in entrada) || !esValorPropertyValueValido(entrada.valor)) {
      errores.push(
        errorEstructura(
          `el elemento ${indice} de "valores" (property "${entrada.property_id}") tiene "valor" inválido: ${formatearParaDiagnostico(entrada.valor)}`,
          { rowId, propertyId: entrada.property_id },
        ),
      );
      continue;
    }
    valores.push({ propertyId: entrada.property_id, valor: entrada.valor });
  }

  if (errores.length > 0) return { errores };
  return { valores };
}

const CLAVES_DATABASE_REQUERIDAS = [
  "id",
  "tipo",
  "parent_id",
  "titulo",
  "propiedades",
  "vistas",
  "creado_en",
  "actualizado_en",
] as const;

/**
 * Parseo total (JSON.parse) y validación de forma de una Database, según el
 * orden/reglas de ADR-002 sección 3. Un error de sintaxis JSON rechaza el
 * archivo completo. No valida el contenido interno de `propiedades`/`vistas`
 * (ver comentario de cabecera del módulo) — solo que sean arrays.
 */
export function parsearDatabase(contenido: string): Database | ErrorValidacion[] {
  const resultadoJson = intentarParsearJson(contenido);
  if ("errores" in resultadoJson) return resultadoJson.errores;
  const bruto = resultadoJson.valor;

  if (!esRegistro(bruto)) {
    return [errorEstructura("el contenido no representa un objeto JSON (una Database debe ser un objeto)")];
  }

  const errores: ErrorValidacion[] = [];
  errores.push(...validarClavesExactas(bruto, CLAVES_DATABASE_REQUERIDAS, ["cuerpo"]));

  const nodoId = typeof bruto.id === "string" ? bruto.id : undefined;

  if (typeof bruto.id !== "string") {
    errores.push(errorEstructura('el campo "id" debe ser un string'));
  }
  if (bruto.tipo !== "pagina") {
    errores.push(
      errorEstructura(`el campo "tipo" de una Database debe ser "pagina", recibió ${formatearParaDiagnostico(bruto.tipo)}`, {
        nodoId,
      }),
    );
  }
  if (!(bruto.parent_id === null || typeof bruto.parent_id === "string")) {
    errores.push(errorEstructura('el campo "parent_id" debe ser un string o null', { nodoId }));
  }
  if (typeof bruto.titulo !== "string") {
    errores.push(errorEstructura('el campo "titulo" debe ser un string', { nodoId }));
  }
  if ("cuerpo" in bruto && typeof bruto.cuerpo !== "string") {
    errores.push(
      errorEstructura('el campo "cuerpo", cuando está presente, debe ser un string (nunca null: ADR-002 sección 3)', {
        nodoId,
      }),
    );
  }
  if (!Array.isArray(bruto.propiedades)) {
    errores.push(errorEstructura('el campo "propiedades" debe ser un array', { nodoId }));
  }
  if (!Array.isArray(bruto.vistas)) {
    errores.push(errorEstructura('el campo "vistas" debe ser un array', { nodoId }));
  }
  if (typeof bruto.creado_en !== "string" || !esFechaIsoValida(bruto.creado_en)) {
    errores.push(
      errorEstructura(
        'el campo "creado_en" debe ser un string ISO-8601 completo válido (ej. "2026-08-26T10:00:00.000Z")',
        { nodoId },
      ),
    );
  }
  if (typeof bruto.actualizado_en !== "string" || !esFechaIsoValida(bruto.actualizado_en)) {
    errores.push(
      errorEstructura('el campo "actualizado_en" debe ser un string ISO-8601 completo válido', { nodoId }),
    );
  }

  if (errores.length > 0) return errores;

  const database: Database = {
    id: bruto.id as string,
    tipo: "pagina",
    parentId: bruto.parent_id as string | null,
    titulo: bruto.titulo as string,
    ...("cuerpo" in bruto ? { cuerpo: bruto.cuerpo as string } : {}),
    propiedades: bruto.propiedades as Property[],
    vistas: bruto.vistas as View[],
    creadoEn: bruto.creado_en as string,
    actualizadoEn: bruto.actualizado_en as string,
  };
  return database;
}

const CLAVES_ROW_REQUERIDAS = ["id", "tipo", "parent_id", "titulo", "creado_en", "actualizado_en", "valores"] as const;

/**
 * Parseo total (JSON.parse) y validación de forma de una Row, según el
 * orden/reglas de ADR-002 sección 3. Un error de sintaxis JSON rechaza el
 * archivo completo. No conoce el esquema de la Database padre: solo valida
 * la forma runtime de cada `PropertyValue` en `valores` (ver `parsearValores`).
 */
export function parsearRow(contenido: string): Row | ErrorValidacion[] {
  const resultadoJson = intentarParsearJson(contenido);
  if ("errores" in resultadoJson) return resultadoJson.errores;
  const bruto = resultadoJson.valor;

  if (!esRegistro(bruto)) {
    return [errorEstructura("el contenido no representa un objeto JSON (una Row debe ser un objeto)")];
  }

  const errores: ErrorValidacion[] = [];
  errores.push(...validarClavesExactas(bruto, CLAVES_ROW_REQUERIDAS));

  const rowId = typeof bruto.id === "string" ? bruto.id : undefined;

  if (typeof bruto.id !== "string") {
    errores.push(errorEstructura('el campo "id" debe ser un string'));
  }
  if (bruto.tipo !== "fila") {
    errores.push(
      errorEstructura(`el campo "tipo" de una Row debe ser "fila", recibió ${formatearParaDiagnostico(bruto.tipo)}`, {
        rowId,
      }),
    );
  }
  if (typeof bruto.parent_id !== "string") {
    errores.push(
      errorEstructura('el campo "parent_id" de una Row debe ser un string (una Row siempre pertenece a una Database)', {
        rowId,
      }),
    );
  }
  if (typeof bruto.titulo !== "string") {
    errores.push(errorEstructura('el campo "titulo" debe ser un string', { rowId }));
  }
  if (typeof bruto.creado_en !== "string" || !esFechaIsoValida(bruto.creado_en)) {
    errores.push(
      errorEstructura('el campo "creado_en" debe ser un string ISO-8601 completo válido', { rowId }),
    );
  }
  if (typeof bruto.actualizado_en !== "string" || !esFechaIsoValida(bruto.actualizado_en)) {
    errores.push(
      errorEstructura('el campo "actualizado_en" debe ser un string ISO-8601 completo válido', { rowId }),
    );
  }

  let valoresParseados: PropertyValue[] = [];
  const resultadoValores = parsearValores(bruto.valores, rowId);
  if ("errores" in resultadoValores) {
    errores.push(...resultadoValores.errores);
  } else {
    valoresParseados = resultadoValores.valores;
  }

  if (errores.length > 0) return errores;

  const row: Row = {
    id: bruto.id as string,
    tipo: "fila",
    parentId: bruto.parent_id as string,
    titulo: bruto.titulo as string,
    creadoEn: bruto.creado_en as string,
    actualizadoEn: bruto.actualizado_en as string,
    valores: valoresParseados,
  };
  return row;
}
