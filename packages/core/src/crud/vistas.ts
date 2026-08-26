/**
 * CRUD de alto nivel para View dentro de una Database (T-0019). Toda
 * mutación de `vistas` es, igual que las de `./database.ts`, una sola
 * escritura CAS sobre el archivo de la Database — una View se materializa
 * dentro del archivo de su Database (`docs/01-modelo-dominio.md`), nunca en
 * archivo propio.
 *
 * `agregarVista`/`actualizarVista` validan, ANTES de escribir: que
 * `view.databaseId` coincida con la Database en la que se está insertando
 * (si no, `VistaDatabaseIdIncorrecto` — sin este chequeo, nada impedía
 * persistir una View con un `databaseId` que apunta a otra Database
 * distinta de la que realmente la contiene, un campo de dominio
 * factualmente falso); y `filtros`/`orden` contra el esquema actual,
 * reusando `validarFiltros`/`validarOrden` de `../indice/vistas.ts` (las
 * mismas funciones puras que usa la resolución de consultas, no una
 * reimplementación) — así nunca se persiste una View que la próxima
 * resolución rechazaría de entrada.
 *
 * `resolverVistaDeDatabase` es el punto de integración explícito con el
 * índice de T-0018 que pide el alcance de T-0019 ("resolver una View" como
 * ejemplo de operación que necesita ver más de un archivo): construye el
 * índice del workspace, ubica la Database y la View por id, y delega la
 * resolución real en `resolverVista`.
 */

import type { HashDeContenido } from "../almacenamiento/hash.ts";
import { escribirDatabase } from "../almacenamiento/escritura.ts";
import { construirIndice } from "../indice/construccion.ts";
import { resolverVista, validarFiltros, validarOrden, type ResultadoConsulta } from "../indice/vistas.ts";
import type { ErrorValidacion } from "../invariantes.ts";
import type { Database, View } from "../types.ts";
import {
  DatabaseNoIndexada,
  VistaDatabaseIdIncorrecto,
  VistaIdDuplicada,
  VistaInvalida,
  VistaNoEncontrada,
} from "./errores.ts";
import { pathDeDatabase } from "./ids.ts";
import type { NodoEscrito } from "./tipos.ts";

function erroresDeVista(view: View, database: Database): ErrorValidacion[] {
  return [...validarFiltros(view.filtros, database), ...validarOrden(view.orden, database)];
}

/** Rechaza (`VistaDatabaseIdIncorrecto`) si `view.databaseId` no coincide con `database.id` — ver el comentario de esa clase en `./errores.ts`. Corre antes que cualquier otra validación de la View. */
function validarDatabaseIdOLanzar(view: View, database: Database): void {
  if (view.databaseId !== database.id) {
    throw new VistaDatabaseIdIncorrecto(database.id, view.id, view.databaseId);
  }
}

async function escribirVistas(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  vistas: View[],
): Promise<NodoEscrito<Database>> {
  const actualizada: Database = { ...databaseActual, vistas, actualizadoEn: new Date().toISOString() };
  const resultado = await escribirDatabase(raizWorkspace, pathDeDatabase(databaseActual.id), actualizada, hashEsperado);
  return { valor: actualizada, hash: resultado.hash };
}

/** Agrega `vistaNueva` a `databaseActual.vistas`. Rechaza (`VistaDatabaseIdIncorrecto`) un `databaseId` que no coincide con `databaseActual.id`, (`VistaIdDuplicada`) un id ya usado, o (`VistaInvalida`) una View cuyo `filtros`/`orden` no valida contra el esquema actual — en todos los casos, sin escribir nada. */
export async function agregarVista(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  vistaNueva: View,
): Promise<NodoEscrito<Database>> {
  validarDatabaseIdOLanzar(vistaNueva, databaseActual);
  if (databaseActual.vistas.some((view) => view.id === vistaNueva.id)) {
    throw new VistaIdDuplicada(databaseActual.id, vistaNueva.id);
  }
  const errores = erroresDeVista(vistaNueva, databaseActual);
  if (errores.length > 0) throw new VistaInvalida(vistaNueva.id, errores);

  return escribirVistas(raizWorkspace, databaseActual, hashEsperado, [...databaseActual.vistas, vistaNueva]);
}

/** Reemplaza, en su misma posición del array (ver decisión de orden en `./database.ts`), la View con `vistaActualizada.id`. Rechaza (`VistaDatabaseIdIncorrecto`/`VistaNoEncontrada`/`VistaInvalida`) sin escribir nada. */
export async function actualizarVista(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  vistaActualizada: View,
): Promise<NodoEscrito<Database>> {
  validarDatabaseIdOLanzar(vistaActualizada, databaseActual);
  if (!databaseActual.vistas.some((view) => view.id === vistaActualizada.id)) {
    throw new VistaNoEncontrada(databaseActual.id, vistaActualizada.id);
  }
  const errores = erroresDeVista(vistaActualizada, databaseActual);
  if (errores.length > 0) throw new VistaInvalida(vistaActualizada.id, errores);

  const vistas = databaseActual.vistas.map((view) => (view.id === vistaActualizada.id ? vistaActualizada : view));
  return escribirVistas(raizWorkspace, databaseActual, hashEsperado, vistas);
}

/** Quita la View `viewId` de `databaseActual.vistas`. Nunca falla por el contenido de la View (a diferencia de agregar/actualizar, no hay nada que validar al sacarla) — solo si no existe (`VistaNoEncontrada`). */
export async function quitarVista(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  viewId: string,
): Promise<NodoEscrito<Database>> {
  if (!databaseActual.vistas.some((view) => view.id === viewId)) {
    throw new VistaNoEncontrada(databaseActual.id, viewId);
  }
  return escribirVistas(
    raizWorkspace,
    databaseActual,
    hashEsperado,
    databaseActual.vistas.filter((view) => view.id !== viewId),
  );
}

/**
 * Construye el índice completo de `raizWorkspace`, ubica la Database
 * `databaseId` y la View `viewId` dentro de ella, y resuelve la consulta —
 * el punto de integración T-0017+T-0018 que pide el alcance de T-0019 para
 * "resolver una View". Cierra la conexión sqlite del índice antes de
 * devolver (o de lanzar).
 */
export async function resolverVistaDeDatabase(
  raizWorkspace: string,
  databaseId: string,
  viewId: string,
): Promise<ResultadoConsulta | ErrorValidacion[]> {
  const indice = await construirIndice(raizWorkspace);
  try {
    const database = indice.databases.get(databaseId);
    if (!database) throw new DatabaseNoIndexada(databaseId);
    const view = database.valor.vistas.find((v) => v.id === viewId);
    if (!view) throw new VistaNoEncontrada(databaseId, viewId);
    return resolverVista(indice, database.valor, view);
  } finally {
    indice.sqlite.close();
  }
}
