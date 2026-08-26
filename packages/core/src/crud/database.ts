/**
 * CRUD de alto nivel para Database, incluyendo la migración de esquema de
 * `docs/adr/006-migracion-de-esquema.md` (T-0019). Las tres operaciones de
 * esquema (`agregarProperty`, `promoverPropertyARequerida`, `quitarProperty`)
 * siempre se resuelven como una sola escritura CAS sobre el archivo de la
 * Database — nunca tocan ningún archivo de Row, exactamente como exige
 * ADR-006 ("una operación de escritura sobre el archivo de la Database...
 * siempre puede resolverse tocando un solo archivo").
 *
 * `agregarProperty`/`promoverPropertyARequerida` sí necesitan CONSULTAR
 * (nunca escribir) el estado de las Rows de la Database, para lo que
 * escanean el árbol fresco en cada llamada — nunca aceptan un resultado ya
 * calculado por el llamador, que podría estar desactualizado (ADR-006
 * sección 2, explícito para `promote`: "nunca confía en un índice que pueda
 * estar desactualizado"; se aplica el mismo criterio a `agregarProperty` por
 * consistencia y simplicidad, aunque el ADR es menos estricto ahí — el peor
 * caso de una lectura vieja ya lo cierra el checklist de validación que
 * corre en cada lectura/reconstrucción, igual que la "race residual" que
 * ADR-006 acepta explícitamente para `promote`).
 *
 * ## Por qué NO se usa `construirIndice` de T-0018 para esto (decisión
 * corregida tras revisión — hallazgo de T-0019)
 *
 * La primera versión de este módulo usaba `construirIndice` (el índice
 * completo de T-0018, `../indice/construccion.ts`) para contar Rows y
 * verificar valores. Es la elección incorrecta acá: `construirIndice`
 * excluye de `indice.filas` toda Row con un error fatal contra el esquema
 * ACTUAL de su Database — correcto para su propio consumidor (resolver una
 * View no debe mostrar una Row inválida), pero **no** para estas dos
 * preguntas de migración, que son sobre las Rows tal como existen en disco,
 * no sobre las que hoy pasan la validación completa de esquema. Una Row
 * real con, por ejemplo, un `PropertyValue` huérfano de OTRA Property que
 * pasó a tener `TIPO_INVALIDO` (tras `quitarProperty` + re-`agregarProperty`
 * con el mismo id pero otro tipo — una secuencia legítima de la API
 * pública) quedaba invisible para ambos chequeos: `agregarProperty` podía
 * agregar una Property requerida a una Database que en los hechos tenía
 * Rows, y `promoverPropertyARequerida` podía prometer una Property aunque
 * una Row real nunca hubiera tenido valor para ella. Por eso ambas funciones
 * usan `listarFilasCrudasDeDatabase` (mismo módulo de T-0018, pero el paso
 * estructural — JSON válido, forma de Row, id-vs-filename — sin el paso de
 * validación de esquema): ver el comentario de esa función para el detalle
 * completo.
 *
 * ## Decisión explícita sobre la nota de T-0016 (orden de Property/View)
 *
 * `docs/tickets/T-0019.json` trae un comentario pendiente de la revisión de
 * T-0016: el serializador de Database (`../formato/database-row.ts`) no
 * canonicaliza el orden interno de `propiedades`/`vistas` — preserva el
 * orden en memoria tal cual. Decisión de este ticket: **no se agrega
 * canonicalización nueva**, porque ninguna operación de este módulo (ni las
 * de `./vistas.ts`) puede generar un diff espurio con el orden que ya hay:
 *
 * - `agregarProperty`/`agregarVista` appendean al final del array — nunca
 *   reordenan lo existente.
 * - `quitarProperty`/`quitarVista` filtran un elemento, preservando el
 *   orden relativo del resto.
 * - `promoverPropertyARequerida`/`actualizarVista` reemplazan el elemento en
 *   su misma posición (`.map`, nunca remove+push), y la Property modificada
 *   se construye con `{ ...propiedad, requerida: true }` — en JS,
 *   sobreescribir el VALOR de una clave que el objeto YA tenía no cambia su
 *   posición de inserción, así que el orden interno de claves de esa
 *   Property tampoco se mueve.
 *
 * Por lo tanto, un ciclo leer → no tocar nada → volver a escribir bajo estas
 * operaciones no genera ningún diff espurio de git. Lo que sigue sin
 * resolver (y queda fuera de alcance de T-0019 a propósito, no se ignora en
 * silencio): un `Property`/`View` construido a mano con las claves en otro
 * orden — por ejemplo, JSON que llegue de un cliente externo en un futuro
 * ticket de CLI/MCP (T-0013/T-0014) — conserva el orden con el que llegó,
 * igual que ya pasa hoy con cualquier escritura de este motor. Cerrar ese
 * caso general (canonicalizar de verdad el orden de claves de cualquier
 * Property/View sin importar cómo se construyó) es trabajo de un
 * serializador más estricto en `../formato/database-row.ts`, no de esta
 * capa de CRUD; se deja para cuando haya una fuente real de ese problema, no
 * antes ("sin abstracciones que nadie pidió").
 */

import { ConflictoDeEscritura, escribirDatabase } from "../almacenamiento/escritura.ts";
import { resolverPathConfinado } from "../almacenamiento/confinamiento.ts";
import { hashDeArchivo, hashesIguales, type HashDeContenido } from "../almacenamiento/hash.ts";
import { leerDatabase as leerDatabaseAlmacenamiento, type ResultadoLectura } from "../almacenamiento/lectura.ts";
import { listarFilasCrudasDeDatabase } from "../indice/construccion.ts";
import { validarFormaDePropiedades } from "../invariantes.ts";
import type { Database, Property, View } from "../types.ts";
import {
  CambiosDatabaseInvalidos,
  LIMITE_ROWS_FALTANTES_REPORTADAS,
  PromocionFallida,
  PropertyIdDuplicado,
  PropertyNoEncontrada,
  PropertyRequeridaRechazada,
  PropiedadesInvalidas,
  type RowFaltante,
} from "./errores.ts";
import { crearConIdReintentando, pathDeDatabase } from "./ids.ts";
import type { NodoEscrito } from "./tipos.ts";

export interface CrearDatabaseInput {
  titulo: string;
  cuerpo?: string;
  parentId: string | null;
  propiedades?: Property[];
  vistas?: View[];
}

export async function crearDatabase(raizWorkspace: string, input: CrearDatabaseInput): Promise<NodoEscrito<Database>> {
  const propiedades = input.propiedades ?? [];
  // Guarda de forma ANTES de reservar un id o escribir nada (ver comentario
  // de cabecera de `validarFormaDePropiedades` en `../invariantes.ts`): un
  // llamador TypeScript ya tipado siempre pasa esto, pero nada impide que
  // `input.propiedades` venga de `JSON.parse(...) as Property[]` (un flag de
  // CLI/una llamada de MCP) con forma incorrecta aunque el JSON en sí sea
  // sintácticamente válido.
  const erroresDeForma = validarFormaDePropiedades(propiedades);
  if (erroresDeForma.length > 0) throw new PropiedadesInvalidas(erroresDeForma);

  return crearConIdReintentando(async (id) => {
    const ahora = new Date().toISOString();
    const database: Database = {
      id,
      tipo: "pagina",
      parentId: input.parentId,
      titulo: input.titulo,
      ...(input.cuerpo !== undefined ? { cuerpo: input.cuerpo } : {}),
      propiedades,
      vistas: input.vistas ?? [],
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    const resultado = await escribirDatabase(raizWorkspace, pathDeDatabase(id), database, null);
    return { valor: database, hash: resultado.hash };
  });
}

export function leerDatabase(raizWorkspace: string, id: string): Promise<ResultadoLectura<Database>> {
  return leerDatabaseAlmacenamiento(raizWorkspace, pathDeDatabase(id));
}

export type CambiosDatabase = Partial<Pick<Database, "titulo" | "cuerpo" | "parentId">>;

/** Claves de esquema que `actualizarDatabase` rechaza en runtime aunque `CambiosDatabase` ya las excluya a nivel de tipo — ver `CambiosDatabaseInvalidos`. */
const CLAVES_DE_ESQUEMA_PROHIBIDAS_EN_CAMBIOS = ["propiedades", "vistas"] as const;

/**
 * Actualización genérica de campos que no son el esquema (`titulo`/`cuerpo`/
 * `parentId`) — mismo contrato de CAS que `../crud/page.ts:actualizarPage`.
 *
 * Rechaza en runtime (`CambiosDatabaseInvalidos`), sin escribir nada, si
 * `cambios` trae `propiedades` o `vistas`: el tipo `CambiosDatabase` ya las
 * excluye a nivel de compilación, pero un llamador que caste (`as any`) o que
 * construya `cambios` a partir de JSON externo (un futuro CLI/MCP, T-0013/
 * T-0014) podría, si no fuera por este chequeo, colar cualquier esquema sin
 * pasar por `agregarProperty`/`promoverPropertyARequerida`/`quitarProperty`
 * (ADR-006) ni por `agregarVista`/`actualizarVista`/`quitarVista`
 * (validación de `filtros`/`orden`) — la única disciplina que este ticket
 * existe para imponer.
 */
export async function actualizarDatabase(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  cambios: CambiosDatabase,
): Promise<NodoEscrito<Database>> {
  const clavesProhibidas = CLAVES_DE_ESQUEMA_PROHIBIDAS_EN_CAMBIOS.filter((clave) => clave in cambios);
  if (clavesProhibidas.length > 0) {
    throw new CambiosDatabaseInvalidos(databaseActual.id, [...clavesProhibidas]);
  }

  const actualizada: Database = { ...databaseActual, ...cambios, actualizadoEn: new Date().toISOString() };
  const resultado = await escribirDatabase(raizWorkspace, pathDeDatabase(databaseActual.id), actualizada, hashEsperado);
  return { valor: actualizada, hash: resultado.hash };
}

async function escribirEsquemaActualizado(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  propiedades: Property[],
): Promise<NodoEscrito<Database>> {
  const actualizada: Database = { ...databaseActual, propiedades, actualizadoEn: new Date().toISOString() };
  const resultado = await escribirDatabase(raizWorkspace, pathDeDatabase(databaseActual.id), actualizada, hashEsperado);
  return { valor: actualizada, hash: resultado.hash };
}

/**
 * Cantidad de Rows cuyo `parentId` es `databaseId`, escaneadas crudas
 * (`listarFilasCrudasDeDatabase`, ver comentario de cabecera de este módulo
 * y el de esa función): a propósito, NO vía `construirIndice` — este conteo
 * es sobre las Rows tal como existen en disco, no sobre las que hoy pasan la
 * validación completa de esquema (que puede excluir una Row real por una
 * razón sin relación con lo que se está agregando).
 */
async function contarRowsDeDatabase(raizWorkspace: string, databaseId: string): Promise<number> {
  const filas = await listarFilasCrudasDeDatabase(raizWorkspace, databaseId);
  return filas.length;
}

/**
 * Rows de `databaseId`, escaneadas crudas (`listarFilasCrudasDeDatabase`,
 * mismo motivo que `contarRowsDeDatabase`), sin ningún `PropertyValue` para
 * `propertyId`, ordenadas por id para un reporte reproducible.
 */
async function rowsSinValorPara(
  raizWorkspace: string,
  databaseId: string,
  propertyId: string,
): Promise<{ faltantes: RowFaltante[]; total: number }> {
  const filas = await listarFilasCrudasDeDatabase(raizWorkspace, databaseId);
  const faltantes: RowFaltante[] = [];
  for (const nodo of filas) {
    const tieneValor = nodo.valor.valores.some((valor) => valor.propertyId === propertyId);
    if (!tieneValor) faltantes.push({ id: nodo.valor.id, path: nodo.path });
  }
  faltantes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { faltantes, total: faltantes.length };
}

// ---------------------------------------------------------------------------
// Migración de esquema (ADR-006)
// ---------------------------------------------------------------------------

/**
 * ADR-006 sección 1. Si `propertyNueva.requerida` es `true` y la Database ya
 * tiene al menos una Row, se rechaza (`PropertyRequeridaRechazada`) sin
 * escribir nada — el camino correcto es agregar como no-requerida y después
 * usar `promoverPropertyARequerida` una vez que cada Row tenga su valor
 * real. Si la Database no tiene ninguna Row, o si `propertyNueva.requerida`
 * es `false` (o está ausente), se agrega sin condición.
 */
export async function agregarProperty(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  propertyNueva: Property,
): Promise<NodoEscrito<Database>> {
  if (databaseActual.propiedades.some((propiedad) => propiedad.id === propertyNueva.id)) {
    throw new PropertyIdDuplicado(databaseActual.id, propertyNueva.id);
  }

  if (propertyNueva.requerida) {
    const cantidadRows = await contarRowsDeDatabase(raizWorkspace, databaseActual.id);
    if (cantidadRows > 0) {
      throw new PropertyRequeridaRechazada(databaseActual.id, propertyNueva.nombre, cantidadRows);
    }
  }

  return escribirEsquemaActualizado(raizWorkspace, databaseActual, hashEsperado, [
    ...databaseActual.propiedades,
    propertyNueva,
  ]);
}

/**
 * ADR-006 sección 2. Reconstruye el índice fresco y verifica que TODAS las
 * Rows de `databaseActual` ya tengan un `PropertyValue` para `propertyId`.
 * Si falta en alguna, falla con `PromocionFallida` (lista acotada de Rows
 * faltantes más el total) sin tocar el archivo de la Database — el esquema
 * queda exactamente como estaba. Si todas la tienen, escribe
 * `requerida: true` para esa Property vía el CAS normal de ADR-001 (el
 * `hashEsperado` que recibe esta función).
 *
 * Si la Property ya era `requerida: true`, es un no-op: no hay nada que
 * escribir (todas las Rows válidas ya la tienen, por la invariante 2). Pero
 * "no hay nada que escribir" no significa "no hay nada que chequear": este
 * camino todavía tiene que respetar el mismo contrato de CAS que cualquier
 * otra operación de este módulo (ADR-001 punto 2) — releemos el hash actual
 * del archivo y lo comparamos contra `hashEsperado` antes de devolver nada,
 * lanzando `ConflictoDeEscritura` si no coinciden. Sin este chequeo, un
 * llamador con una vista vieja de la Database (por ejemplo, otro agente
 * cambió el `titulo` mientras este todavía tenía en memoria el hash de
 * antes) recibiría de vuelta `databaseActual`/`hashEsperado` tal cual los
 * pasó — datos potencialmente stale, sin ningún aviso de que el archivo real
 * cambió — exactamente la sobrescritura-silenciosa-de-facto que ADR-001
 * busca evitar, aunque acá no haya ninguna escritura real de por medio. Si
 * coinciden, no hay ninguna escritura que hacer: se devuelve `databaseActual`
 * sin tocar el archivo (a diferencia de dejar pasar esto por
 * `escribirEsquemaActualizado` con la misma `propiedad`, que sí escribiría —
 * y cambiaría `actualizadoEn` — para un cambio de esquema que en los hechos
 * no cambia nada).
 */
export async function promoverPropertyARequerida(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  propertyId: string,
): Promise<NodoEscrito<Database>> {
  const propiedad = databaseActual.propiedades.find((p) => p.id === propertyId);
  if (!propiedad) throw new PropertyNoEncontrada(databaseActual.id, propertyId);

  if (propiedad.requerida) {
    const pathAbsoluto = await resolverPathConfinado(raizWorkspace, pathDeDatabase(databaseActual.id));
    const hashActual = await hashDeArchivo(pathAbsoluto);
    if (!hashesIguales(hashActual, hashEsperado)) {
      throw new ConflictoDeEscritura(pathAbsoluto);
    }
    return { valor: databaseActual, hash: hashEsperado };
  }

  const { faltantes, total } = await rowsSinValorPara(raizWorkspace, databaseActual.id, propertyId);
  if (total > 0) {
    throw new PromocionFallida(
      databaseActual.id,
      propertyId,
      faltantes.slice(0, LIMITE_ROWS_FALTANTES_REPORTADAS),
      total,
    );
  }

  const propiedades = databaseActual.propiedades.map((p) => (p.id === propertyId ? { ...p, requerida: true } : p));
  return escribirEsquemaActualizado(raizWorkspace, databaseActual, hashEsperado, propiedades);
}

/**
 * ADR-006 sección 3. Nunca falla por el estado de las Rows: quita la
 * Property del esquema vía el CAS normal de ADR-001. Los `PropertyValue`
 * huérfanos que queden en las Rows existentes (y cualquier referencia
 * huérfana en `filtros`/`orden`/`columnasVisibles` de una View de esta
 * Database) no se tocan — quedan en sus archivos tal cual, ya excluidos de
 * validación/índice por `../invariantes.ts`/`../indice/*.ts`, hasta una
 * futura operación explícita de limpieza (fuera de alcance de este ticket).
 */
export async function quitarProperty(
  raizWorkspace: string,
  databaseActual: Database,
  hashEsperado: HashDeContenido,
  propertyId: string,
): Promise<NodoEscrito<Database>> {
  if (!databaseActual.propiedades.some((propiedad) => propiedad.id === propertyId)) {
    throw new PropertyNoEncontrada(databaseActual.id, propertyId);
  }

  return escribirEsquemaActualizado(
    raizWorkspace,
    databaseActual,
    hashEsperado,
    databaseActual.propiedades.filter((propiedad) => propiedad.id !== propertyId),
  );
}
