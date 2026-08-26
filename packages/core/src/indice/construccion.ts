/**
 * Construcción del índice completo de un workspace (T-0018, puntos 1 y 2
 * del alcance): recorre el árbol (`./escaneo.ts`), lee/parsea/valida cada
 * archivo individual reusando el motor de T-0017
 * (`../almacenamiento/lectura.ts`, que a su vez reusa los parsers de
 * T-0015/T-0016), y aplica los puntos 5/6/7/9 del checklist de ADR-002
 * sección 5 — los que necesitan ver el árbol completo, no un archivo
 * aislado (1/2/3/4/8 ya los aplicó T-0017 archivo por archivo).
 *
 * ## Por qué una Row necesita una segunda pasada (y Page/Database no)
 *
 * `leerRow` de T-0017 exige que quien la llama ya le pase el esquema de la
 * Database padre resuelto (así lo documenta ese módulo explícitamente: "no
 * lo resuelve leyendo del disco recursivamente, eso mezclaría este archivo
 * con el índice de T-0018"). Pero para saber *cuál* es la Database padre de
 * una Row hace falta primero leer el `parent_id` de esa misma Row — y para
 * saber si ese `parent_id` resuelve a una Database *válida* (no una que a
 * su vez se excluyó por duplicado de id, ciclo, o parent_id colgante) hace
 * falta haber terminado de procesar *todas* las Database del árbol primero.
 * Por eso este módulo separa el trabajo de una Row en dos pasos:
 *
 * 1. **Parseo estructural puro** (`clasificarJson`, sin esquema): usa
 *    `parsearRow` de `../formato/database-row.ts` directamente — el mismo
 *    parser que usa `leerRow` internamente, no una reimplementación — más
 *    el mismo chequeo de id-vs-filename que `leerRow` aplica (replicado acá
 *    en una función chica porque esa función privada de `lectura.ts` no
 *    está exportada; es plumbing de una línea, no una reimplementación del
 *    parser ni de ninguna validación de dominio).
 * 2. **Validación de esquema** (`validarRow`, reusada de
 *    `../invariantes.ts`, sin reimplementar), una vez que `databasesFinal`
 *    ya está resuelto más abajo en este mismo módulo.
 *
 * Page y Database no tienen este problema: `leerPage`/`leerDatabase` no
 * necesitan ningún otro nodo del árbol para completar su validación (su
 * "esquema" es fijo, no depende de un padre), así que se leen en una sola
 * pasada con el motor de T-0017 tal cual.
 *
 * ## Cómo se decide, para un archivo `.json`, si es una Database o una Row
 *
 * ADR-002 sección 3 fija que ambas usan JSON con una clave `tipo`:
 * `"pagina"` para Database (hereda el valor de Page, ver
 * `docs/01-modelo-dominio.md`), `"fila"` para Row. `clasificarJson` mira
 * esa clave en un `JSON.parse` propio antes de decidir a cuál de los dos
 * parsers/lectores despachar — sin este paso, invocar el parser
 * equivocado (por ejemplo `parsearDatabase` sobre lo que en realidad es una
 * Row) produciría errores de "falta la clave propiedades"/"clave
 * inesperada valores" que describirían mal el problema real.
 */

import { basename } from "node:path";
import {
  esErrorDeLectura,
  leerDatabase,
  leerPage,
  NodoNoEncontrado,
} from "../almacenamiento/lectura.ts";
import { idDesdeNombreArchivo, resolverPathConfinado } from "../almacenamiento/confinamiento.ts";
import { leerBytesCrudosConHash } from "../almacenamiento/hash.ts";
import { parsearRow } from "../formato/database-row.ts";
import {
  tieneErroresFatales,
  validarArbolContencion,
  validarIdsUnicos,
  validarRow,
  type ErrorValidacion,
} from "../invariantes.ts";
import type { Database, Page, Row } from "../types.ts";
import { listarCandidatos } from "./escaneo.ts";
import { crearBaseIndice, poblarBaseIndice } from "./sqlite.ts";
import type { Diagnostico, Indice, NodoIndexado } from "./tipos.ts";

// ---------------------------------------------------------------------------
// Helpers de error (reusan los códigos de invariantes.ts, no inventan lógica de validación nueva)
// ---------------------------------------------------------------------------

function errorEstructuraInvalida(mensaje: string): ErrorValidacion {
  return { codigo: "ESTRUCTURA_INVALIDA", mensaje, severidad: "error" };
}

/** Mismo chequeo que la función privada homónima de `../almacenamiento/lectura.ts` (no exportada) — ver comentario de cabecera. */
function errorIdNoCoincide(idContenido: string, idArchivo: string): ErrorValidacion {
  return {
    codigo: "ID_NO_COINCIDE_CON_ARCHIVO",
    mensaje: `el id declarado en el contenido ("${idContenido}") no coincide con el id derivado del nombre de archivo ("${idArchivo}")`,
    severidad: "error",
    nodoId: idArchivo,
  };
}

// ---------------------------------------------------------------------------
// Clasificación de un archivo .json en Database | Row | inválido
// ---------------------------------------------------------------------------

type ResultadoClasificacionJson =
  | { tipo: "database"; resultado: Awaited<ReturnType<typeof leerDatabase>> }
  | { tipo: "fila"; row: Row }
  | { tipo: "invalido"; errores: ErrorValidacion[] };

async function clasificarJson(raizWorkspace: string, pathRelativo: string): Promise<ResultadoClasificacionJson> {
  const pathAbsoluto = await resolverPathConfinado(raizWorkspace, pathRelativo);
  const idArchivo = idDesdeNombreArchivo(basename(pathAbsoluto));

  const leido = await leerBytesCrudosConHash(pathAbsoluto);
  if (leido === null) {
    // El archivo desapareció entre el recorrido (./escaneo.ts) y esta
    // lectura: carrera benigna, no un archivo roto. Se ignora en silencio,
    // igual que un archivo que nunca fue candidato — ver `construirIndice`.
    return { tipo: "invalido", errores: [] };
  }
  const contenido = new TextDecoder().decode(leido.bytes);

  let bruto: unknown;
  try {
    bruto = JSON.parse(contenido);
  } catch (error) {
    return {
      tipo: "invalido",
      errores: [
        errorEstructuraInvalida(
          `"${pathRelativo}": el contenido no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }

  const tipoDeclarado =
    typeof bruto === "object" && bruto !== null && !Array.isArray(bruto)
      ? (bruto as Record<string, unknown>).tipo
      : undefined;

  if (tipoDeclarado === "pagina") {
    // Database (ADR-002: en el archivo, tanto Page como Database escriben
    // literalmente "pagina" — ver docs/01-modelo-dominio.md). Se reusa
    // `leerDatabase` completo (re-lee y re-parsea; el doble I/O es
    // aceptable a esta escala, ver ADR-001) en vez de invocar
    // `parsearDatabase` a mano acá — así este módulo no duplica el chequeo
    // de id-vs-filename ni ninguna otra validación que `leerDatabase` ya
    // hace.
    const resultado = await leerDatabase(raizWorkspace, pathRelativo);
    return { tipo: "database", resultado };
  }

  if (tipoDeclarado === "fila") {
    const resultadoRow = parsearRow(contenido);
    if (Array.isArray(resultadoRow)) return { tipo: "invalido", errores: resultadoRow };
    if (resultadoRow.id !== idArchivo) return { tipo: "invalido", errores: [errorIdNoCoincide(resultadoRow.id, idArchivo)] };
    return { tipo: "fila", row: resultadoRow };
  }

  return {
    tipo: "invalido",
    errores: [
      errorEstructuraInvalida(
        `"${pathRelativo}": no se pudo determinar si es una Database o una Row — el campo "tipo" debe ser "pagina" o "fila", se encontró ${JSON.stringify(tipoDeclarado)}`,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// Punto 6: resolución (en cascada) de parent_id para Page + Database
// ---------------------------------------------------------------------------

/**
 * Dado el grafo de `parentId` de los nodos Page/Database que sobrevivieron
 * a la unicidad de id y a la detección de ciclos, decide para cada uno si
 * su cadena completa de ancestros termina en `null` sin ningún salto
 * colgante. Un nodo cuyo padre directo no está en `parentPorId` (porque
 * nunca existió, o porque se excluyó por duplicado/ciclo/orfandad) es
 * inválido — y esa invalidez se propaga hacia sus propios hijos, no solo
 * hacia el nodo directo: si B es hijo de A y A resultó inválido, B también
 * lo es, aunque el `parent_id` de B en sí mismo (A) exista como id.
 *
 * Es seguro asumir que este grafo, restringido a los ids que quedan como
 * clave de `parentPorId`, ya es acíclico: cualquier ciclo real entre esos
 * nodos ya lo habría detectado `validarArbolContencion` antes de llegar
 * acá (ver `construirIndice`), y quitar nodos de un grafo no puede crear un
 * ciclo nuevo entre los que quedan. La guarda de pila de abajo es
 * puramente defensiva (no debería activarse nunca).
 */
function resolverValidezDeContencion(parentPorId: Map<string, string | null>): Map<string, boolean> {
  const memo = new Map<string, boolean>();

  function resolver(id: string, pila: Set<string>): boolean {
    const memorizado = memo.get(id);
    if (memorizado !== undefined) return memorizado;
    if (pila.has(id)) return false; // defensivo — ver comentario de la función

    const parentId = parentPorId.get(id) as string | null; // `id` siempre es una clave presente acá
    let resultado: boolean;
    if (parentId === null) {
      resultado = true;
    } else if (!parentPorId.has(parentId)) {
      resultado = false; // parent_id colgante o hacia un nodo ya excluido
    } else {
      pila.add(id);
      resultado = resolver(parentId, pila);
      pila.delete(id);
    }
    memo.set(id, resultado);
    return resultado;
  }

  const salida = new Map<string, boolean>();
  for (const id of parentPorId.keys()) salida.set(id, resolver(id, new Set()));
  return salida;
}

// ---------------------------------------------------------------------------
// Construcción principal
// ---------------------------------------------------------------------------

interface Bruto<T> {
  id: string;
  tipoNodo: "pagina" | "database" | "fila";
  valor: T;
  path: string;
}

/**
 * Construye el índice completo de `raizWorkspace`: recorre el árbol,
 * lee/valida cada archivo, aplica unicidad de id / resolución de parent_id
 * / detección de ciclos sobre el árbol completo, y puebla una base
 * `bun:sqlite` en memoria con el resultado. Nunca lanza por un archivo
 * puntual roto (ADR-002 sección 5 punto 9): cada fallo se excluye y se
 * agrega a `diagnosticos`.
 */
export async function construirIndice(raizWorkspace: string): Promise<Indice> {
  const candidatos = await listarCandidatos(raizWorkspace);

  const brutos: Bruto<Page | Database | Row>[] = [];
  const diagnosticos: Diagnostico[] = [];

  function reportar(error: ErrorValidacion, ...paths: string[]): void {
    diagnosticos.push({ error, paths });
  }

  for (const candidato of candidatos) {
    try {
      if (candidato.extension === "md") {
        const resultado = await leerPage(raizWorkspace, candidato.pathRelativo);
        if (esErrorDeLectura(resultado)) {
          for (const error of resultado) reportar(error, candidato.pathRelativo);
          continue;
        }
        brutos.push({ id: resultado.valor.id, tipoNodo: "pagina", valor: resultado.valor, path: candidato.pathRelativo });
        continue;
      }

      const clasificado = await clasificarJson(raizWorkspace, candidato.pathRelativo);
      if (clasificado.tipo === "invalido") {
        for (const error of clasificado.errores) reportar(error, candidato.pathRelativo);
        continue;
      }
      if (clasificado.tipo === "database") {
        if (esErrorDeLectura(clasificado.resultado)) {
          for (const error of clasificado.resultado) reportar(error, candidato.pathRelativo);
          continue;
        }
        brutos.push({
          id: clasificado.resultado.valor.id,
          tipoNodo: "database",
          valor: clasificado.resultado.valor,
          path: candidato.pathRelativo,
        });
        continue;
      }
      brutos.push({ id: clasificado.row.id, tipoNodo: "fila", valor: clasificado.row, path: candidato.pathRelativo });
    } catch (error) {
      if (error instanceof NodoNoEncontrado) continue; // carrera benigna — el archivo desapareció entre el recorrido y la lectura
      reportar(
        {
          codigo: "ERROR_DE_LECTURA",
          severidad: "error",
          mensaje: `error inesperado leyendo "${candidato.pathRelativo}": ${error instanceof Error ? error.message : String(error)}`,
        },
        candidato.pathRelativo,
      );
    }
  }

  // --- Punto 5: unicidad global de id, entre TODOS los tipos de nodo ---
  const pathsPorId = new Map<string, string[]>();
  for (const bruto of brutos) pathsPorId.set(bruto.id, [...(pathsPorId.get(bruto.id) ?? []), bruto.path]);

  const erroresDuplicados = validarIdsUnicos(brutos.map((bruto) => ({ id: bruto.id })));
  const idsDuplicados = new Set(erroresDuplicados.map((error) => error.nodoId!));
  for (const error of erroresDuplicados) reportar(error, ...(pathsPorId.get(error.nodoId!) ?? []));

  const brutosSinDuplicados = brutos.filter((bruto) => !idsDuplicados.has(bruto.id));
  const paginasBrutas = new Map(
    brutosSinDuplicados.filter((bruto) => bruto.tipoNodo === "pagina").map((bruto) => [bruto.id, bruto as Bruto<Page>]),
  );
  const databasesBrutas = new Map(
    brutosSinDuplicados
      .filter((bruto) => bruto.tipoNodo === "database")
      .map((bruto) => [bruto.id, bruto as Bruto<Database>]),
  );
  const filasBrutas = new Map(
    brutosSinDuplicados.filter((bruto) => bruto.tipoNodo === "fila").map((bruto) => [bruto.id, bruto as Bruto<Row>]),
  );

  // --- Punto 7: ciclos en el grafo de contención (Page + Database únicamente) ---
  // Una Row nunca puede participar de un ciclo: ningún tipo de nodo puede
  // tener una Row como parent_id (Page/Database resuelven a Page-o-Database,
  // Row resuelve a Database), así que incluirla no cambiaría el resultado —
  // se omite por simplicidad, no por corrección.
  const nodosNoFila = [...paginasBrutas.values(), ...databasesBrutas.values()].map((bruto) => ({
    id: bruto.id,
    parentId: bruto.valor.parentId,
  }));
  const erroresCiclo = validarArbolContencion(nodosNoFila);
  const idsEnCiclo = new Set(erroresCiclo.map((error) => error.nodoId!));
  for (const error of erroresCiclo) {
    const path = (paginasBrutas.get(error.nodoId!) ?? databasesBrutas.get(error.nodoId!))?.path;
    reportar(error, ...(path ? [path] : []));
  }

  // --- Punto 6: resolución en cascada de parent_id (Page + Database) ---
  const parentPorId = new Map<string, string | null>();
  for (const [id, bruto] of paginasBrutas) if (!idsEnCiclo.has(id)) parentPorId.set(id, bruto.valor.parentId);
  for (const [id, bruto] of databasesBrutas) if (!idsEnCiclo.has(id)) parentPorId.set(id, bruto.valor.parentId);

  const validez = resolverValidezDeContencion(parentPorId);
  for (const [id, esValido] of validez) {
    if (esValido) continue;
    const bruto = paginasBrutas.get(id) ?? databasesBrutas.get(id);
    reportar(
      {
        codigo: "PARENT_ID_INVALIDO",
        severidad: "error",
        mensaje: `el nodo "${id}" tiene parent_id "${parentPorId.get(id)}" que no resuelve a un nodo Page/Database válido del árbol — queda excluido del índice`,
        nodoId: id,
      },
      ...(bruto ? [bruto.path] : []),
    );
  }

  const paginasFinal = new Map<string, NodoIndexado<Page>>();
  for (const [id, bruto] of paginasBrutas) {
    if (idsEnCiclo.has(id) || validez.get(id) === false) continue;
    paginasFinal.set(id, { valor: bruto.valor, path: bruto.path });
  }
  const databasesFinal = new Map<string, NodoIndexado<Database>>();
  for (const [id, bruto] of databasesBrutas) {
    if (idsEnCiclo.has(id) || validez.get(id) === false) continue;
    databasesFinal.set(id, { valor: bruto.valor, path: bruto.path });
  }

  // --- Filas: parent_id debe resolver a una Database válida (punto 6) + esquema (punto 8, validarRow reusado) ---
  const filasFinal = new Map<string, NodoIndexado<Row>>();
  for (const [id, bruto] of filasBrutas) {
    const database = databasesFinal.get(bruto.valor.parentId);
    if (!database) {
      reportar(
        {
          codigo: "PARENT_ID_INVALIDO",
          severidad: "error",
          mensaje: `la Row "${id}" tiene parent_id "${bruto.valor.parentId}" que no resuelve a una Database válida del árbol — queda excluida del índice`,
          nodoId: id,
          rowId: id,
        },
        bruto.path,
      );
      continue;
    }

    const erroresEsquema = validarRow(database.valor, bruto.valor);
    if (tieneErroresFatales(erroresEsquema)) {
      for (const error of erroresEsquema) reportar(error, bruto.path);
      continue;
    }
    for (const advertencia of erroresEsquema) reportar(advertencia, bruto.path);
    filasFinal.set(id, { valor: bruto.valor, path: bruto.path });
  }

  const sqlite = crearBaseIndice();
  poblarBaseIndice(sqlite, { paginas: paginasFinal, databases: databasesFinal, filas: filasFinal });

  return { raiz: raizWorkspace, sqlite, paginas: paginasFinal, databases: databasesFinal, filas: filasFinal, diagnosticos };
}
