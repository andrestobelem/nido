/**
 * Tests de `../src/crud/vistas.ts` (T-0019): CRUD de View dentro de una
 * Database, y `resolverVistaDeDatabase` (integración con el índice de
 * T-0018) resolviendo una View después de crear varias Rows.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictoDeEscritura } from "../src/almacenamiento/escritura.ts";
import { esErrorDeLectura } from "../src/almacenamiento/lectura.ts";
import { actualizarDatabase, crearDatabase, leerDatabase } from "../src/crud/database.ts";
import { VistaDatabaseIdIncorrecto, VistaInvalida, VistaNoEncontrada } from "../src/crud/errores.ts";
import { crearRow } from "../src/crud/row.ts";
import { agregarVista, actualizarVista, quitarVista, resolverVistaDeDatabase } from "../src/crud/vistas.ts";
import { esErrorDeConsulta } from "../src/indice/vistas.ts";
import type { Property, View } from "../src/types.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-crud-vistas-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function propNumero(id: string): Property {
  return { id, nombre: id, tipo: "numero", requerida: false };
}

describe("crud/vistas: agregar/actualizar/quitar", () => {
  test("agregar una View válida la persiste; una inválida se rechaza sin escribir nada", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propNumero("prioridad")] });

    const vista: View = { id: "v1", nombre: "Todas", databaseId: db.valor.id, filtros: null, orden: [] };
    const conVista = await agregarVista(raiz, db.valor, db.hash, vista);
    expect(conVista.valor.vistas).toEqual([vista]);

    const vistaInvalida: View = {
      id: "v2",
      nombre: "Rota",
      databaseId: db.valor.id,
      filtros: {
        combinador: "y",
        condiciones: [{ campo: { tipo: "propiedad", propertyId: "no-existe" }, operador: "igual", valor: 1 }],
      },
      orden: [],
    };
    await expect(agregarVista(raiz, conVista.valor, conVista.hash, vistaInvalida)).rejects.toBeInstanceOf(VistaInvalida);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.vistas).toEqual([vista]); // la inválida nunca se agregó
  });

  test("agregar/actualizar una View con databaseId de otra Database se rechaza — regresión de hallazgo de revisión (databaseId cruzado)", async () => {
    const dbA = await crearDatabase(raiz, { titulo: "A", parentId: null });
    const dbB = await crearDatabase(raiz, { titulo: "B", parentId: null });

    const vistaCruzada: View = { id: "v1", nombre: "Cruzada", databaseId: dbB.valor.id, filtros: null, orden: [] };
    await expect(agregarVista(raiz, dbA.valor, dbA.hash, vistaCruzada)).rejects.toBeInstanceOf(VistaDatabaseIdIncorrecto);

    const leidaA = await leerDatabase(raiz, dbA.valor.id);
    if (esErrorDeLectura(leidaA)) throw new Error("no debería fallar");
    expect(leidaA.valor.vistas).toEqual([]); // nunca se agregó

    // el mismo chequeo corre en actualizarVista, contra una View ya existente en dbA
    const vistaPropia: View = { id: "v1", nombre: "Propia", databaseId: dbA.valor.id, filtros: null, orden: [] };
    const conVista = await agregarVista(raiz, dbA.valor, dbA.hash, vistaPropia);
    await expect(
      actualizarVista(raiz, conVista.valor, conVista.hash, { ...vistaPropia, databaseId: dbB.valor.id }),
    ).rejects.toBeInstanceOf(VistaDatabaseIdIncorrecto);
  });

  test("agregar una View con un id ya usado se rechaza", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null });
    const vista: View = { id: "v1", nombre: "Original", databaseId: db.valor.id, filtros: null, orden: [] };
    const conVista = await agregarVista(raiz, db.valor, db.hash, vista);
    await expect(agregarVista(raiz, conVista.valor, conVista.hash, { ...vista, nombre: "Otra" })).rejects.toThrow();
  });

  test("actualizar y quitar una View existente", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null });
    const vista: View = { id: "v1", nombre: "Original", databaseId: db.valor.id, filtros: null, orden: [] };
    const conVista = await agregarVista(raiz, db.valor, db.hash, vista);

    const actualizada = await actualizarVista(raiz, conVista.valor, conVista.hash, { ...vista, nombre: "Renombrada" });
    expect(actualizada.valor.vistas[0]!.nombre).toBe("Renombrada");

    const sinVista = await quitarVista(raiz, actualizada.valor, actualizada.hash, "v1");
    expect(sinVista.valor.vistas).toEqual([]);

    await expect(quitarVista(raiz, sinVista.valor, sinVista.hash, "no-existe")).rejects.toBeInstanceOf(VistaNoEncontrada);
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio: agregarVista", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null });
    await actualizarDatabase(raiz, db.valor, db.hash, { titulo: "Cambiado por otro agente" });

    const vista: View = { id: "v1", nombre: "Todas", databaseId: db.valor.id, filtros: null, orden: [] };
    await expect(agregarVista(raiz, db.valor, db.hash, vista)).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.vistas).toEqual([]); // sin cambios
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio: actualizarVista", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null });
    const vista: View = { id: "v1", nombre: "Original", databaseId: db.valor.id, filtros: null, orden: [] };
    const conVista = await agregarVista(raiz, db.valor, db.hash, vista);
    await actualizarDatabase(raiz, conVista.valor, conVista.hash, { titulo: "Cambiado por otro agente" });

    await expect(
      actualizarVista(raiz, conVista.valor, conVista.hash, { ...vista, nombre: "Renombrada" }),
    ).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.vistas[0]!.nombre).toBe("Original"); // sin cambios
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio: quitarVista", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null });
    const vista: View = { id: "v1", nombre: "Original", databaseId: db.valor.id, filtros: null, orden: [] };
    const conVista = await agregarVista(raiz, db.valor, db.hash, vista);
    await actualizarDatabase(raiz, conVista.valor, conVista.hash, { titulo: "Cambiado por otro agente" });

    await expect(quitarVista(raiz, conVista.valor, conVista.hash, "v1")).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.vistas.map((v) => v.id)).toEqual(["v1"]); // sin cambios
  });
});

describe("crud/vistas: resolverVistaDeDatabase (integra T-0017 + T-0018)", () => {
  test("resuelve una View después de crear varias Rows", async () => {
    const db = await crearDatabase(raiz, { titulo: "tareas", parentId: null, propiedades: [propNumero("prioridad")] });
    const vista: View = {
      id: "v-altas",
      nombre: "Prioridad alta",
      databaseId: db.valor.id,
      filtros: {
        combinador: "y",
        condiciones: [{ campo: { tipo: "propiedad", propertyId: "prioridad" }, operador: "mayor_que", valor: 5 }],
      },
      orden: [{ campo: { tipo: "propiedad", propertyId: "prioridad" }, direccion: "desc" }],
    };
    const conVista = await agregarVista(raiz, db.valor, db.hash, vista);

    await crearRow(raiz, conVista.valor, { titulo: "baja", valores: [{ propertyId: "prioridad", valor: 1 }] });
    const alta1 = await crearRow(raiz, conVista.valor, { titulo: "alta 1", valores: [{ propertyId: "prioridad", valor: 10 }] });
    const alta2 = await crearRow(raiz, conVista.valor, { titulo: "alta 2", valores: [{ propertyId: "prioridad", valor: 20 }] });

    const resultado = await resolverVistaDeDatabase(raiz, db.valor.id, "v-altas");
    if (esErrorDeConsulta(resultado)) throw new Error("no debería fallar la resolución");
    expect(resultado.filas.map((f) => f.id)).toEqual([alta2.valor.id, alta1.valor.id]); // desc por prioridad, "baja" excluida
  });
});
