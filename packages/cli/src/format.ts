/**
 * Formato humano de salida (T-0013), mismo rol que
 * `packages/tickets/src/format.ts`: el core devuelve objetos de dominio
 * tipados (ADR-005 sección 3, "el core... no imprime nada"), y decidir cómo
 * se ven en una terminal es responsabilidad exclusiva de esta superficie.
 */

import type { ErrorValidacion } from "@nido/core/src/invariantes.ts";
import type { ResultadoConsulta } from "@nido/core/src/indice/vistas.ts";
import type { Database, Page, Property, Row } from "@nido/core/src/types.ts";
import type { HashDeContenido } from "@nido/core/src/almacenamiento/hash.ts";

/** El hash es un `bigint` en memoria (ver `./json.ts`); en texto humano alcanza con su representación decimal. */
function formatearHash(hash: HashDeContenido): string {
  return hash === null ? "(ninguno)" : hash.toString();
}

export function formatearPage(page: Page, hash?: HashDeContenido): string {
  const lineas = [
    `Page ${page.id}`,
    `  titulo: ${page.titulo}`,
    `  parent: ${page.parentId ?? "(raíz del workspace)"}`,
    `  creado_en: ${page.creadoEn}`,
    `  actualizado_en: ${page.actualizadoEn}`,
    ...(hash !== undefined ? [`  hash: ${formatearHash(hash)}`] : []),
    "  cuerpo:",
    ...(page.cuerpo.length > 0 ? page.cuerpo.split("\n").map((linea) => `    ${linea}`) : ["    (vacío)"]),
  ];
  return lineas.join("\n");
}

function formatearProperty(propiedad: Property): string {
  const base = `${propiedad.nombre} [${propiedad.id}] tipo=${propiedad.tipo}${propiedad.requerida ? " requerida" : ""}`;
  if (propiedad.tipo !== "select" && propiedad.tipo !== "multi_select") return base;
  const opciones = propiedad.config.opciones.map((opcion) => `${opcion.nombre}(${opcion.id})`).join(", ");
  return `${base} opciones=[${opciones}]`;
}

export function formatearDatabase(database: Database): string {
  const lineas = [
    `Database ${database.id}`,
    `  titulo: ${database.titulo}`,
    `  parent: ${database.parentId ?? "(raíz del workspace)"}`,
    `  propiedades (${database.propiedades.length}):`,
    ...database.propiedades.map((propiedad) => `    - ${formatearProperty(propiedad)}`),
    `  vistas (${database.vistas.length}):`,
    ...database.vistas.map((vista) => `    - ${vista.nombre} [${vista.id}]`),
  ];
  return lineas.join("\n");
}

function formatearValores(row: Row): string[] {
  return row.valores.map((valor) => `    - ${valor.propertyId}: ${JSON.stringify(valor.valor)}`);
}

export function formatearRow(row: Row, advertencias: ErrorValidacion[] = []): string {
  const lineas = [
    `Row ${row.id}`,
    `  titulo: ${row.titulo}`,
    `  database (parent): ${row.parentId}`,
    "  valores:",
    ...formatearValores(row),
  ];
  if (advertencias.length > 0) {
    lineas.push("  advertencias:");
    for (const advertencia of advertencias) lineas.push(`    - [${advertencia.severidad}] ${advertencia.mensaje}`);
  }
  return lineas.join("\n");
}

export function formatearResultadoConsulta(resultado: ResultadoConsulta): string {
  const lineas = [`${resultado.filas.length} fila(s):`];
  for (const fila of resultado.filas) {
    lineas.push(`  - ${fila.id} "${fila.titulo}"`);
    lineas.push(...formatearValores(fila).map((linea) => `  ${linea}`));
  }
  if (resultado.diagnosticos.length > 0) {
    lineas.push("diagnósticos:");
    for (const diagnostico of resultado.diagnosticos) {
      lineas.push(`  - [${diagnostico.severidad}] ${diagnostico.mensaje}`);
    }
  }
  return lineas.join("\n");
}
