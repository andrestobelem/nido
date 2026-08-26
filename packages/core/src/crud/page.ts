/**
 * CRUD de alto nivel para Page (T-0019). Wrapper delgado sobre el motor de
 * T-0017 (`../almacenamiento/{lectura,escritura}.ts`): lo único que agrega
 * es la convención de id/path de `./ids.ts` y el manejo de timestamps
 * (`creadoEn`/`actualizadoEn`), que acá pasa a ser responsabilidad de este
 * módulo y no de cada llamador — mismo criterio que
 * `packages/tickets/src/store.ts` (cada operación de mutación bumpea
 * `actualizadoEn` ella misma, en vez de confiar en que el llamador lo haga).
 */

import type { HashDeContenido } from "../almacenamiento/hash.ts";
import { escribirPage } from "../almacenamiento/escritura.ts";
import { leerPage as leerPageAlmacenamiento, type ResultadoLectura } from "../almacenamiento/lectura.ts";
import type { Page } from "../types.ts";
import { crearConIdReintentando, pathDePage } from "./ids.ts";
import type { NodoEscrito } from "./tipos.ts";

export interface CrearPageInput {
  titulo: string;
  cuerpo: string;
  parentId: string | null;
}

/** Genera un id (`./ids.ts`), fija `creadoEn === actualizadoEn` a la hora actual, y escribe la Page nueva vía CAS de creación (ADR-001 punto 1). */
export async function crearPage(raizWorkspace: string, input: CrearPageInput): Promise<NodoEscrito<Page>> {
  return crearConIdReintentando(async (id) => {
    const ahora = new Date().toISOString();
    const page: Page = {
      id,
      tipo: "pagina",
      parentId: input.parentId,
      titulo: input.titulo,
      cuerpo: input.cuerpo,
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    const resultado = await escribirPage(raizWorkspace, pathDePage(id), page, null);
    return { valor: page, hash: resultado.hash };
  });
}

export function leerPage(raizWorkspace: string, id: string): Promise<ResultadoLectura<Page>> {
  return leerPageAlmacenamiento(raizWorkspace, pathDePage(id));
}

export type CambiosPage = Partial<Pick<Page, "titulo" | "cuerpo" | "parentId">>;

/**
 * Actualiza una Page existente con CAS (ADR-001 punto 2): `pageActual` y
 * `hashEsperado` tienen que venir de una lectura previa (`leerPage`) — la
 * escritura se aborta con `ConflictoDeEscritura` (propagado tal cual desde
 * `../almacenamiento/escritura.ts`) si el archivo cambió desde esa lectura,
 * sin sobrescribir nada. `actualizadoEn` se recalcula acá siempre — el valor
 * que traiga `pageActual.actualizadoEn` no importa.
 */
export async function actualizarPage(
  raizWorkspace: string,
  pageActual: Page,
  hashEsperado: HashDeContenido,
  cambios: CambiosPage,
): Promise<NodoEscrito<Page>> {
  const actualizada: Page = { ...pageActual, ...cambios, actualizadoEn: new Date().toISOString() };
  const resultado = await escribirPage(raizWorkspace, pathDePage(pageActual.id), actualizada, hashEsperado);
  return { valor: actualizada, hash: resultado.hash };
}
