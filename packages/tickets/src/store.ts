import { mkdir, readdir, rename } from "node:fs/promises";
import { conLock } from "./lock.ts";
import { reservarProximoId } from "./id.ts";
import { esIdValido, type Estado, type Ticket } from "./types.ts";

export class TicketNoEncontrado extends Error {
  constructor(id: string) {
    super(`no existe el ticket ${id}`);
  }
}

export class DependenciaInvalida extends Error {}

export class IdInvalido extends Error {
  constructor(id: string) {
    super(`id de ticket inválido: "${id}"`);
  }
}

export interface TicketStore {
  dir: string;
}

export function crearStore(dir: string): TicketStore {
  return { dir };
}

async function asegurarDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

function pathDe(dir: string, id: string): string {
  if (!esIdValido(id)) throw new IdInvalido(id);
  return `${dir}/${id}.json`;
}

/**
 * Todas las mutaciones del store se serializan con un único lock por
 * directorio. A esta escala (un puñado de agentes, cientos de tickets) la
 * simplicidad de "un mutex global" pesa más que el throughput de locks por
 * archivo, y evita por completo las carreras entre operaciones que tocan
 * más de un ticket (por ejemplo, enlazarDependencia leyendo el grafo
 * completo antes de escribir).
 */
async function conMutex<T>(store: TicketStore, fn: () => Promise<T>): Promise<T> {
  await asegurarDir(store.dir);
  return conLock(`${store.dir}/.lock`, fn);
}

export async function existe(store: TicketStore, id: string): Promise<boolean> {
  return await Bun.file(pathDe(store.dir, id)).exists();
}

export async function leer(store: TicketStore, id: string): Promise<Ticket> {
  const archivo = Bun.file(pathDe(store.dir, id));
  if (!(await archivo.exists())) throw new TicketNoEncontrado(id);
  const contenido = await archivo.text();
  if (contenido.trim().length === 0) throw new TicketNoEncontrado(id);
  return JSON.parse(contenido) as Ticket;
}

async function guardar(store: TicketStore, id: string, ticket: Ticket): Promise<void> {
  if (ticket.id !== id) {
    throw new Error(`inconsistencia interna: se intentó guardar ${ticket.id} en el archivo de ${id}`);
  }
  const destino = pathDe(store.dir, id);
  const temporal = `${destino}.tmp-${crypto.randomUUID()}`;
  await Bun.write(temporal, `${JSON.stringify(ticket, null, 2)}\n`);
  await rename(temporal, destino);
}

export async function listar(store: TicketStore): Promise<Ticket[]> {
  let entradas: string[];
  try {
    entradas = await readdir(store.dir);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
  const tickets: Ticket[] = [];
  for (const nombre of entradas) {
    if (!nombre.endsWith(".json")) continue;
    const contenido = await Bun.file(`${store.dir}/${nombre}`).text();
    if (contenido.trim().length === 0) continue;
    tickets.push(JSON.parse(contenido) as Ticket);
  }
  tickets.sort((a, b) => a.id.localeCompare(b.id));
  return tickets;
}

export interface CrearTicketInput {
  titulo: string;
  descripcion: string;
  dependeDe?: string[];
}

export async function crear(store: TicketStore, input: CrearTicketInput): Promise<Ticket> {
  return conMutex(store, async () => {
    const dependeDe = [...new Set(input.dependeDe ?? [])];
    for (const dep of dependeDe) {
      if (!(await existe(store, dep))) {
        throw new DependenciaInvalida(`la dependencia ${dep} no existe`);
      }
    }
    const { id } = await reservarProximoId(store.dir);
    const ahora = new Date().toISOString();
    const ticket: Ticket = {
      id,
      titulo: input.titulo,
      descripcion: input.descripcion,
      estado: "pendiente",
      asignadoA: null,
      dependeDe,
      comentarios: [],
      creadoEn: ahora,
      actualizadoEn: ahora,
    };
    await guardar(store, id, ticket);
    return ticket;
  });
}

export async function asignar(store: TicketStore, id: string, agente: string): Promise<Ticket> {
  return conMutex(store, async () => {
    const ticket = await leer(store, id);
    ticket.asignadoA = agente;
    ticket.actualizadoEn = new Date().toISOString();
    await guardar(store, id, ticket);
    return ticket;
  });
}

async function bloqueantesPendientes(store: TicketStore, ticket: Ticket): Promise<string[]> {
  const pendientes: string[] = [];
  for (const dep of ticket.dependeDe) {
    const ticketDep = await leer(store, dep);
    if (ticketDep.estado !== "hecho") pendientes.push(dep);
  }
  return pendientes;
}

export async function moverEstado(
  store: TicketStore,
  id: string,
  estado: Estado,
): Promise<Ticket> {
  return conMutex(store, async () => {
    const ticket = await leer(store, id);
    const requiereDependenciasResueltas = estado !== "pendiente" && estado !== "bloqueado";
    if (requiereDependenciasResueltas) {
      const bloqueantes = await bloqueantesPendientes(store, ticket);
      if (bloqueantes.length > 0) {
        throw new DependenciaInvalida(
          `no se puede mover ${id} a ${estado}: depende de ${bloqueantes.join(", ")} sin terminar`,
        );
      }
    }
    ticket.estado = estado;
    ticket.actualizadoEn = new Date().toISOString();
    await guardar(store, id, ticket);
    return ticket;
  });
}

export async function comentar(
  store: TicketStore,
  id: string,
  autor: string,
  texto: string,
): Promise<Ticket> {
  return conMutex(store, async () => {
    const ticket = await leer(store, id);
    ticket.comentarios.push({ autor, texto, fecha: new Date().toISOString() });
    ticket.actualizadoEn = new Date().toISOString();
    await guardar(store, id, ticket);
    return ticket;
  });
}

async function creaCiclo(
  store: TicketStore,
  desde: string,
  hastaBuscado: string,
  visitados: Set<string> = new Set(),
): Promise<boolean> {
  if (desde === hastaBuscado) return true;
  if (visitados.has(desde)) return false;
  visitados.add(desde);
  const ticket = await leer(store, desde);
  for (const dep of ticket.dependeDe) {
    if (await creaCiclo(store, dep, hastaBuscado, visitados)) return true;
  }
  return false;
}

export async function enlazarDependencia(
  store: TicketStore,
  id: string,
  dependeDeId: string,
): Promise<Ticket> {
  return conMutex(store, async () => {
    if (id === dependeDeId) {
      throw new DependenciaInvalida("un ticket no puede depender de sí mismo");
    }
    const ticket = await leer(store, id);
    if (!(await existe(store, dependeDeId))) {
      throw new DependenciaInvalida(`la dependencia ${dependeDeId} no existe`);
    }
    if (await creaCiclo(store, dependeDeId, id)) {
      throw new DependenciaInvalida("agregar esa dependencia crearía un ciclo");
    }
    if (!ticket.dependeDe.includes(dependeDeId)) {
      ticket.dependeDe.push(dependeDeId);
    }
    ticket.actualizadoEn = new Date().toISOString();
    await guardar(store, id, ticket);
    return ticket;
  });
}
