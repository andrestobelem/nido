#!/usr/bin/env bun
/**
 * CLI de nido (T-0013): parseo de argv por comando, formato humano vs.
 * `--json`, código de salida de proceso — exactamente lo que ADR-005
 * sección 3 dice que NO vive en `packages/core` (parsing de argv, formato de
 * salida, exit codes). Cada comando llama directo a una función de
 * `@nido/core` (ADR-005 sección 1: nunca se envuelve un subproceso de esta
 * misma CLI).
 *
 * El parser de argv replica el patrón de `packages/tickets/src/cli.ts`
 * (schema-driven por comando): un flag declarado como `string` SIEMPRE
 * consume el siguiente token como su valor, sin importar si empieza con
 * "--"; un flag no declarado es un error de uso, nunca un no-op silencioso.
 * No se comparte código con `packages/tickets` — son CLIs independientes,
 * el patrón se replica, no se importa.
 *
 * ## Un comando más que el mínimo del ticket, y por qué
 *
 * El alcance de T-0013 lista siete comandos mínimos, ninguno de los cuales
 * es una actualización. Se agrega `page update` igual: ADR-005 sección 2 ya
 * lista "actualizar" entre las operaciones de Page que el core expone, así
 * que exponerla por CLI no es una extensión fuera de alcance. De paso (no
 * como requisito del criterio de éxito — `docs/00-entendimiento.md` y el
 * alcance de T-0013 en `docs/sprints/08-planning.md` no piden este caso
 * puntual, y `docs/03-plan.md` es explícito en que la concurrencia entre
 * agentes "se prueba, pero no es el caso central del MVP") permite un caso
 * de test honesto de `ConflictoDeEscritura` real: con solo creación+lectura
 * no hay ningún archivo que dos procesos puedan disputarse de verdad (crear
 * siempre reserva un id nuevo, UUIDv4, `../../core/src/crud/ids.ts`, y nunca
 * reescribe un archivo existente), pero `page get` devuelve el `hash` de lo
 * leído, y `page update <id> --hash <hash> ...` solo tiene éxito si ese hash
 * todavía coincide con el archivo en disco — el mismo contrato de CAS que
 * `actualizarPage` ya expone a cualquier llamador en proceso, ahora ejercido
 * por dos procesos CLI reales en carrera.
 */

import type { HashDeContenido } from "@nido/core/src/almacenamiento/hash.ts";
import { esErrorDeLectura } from "@nido/core/src/almacenamiento/lectura.ts";
import { actualizarPage, crearPage, leerPage, type CambiosPage } from "@nido/core/src/crud/page.ts";
import { crearDatabase, leerDatabase } from "@nido/core/src/crud/database.ts";
import { DatabaseNoIndexada } from "@nido/core/src/crud/errores.ts";
import { crearRow } from "@nido/core/src/crud/row.ts";
import { resolverVistaDeDatabase } from "@nido/core/src/crud/vistas.ts";
import { construirIndice } from "@nido/core/src/indice/construccion.ts";
import { esErrorDeConsulta, resolverConsulta, type ConsultaVista, type ResultadoConsulta } from "@nido/core/src/indice/vistas.ts";
import type { ErrorValidacion } from "@nido/core/src/invariantes.ts";
import type { Database, Grupo, OrdenCampo, Page, Property, PropertyValue, Row } from "@nido/core/src/types.ts";
import { formatearDatabase, formatearPage, formatearResultadoConsulta, formatearRow } from "./format.ts";
import { hashDesdeTexto, stringificarJson } from "./json.ts";
import { asegurarWorkspace, raizWorkspace } from "./workspace.ts";

export class ErrorDeUso extends Error {}

/** El id pedido por `row get`/`view query --db` no aparece en el índice del workspace — no existe, o quedó excluido por un diagnóstico de validación. Mismo espíritu que `DatabaseNoIndexada` (`../../core/src/crud/errores.ts`), pero para Row: el core no expone "obtener Row sin conocer su Database" como operación propia (`leerRow` exige el esquema resuelto — ver comentario de cabecera de `../../core/src/crud/row.ts`), así que esta clase es plumbing de esta superficie, no una reimplementación de una regla de dominio. */
export class RowNoIndexada extends Error {
  constructor(rowId: string) {
    super(`la Row "${rowId}" no está en el índice del workspace — no existe, o fue excluida por un error de validación`);
  }
}

/** Envuelve una lista de `ErrorValidacion` (lo que devuelven, en vez de lanzar, `leerPage`/`leerDatabase`/`resolverConsulta`/`resolverVista` cuando el contenido no valida) en una excepción, para que `main` tenga un solo punto de manejo de errores. */
export class ErrorDeDominio extends Error {
  readonly errores: ErrorValidacion[];
  constructor(errores: ErrorValidacion[]) {
    super(errores.map((error) => `[${error.severidad}] ${error.mensaje}`).join("; "));
    this.errores = errores;
  }
}

// ---------------------------------------------------------------------------
// Parseo de argv (mismo patrón que packages/tickets/src/cli.ts)
// ---------------------------------------------------------------------------

interface EspecificacionFlags {
  string?: string[];
}

interface ArgsParsed {
  positional: string[];
  flags: Record<string, string | true>;
}

const ESPECS: Record<string, EspecificacionFlags> = {
  "page create": { string: ["titulo", "parent", "cuerpo"] },
  "page get": {},
  "page update": { string: ["hash", "titulo", "cuerpo", "parent"] },
  "db create": { string: ["titulo", "parent", "propiedades"] },
  "db get": {},
  "row create": { string: ["db", "valores", "titulo"] },
  "row get": {},
  "view query": { string: ["db", "filtros", "orden", "vista"] },
};

/**
 * Un flag declarado como string SIEMPRE consume el siguiente token como su
 * valor, sin importar si ese token empieza con "--" (así "--titulo --json"
 * no puede interpretar "--json" como un flag booleano y perder el valor
 * real de --titulo). Cualquier flag no declarado (ni string ni "json",
 * global e implícito) es un error de uso, no un no-op silencioso.
 */
function parseArgs(args: string[], spec: EspecificacionFlags): ArgsParsed {
  const flagsString = new Set(spec.string ?? []);
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const sinPrefijo = arg.slice(2);
    const igualdad = sinPrefijo.indexOf("=");
    const nombre = igualdad === -1 ? sinPrefijo : sinPrefijo.slice(0, igualdad);
    const valorInline = igualdad === -1 ? undefined : sinPrefijo.slice(igualdad + 1);

    if (!flagsString.has(nombre)) {
      if (nombre !== "json") throw new ErrorDeUso(`flag desconocido: --${nombre}`);
      if (valorInline !== undefined) throw new ErrorDeUso("--json no acepta un valor");
      flags[nombre] = true;
      continue;
    }
    if (valorInline !== undefined) {
      flags[nombre] = valorInline;
      continue;
    }
    const siguiente = args[i + 1];
    if (siguiente === undefined) throw new ErrorDeUso(`falta el valor de --${nombre}`);
    flags[nombre] = siguiente;
    i++;
  }
  return { positional, flags };
}

function flagTexto(parsed: ArgsParsed, nombre: string): string | undefined {
  const valor = parsed.flags[nombre];
  return typeof valor === "string" ? valor : undefined;
}

function requerirPositional(parsed: ArgsParsed, indice: number, usoEsperado: string): string {
  const valor = parsed.positional[indice];
  if (!valor) throw new ErrorDeUso(usoEsperado);
  return valor;
}

function parsearJsonDeFlag<T>(texto: string, nombreFlag: string): T {
  try {
    return JSON.parse(texto) as T;
  } catch (error) {
    throw new ErrorDeUso(`${nombreFlag} no es JSON válido: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parsearHashFlag(texto: string): bigint {
  try {
    return hashDesdeTexto(texto);
  } catch (error) {
    throw new ErrorDeUso(error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------------------
// Despacho de comandos
// ---------------------------------------------------------------------------

type Resultado =
  | { tipo: "page"; page: Page; hash: HashDeContenido }
  | { tipo: "database"; database: Database }
  | { tipo: "row"; row: Row; advertencias: ErrorValidacion[] }
  | { tipo: "consulta"; consulta: ResultadoConsulta };

async function ejecutar(comando: string, parsed: ArgsParsed, raiz: string): Promise<Resultado> {
  switch (comando) {
    case "page create": {
      const titulo = flagTexto(parsed, "titulo");
      if (!titulo) throw new ErrorDeUso("falta --titulo");
      const parentId = flagTexto(parsed, "parent") ?? null;
      const cuerpo = flagTexto(parsed, "cuerpo") ?? "";
      const creada = await crearPage(raiz, { titulo, parentId, cuerpo });
      return { tipo: "page", page: creada.valor, hash: creada.hash };
    }

    case "page get": {
      const id = requerirPositional(parsed, 0, "uso: nido page get <id>");
      const leida = await leerPage(raiz, id);
      if (esErrorDeLectura(leida)) throw new ErrorDeDominio(leida);
      return { tipo: "page", page: leida.valor, hash: leida.hash };
    }

    case "page update": {
      const id = requerirPositional(
        parsed,
        0,
        'uso: nido page update <id> --hash <hash> [--titulo <t>] [--cuerpo <texto>] [--parent <id>]',
      );
      const hashTexto = flagTexto(parsed, "hash");
      if (!hashTexto) throw new ErrorDeUso('falta --hash (usá el que devolvió "page get"/"page create")');
      const hashEsperado = parsearHashFlag(hashTexto);

      const cambios: CambiosPage = {};
      const titulo = flagTexto(parsed, "titulo");
      if (titulo !== undefined) cambios.titulo = titulo;
      const cuerpo = flagTexto(parsed, "cuerpo");
      if (cuerpo !== undefined) cambios.cuerpo = cuerpo;
      const parentId = flagTexto(parsed, "parent");
      if (parentId !== undefined) cambios.parentId = parentId;

      const leida = await leerPage(raiz, id);
      if (esErrorDeLectura(leida)) throw new ErrorDeDominio(leida);
      const actualizada = await actualizarPage(raiz, leida.valor, hashEsperado, cambios);
      return { tipo: "page", page: actualizada.valor, hash: actualizada.hash };
    }

    case "db create": {
      const titulo = flagTexto(parsed, "titulo");
      if (!titulo) throw new ErrorDeUso("falta --titulo");
      const parentId = flagTexto(parsed, "parent") ?? null;
      const propiedadesTexto = flagTexto(parsed, "propiedades");
      if (propiedadesTexto === undefined) throw new ErrorDeUso("falta --propiedades");
      const propiedades = parsearJsonDeFlag<Property[]>(propiedadesTexto, "--propiedades");
      const creada = await crearDatabase(raiz, { titulo, parentId, propiedades });
      return { tipo: "database", database: creada.valor };
    }

    case "db get": {
      const id = requerirPositional(parsed, 0, "uso: nido db get <id>");
      const leida = await leerDatabase(raiz, id);
      if (esErrorDeLectura(leida)) throw new ErrorDeDominio(leida);
      return { tipo: "database", database: leida.valor };
    }

    case "row create": {
      const databaseId = flagTexto(parsed, "db");
      if (!databaseId) throw new ErrorDeUso("falta --db");
      const valoresTexto = flagTexto(parsed, "valores");
      if (valoresTexto === undefined) throw new ErrorDeUso("falta --valores");
      const valores = parsearJsonDeFlag<PropertyValue[]>(valoresTexto, "--valores");
      const titulo = flagTexto(parsed, "titulo") ?? "";

      const database = await leerDatabase(raiz, databaseId);
      if (esErrorDeLectura(database)) throw new ErrorDeDominio(database);
      const creada = await crearRow(raiz, database.valor, { titulo, valores });
      return { tipo: "row", row: creada.valor, advertencias: creada.advertencias };
    }

    case "row get": {
      const id = requerirPositional(parsed, 0, "uso: nido row get <id>");
      const indice = await construirIndice(raiz);
      try {
        const fila = indice.filas.get(id);
        if (!fila) throw new RowNoIndexada(id);
        const advertencias = indice.diagnosticos
          .filter((diagnostico) => diagnostico.error.rowId === id)
          .map((diagnostico) => diagnostico.error);
        return { tipo: "row", row: fila.valor, advertencias };
      } finally {
        indice.sqlite.close();
      }
    }

    case "view query": {
      const databaseId = flagTexto(parsed, "db");
      if (!databaseId) throw new ErrorDeUso("falta --db");
      const vistaId = flagTexto(parsed, "vista");
      const filtrosTexto = flagTexto(parsed, "filtros");
      const ordenTexto = flagTexto(parsed, "orden");

      if (vistaId !== undefined && (filtrosTexto !== undefined || ordenTexto !== undefined)) {
        throw new ErrorDeUso(
          "--vista no se puede combinar con --filtros/--orden: son mutuamente excluyentes en v1 (ADR-004 sección 3)",
        );
      }

      if (vistaId !== undefined) {
        const resultado = await resolverVistaDeDatabase(raiz, databaseId, vistaId);
        if (esErrorDeConsulta(resultado)) throw new ErrorDeDominio(resultado);
        return { tipo: "consulta", consulta: resultado };
      }

      const filtros = filtrosTexto !== undefined ? parsearJsonDeFlag<Grupo>(filtrosTexto, "--filtros") : null;
      const orden = ordenTexto !== undefined ? parsearJsonDeFlag<OrdenCampo[]>(ordenTexto, "--orden") : [];

      const indice = await construirIndice(raiz);
      try {
        const database = indice.databases.get(databaseId);
        if (!database) throw new DatabaseNoIndexada(databaseId);
        const consulta: ConsultaVista = { filtros, orden };
        const resultado = resolverConsulta(indice, database.valor, consulta);
        if (esErrorDeConsulta(resultado)) throw new ErrorDeDominio(resultado);
        return { tipo: "consulta", consulta: resultado };
      } finally {
        indice.sqlite.close();
      }
    }

    default:
      // Inalcanzable: `main` ya validó `comando` contra las claves de ESPECS antes de llamar acá.
      throw new ErrorDeUso(`comando desconocido: "${comando}"`);
  }
}

function datosParaJson(resultado: Resultado): unknown {
  switch (resultado.tipo) {
    case "page":
      return { ...resultado.page, hash: resultado.hash };
    case "database":
      return resultado.database;
    case "row":
      return { ...resultado.row, advertencias: resultado.advertencias };
    case "consulta":
      return resultado.consulta;
  }
}

function imprimirHumano(resultado: Resultado): string {
  switch (resultado.tipo) {
    case "page":
      return formatearPage(resultado.page, resultado.hash);
    case "database":
      return formatearDatabase(resultado.database);
    case "row":
      return formatearRow(resultado.row, resultado.advertencias);
    case "consulta":
      return formatearResultadoConsulta(resultado.consulta);
  }
}

/** Solo para decidir el formato de un error de parseo; nunca se usa para leer el valor real de --json (eso lo hace parseArgs, sin ambigüedad). */
function pareceQuererJson(argv: string[]): boolean {
  return argv.includes("--json");
}

export async function main(argv: string[]): Promise<number> {
  const [recurso, accion, ...resto] = argv;
  const comando = recurso !== undefined && accion !== undefined ? `${recurso} ${accion}` : undefined;
  let usaJson = pareceQuererJson(argv);

  try {
    if (comando === undefined || ESPECS[comando] === undefined) {
      throw new ErrorDeUso(
        comando !== undefined
          ? `comando desconocido: "${comando}"`
          : "uso: nido <page|db|row|view> <create|get|update|query> [opciones]",
      );
    }
    const parsed = parseArgs(resto, ESPECS[comando]);
    usaJson = parsed.flags.json === true;

    const raiz = raizWorkspace();
    await asegurarWorkspace(raiz);

    const resultado = await ejecutar(comando, parsed, raiz);
    if (usaJson) {
      console.log(stringificarJson({ ok: true, datos: datosParaJson(resultado) }));
    } else {
      console.log(imprimirHumano(resultado));
    }
    return 0;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    if (usaJson) {
      console.log(stringificarJson({ ok: false, error: mensaje }));
    } else {
      console.error(`error: ${mensaje}`);
    }
    return error instanceof ErrorDeUso ? 2 : 1;
  }
}

if (import.meta.main) {
  const codigo = await main(Bun.argv.slice(2));
  process.exit(codigo);
}
