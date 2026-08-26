import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DependenciaInvalida,
  IdInvalido,
  TicketNoEncontrado,
  asignar,
  comentar,
  crear,
  crearStore,
  enlazarDependencia,
  leer,
  listar,
  moverEstado,
  type TicketStore,
} from "../src/store.ts";

let dir: string;
let store: TicketStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nido-tickets-store-"));
  store = crearStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("crear", () => {
  test("asigna un id incremental con prefijo T-", async () => {
    const t1 = await crear(store, { titulo: "uno", descripcion: "" });
    const t2 = await crear(store, { titulo: "dos", descripcion: "" });
    expect(t1.id).toBe("T-0001");
    expect(t2.id).toBe("T-0002");
  });

  test("arranca en estado pendiente y sin asignar", async () => {
    const ticket = await crear(store, { titulo: "uno", descripcion: "" });
    expect(ticket.estado).toBe("pendiente");
    expect(ticket.asignadoA).toBeNull();
    expect(ticket.comentarios).toEqual([]);
  });

  test("rechaza una dependencia que no existe", async () => {
    await expect(
      crear(store, { titulo: "uno", descripcion: "", dependeDe: ["T-9999"] }),
    ).rejects.toBeInstanceOf(DependenciaInvalida);
  });

  test("deduplica dependencias repetidas", async () => {
    const a = await crear(store, { titulo: "a", descripcion: "" });
    const b = await crear(store, { titulo: "b", descripcion: "", dependeDe: [a.id, a.id] });
    expect(b.dependeDe).toEqual([a.id]);
  });
});

describe("leer", () => {
  test("rechaza un id con formato inválido en vez de leer fuera del directorio", async () => {
    await expect(leer(store, "../../etc/passwd")).rejects.toBeInstanceOf(IdInvalido);
  });
});

describe("asignar", () => {
  test("cambia el campo asignadoA", async () => {
    const ticket = await crear(store, { titulo: "uno", descripcion: "" });
    const actualizado = await asignar(store, ticket.id, "ada");
    expect(actualizado.asignadoA).toBe("ada");
  });

  test("falla si el ticket no existe", async () => {
    await expect(asignar(store, "T-0001", "ada")).rejects.toBeInstanceOf(TicketNoEncontrado);
  });
});

describe("moverEstado", () => {
  test("bloquea pasar a en_progreso si hay una dependencia sin terminar", async () => {
    const bloqueante = await crear(store, { titulo: "bloqueante", descripcion: "" });
    const dependiente = await crear(store, {
      titulo: "dependiente",
      descripcion: "",
      dependeDe: [bloqueante.id],
    });
    await expect(
      moverEstado(store, dependiente.id, "en_progreso"),
    ).rejects.toBeInstanceOf(DependenciaInvalida);
  });

  test("permite pasar a en_progreso una vez que la dependencia está hecha", async () => {
    const bloqueante = await crear(store, { titulo: "bloqueante", descripcion: "" });
    const dependiente = await crear(store, {
      titulo: "dependiente",
      descripcion: "",
      dependeDe: [bloqueante.id],
    });
    await moverEstado(store, bloqueante.id, "hecho");
    const actualizado = await moverEstado(store, dependiente.id, "en_progreso");
    expect(actualizado.estado).toBe("en_progreso");
  });

  test("permite mover a bloqueado sin importar dependencias", async () => {
    const bloqueante = await crear(store, { titulo: "bloqueante", descripcion: "" });
    const dependiente = await crear(store, {
      titulo: "dependiente",
      descripcion: "",
      dependeDe: [bloqueante.id],
    });
    const actualizado = await moverEstado(store, dependiente.id, "bloqueado");
    expect(actualizado.estado).toBe("bloqueado");
  });
});

describe("comentar", () => {
  test("agrega un comentario con autor y texto", async () => {
    const ticket = await crear(store, { titulo: "uno", descripcion: "" });
    const actualizado = await comentar(store, ticket.id, "ada", "avanzando");
    expect(actualizado.comentarios).toHaveLength(1);
    expect(actualizado.comentarios[0]).toMatchObject({ autor: "ada", texto: "avanzando" });
  });
});

describe("enlazarDependencia", () => {
  test("agrega la dependencia", async () => {
    const a = await crear(store, { titulo: "a", descripcion: "" });
    const b = await crear(store, { titulo: "b", descripcion: "" });
    const actualizado = await enlazarDependencia(store, b.id, a.id);
    expect(actualizado.dependeDe).toContain(a.id);
  });

  test("rechaza un ciclo directo", async () => {
    const a = await crear(store, { titulo: "a", descripcion: "" });
    const b = await crear(store, { titulo: "b", descripcion: "", dependeDe: [a.id] });
    await expect(enlazarDependencia(store, a.id, b.id)).rejects.toBeInstanceOf(
      DependenciaInvalida,
    );
  });

  test("rechaza depender de sí mismo", async () => {
    const a = await crear(store, { titulo: "a", descripcion: "" });
    await expect(enlazarDependencia(store, a.id, a.id)).rejects.toBeInstanceOf(
      DependenciaInvalida,
    );
  });

  test("rechaza una dependencia hacia un ticket que no existe", async () => {
    const a = await crear(store, { titulo: "a", descripcion: "" });
    await expect(enlazarDependencia(store, a.id, "T-9999")).rejects.toBeInstanceOf(
      DependenciaInvalida,
    );
  });
});

describe("concurrencia", () => {
  test("dos comentarios concurrentes sobre el mismo ticket no se pisan", async () => {
    const ticket = await crear(store, { titulo: "uno", descripcion: "" });
    await Promise.all([
      comentar(store, ticket.id, "agente-a", "comentario a"),
      comentar(store, ticket.id, "agente-b", "comentario b"),
    ]);
    const final = await leer(store, ticket.id);
    expect(final.comentarios).toHaveLength(2);
    expect(final.comentarios.map((c) => c.autor).sort()).toEqual(["agente-a", "agente-b"]);
  });

  test("dos enlaces de dependencia en direcciones opuestas no crean un ciclo", async () => {
    const a = await crear(store, { titulo: "a", descripcion: "" });
    const b = await crear(store, { titulo: "b", descripcion: "" });
    const resultados = await Promise.allSettled([
      enlazarDependencia(store, a.id, b.id),
      enlazarDependencia(store, b.id, a.id),
    ]);
    const exitosos = resultados.filter((r) => r.status === "fulfilled").length;
    const fallidos = resultados.filter((r) => r.status === "rejected").length;
    expect(exitosos).toBe(1);
    expect(fallidos).toBe(1);
    const [ticketA, ticketB] = await Promise.all([leer(store, a.id), leer(store, b.id)]);
    const hayCiclo = ticketA.dependeDe.includes(b.id) && ticketB.dependeDe.includes(a.id);
    expect(hayCiclo).toBe(false);
  });

  test("varias asignaciones concurrentes dejan un resultado consistente, sin corromper el archivo", async () => {
    const ticket = await crear(store, { titulo: "uno", descripcion: "" });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => asignar(store, ticket.id, `agente-${i}`)),
    );
    const final = await leer(store, ticket.id);
    expect(final.id).toBe(ticket.id);
    expect(typeof final.asignadoA).toBe("string");
  });
});

describe("listar", () => {
  test("devuelve los tickets ordenados por id", async () => {
    await crear(store, { titulo: "uno", descripcion: "" });
    await crear(store, { titulo: "dos", descripcion: "" });
    const tickets = await listar(store);
    expect(tickets.map((t) => t.id)).toEqual(["T-0001", "T-0002"]);
  });

  test("devuelve vacío si el directorio no existe todavía", async () => {
    const tickets = await listar(crearStore(join(dir, "no-existe")));
    expect(tickets).toEqual([]);
  });
});
