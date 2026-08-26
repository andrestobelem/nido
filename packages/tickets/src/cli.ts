#!/usr/bin/env bun
import { formatearLista, formatearTicket } from "./format.ts";
import {
  asignar,
  comentar,
  crear,
  crearStore,
  enlazarDependencia,
  leer,
  listar,
  moverEstado,
  type TicketStore,
} from "./store.ts";
import { ESTADOS, esEstado, type Ticket } from "./types.ts";

class ErrorDeUso extends Error {}

interface EspecificacionFlags {
  string?: string[];
}

interface ArgsParsed {
  positional: string[];
  flags: Record<string, string | true>;
}

const ESPECS: Record<string, EspecificacionFlags> = {
  create: { string: ["titulo", "descripcion", "depende-de"] },
  assign: {},
  move: {},
  comment: { string: ["autor", "texto"] },
  link: { string: ["depende-de"] },
  show: {},
  list: { string: ["estado", "asignado-a"] },
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

function flagListaTexto(parsed: ArgsParsed, nombre: string): string[] {
  const valor = flagTexto(parsed, nombre);
  if (!valor) return [];
  return valor
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function dirTickets(): string {
  return process.env.NIDO_TICKETS_DIR ?? "docs/tickets";
}

async function ejecutar(
  comando: string | undefined,
  parsed: ArgsParsed,
  store: TicketStore,
): Promise<unknown> {
  switch (comando) {
    case "create": {
      const titulo = flagTexto(parsed, "titulo");
      if (!titulo) throw new ErrorDeUso("falta --titulo");
      const descripcion = flagTexto(parsed, "descripcion") ?? "";
      const dependeDe = flagListaTexto(parsed, "depende-de");
      return await crear(store, { titulo, descripcion, dependeDe });
    }
    case "assign": {
      const [id, agente] = parsed.positional;
      if (!id || !agente) throw new ErrorDeUso("uso: tickets assign <id> <agente>");
      return await asignar(store, id, agente);
    }
    case "move": {
      const [id, estado] = parsed.positional;
      if (!id || !estado) throw new ErrorDeUso("uso: tickets move <id> <estado>");
      if (!esEstado(estado)) {
        throw new ErrorDeUso(`estado inválido "${estado}". Válidos: ${ESTADOS.join(", ")}`);
      }
      return await moverEstado(store, id, estado);
    }
    case "comment": {
      const id = parsed.positional[0];
      const autor = flagTexto(parsed, "autor");
      const texto = flagTexto(parsed, "texto");
      if (!id || !autor || !texto) {
        throw new ErrorDeUso("uso: tickets comment <id> --autor <agente> --texto <texto>");
      }
      return await comentar(store, id, autor, texto);
    }
    case "link": {
      const id = parsed.positional[0];
      const dependeDeId = flagTexto(parsed, "depende-de");
      if (!id || !dependeDeId) {
        throw new ErrorDeUso("uso: tickets link <id> --depende-de <otroId>");
      }
      return await enlazarDependencia(store, id, dependeDeId);
    }
    case "show": {
      const id = parsed.positional[0];
      if (!id) throw new ErrorDeUso("uso: tickets show <id>");
      return await leer(store, id);
    }
    case "list": {
      let tickets = await listar(store);
      const estadoFiltro = flagTexto(parsed, "estado");
      if (estadoFiltro) {
        if (!esEstado(estadoFiltro)) throw new ErrorDeUso(`estado inválido "${estadoFiltro}"`);
        tickets = tickets.filter((t) => t.estado === estadoFiltro);
      }
      const asignadoFiltro = flagTexto(parsed, "asignado-a");
      if (asignadoFiltro) tickets = tickets.filter((t) => t.asignadoA === asignadoFiltro);
      return tickets;
    }
    default:
      throw new ErrorDeUso(
        comando
          ? `comando desconocido: "${comando}"`
          : "uso: tickets <create|assign|move|comment|link|show|list> [opciones]",
      );
  }
}

function imprimirHumano(datos: unknown): string {
  if (Array.isArray(datos)) return formatearLista(datos as Ticket[]);
  return formatearTicket(datos as Ticket);
}

/** Solo para decidir el formato de un error de parseo; nunca se usa para leer el valor real de --json (eso lo hace parseArgs, sin ambigüedad). */
function pareceQuererJson(argv: string[]): boolean {
  return argv.includes("--json");
}

export async function main(argv: string[]): Promise<number> {
  const [comando, ...resto] = argv;
  const store = crearStore(dirTickets());
  let usaJson = pareceQuererJson(resto);
  try {
    const spec = ESPECS[comando ?? ""] ?? {};
    const parsed = parseArgs(resto, spec);
    usaJson = parsed.flags.json === true;
    const datos = await ejecutar(comando, parsed, store);
    if (usaJson) {
      console.log(JSON.stringify({ ok: true, datos }, null, 2));
    } else {
      console.log(imprimirHumano(datos));
    }
    return 0;
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    if (usaJson) {
      console.log(JSON.stringify({ ok: false, error: mensaje }, null, 2));
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
