/**
 * Tests de `../src/crud/database.ts` (T-0019): CRUD básico y actualización
 * genérica de campos (no de esquema). La migración de esquema (ADR-006)
 * tiene su propio archivo, `./crud-migracion-esquema.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictoDeEscritura } from "../src/almacenamiento/escritura.ts";
import { esErrorDeLectura } from "../src/almacenamiento/lectura.ts";
import { actualizarDatabase, crearDatabase, leerDatabase, type CambiosDatabase } from "../src/crud/database.ts";
import { CambiosDatabaseInvalidos, PropiedadesInvalidas } from "../src/crud/errores.ts";
import { crearRow } from "../src/crud/row.ts";
import type { Property } from "../src/types.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-crud-db-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function propTexto(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "texto", requerida };
}

describe("crud/database: crear + leer", () => {
  test("crear una Database y volver a leerla da el mismo objeto", async () => {
    const creada = await crearDatabase(raiz, {
      titulo: "Tareas",
      parentId: null,
      propiedades: [propTexto("p1")],
    });
    expect(creada.valor.propiedades).toEqual([propTexto("p1")]);
    expect(creada.valor.vistas).toEqual([]);

    const leida = await leerDatabase(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor).toEqual(creada.valor);
    expect(leida.hash).toBe(creada.hash);
  });

  test("crear una Database sin propiedades ni vistas explícitas usa arrays vacíos", async () => {
    const creada = await crearDatabase(raiz, { titulo: "Vacía", parentId: null });
    expect(creada.valor.propiedades).toEqual([]);
    expect(creada.valor.vistas).toEqual([]);
    expect(creada.valor.cuerpo).toBeUndefined();
  });

  // Regresión del hallazgo de revisión de T-0013: `propiedades` con forma
  // incorrecta (JSON sintácticamente válido, pero no un `Property[]` real —
  // exactamente lo que puede llegar de `--propiedades` en la CLI) se
  // rechazaba en silencio y corrompía el workspace para siempre, en vez de
  // fallar antes de escribir nada.
  test("crear con propiedades de forma inválida se rechaza con PropiedadesInvalidas, sin escribir ningún archivo", async () => {
    const propiedadesRotas = [{ foo: "bar" }] as unknown as Property[];
    await expect(
      crearDatabase(raiz, { titulo: "corrupta", parentId: null, propiedades: propiedadesRotas }),
    ).rejects.toBeInstanceOf(PropiedadesInvalidas);
  });

  test("crear con un select sin config.opciones se rechaza, en vez de persistir un esquema que crashea en el próximo uso", async () => {
    const selectRoto = [{ id: "p1", nombre: "estado", tipo: "select", requerida: false }] as unknown as Property[];
    await expect(
      crearDatabase(raiz, { titulo: "corrupta", parentId: null, propiedades: selectRoto }),
    ).rejects.toBeInstanceOf(PropiedadesInvalidas);
  });
});

describe("crud/database: actualizar (campos genéricos) respeta CAS", () => {
  test("actualizar con el hash correcto persiste el cambio", async () => {
    const creada = await crearDatabase(raiz, { titulo: "Original", parentId: null });
    const actualizada = await actualizarDatabase(raiz, creada.valor, creada.hash, { titulo: "Renombrada" });
    expect(actualizada.valor.titulo).toBe("Renombrada");

    const leida = await leerDatabase(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("Renombrada");
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio", async () => {
    const creada = await crearDatabase(raiz, { titulo: "Original", parentId: null });
    await actualizarDatabase(raiz, creada.valor, creada.hash, { titulo: "Cambiado por otro agente" });

    await expect(actualizarDatabase(raiz, creada.valor, creada.hash, { titulo: "Mi cambio" })).rejects.toBeInstanceOf(
      ConflictoDeEscritura,
    );

    const leida = await leerDatabase(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("Cambiado por otro agente");
  });

  test("cambios con propiedades/vistas se rechazan en runtime, no solo por el tipo — regresión de hallazgo de revisión (bypass de ADR-006)", async () => {
    const creada = await crearDatabase(raiz, { titulo: "con filas", parentId: null, propiedades: [propTexto("existente")] });
    await crearRow(raiz, creada.valor, { titulo: "fila 1", valores: [{ propertyId: "existente", valor: "x" }] });

    const bypassPropiedades = {
      propiedades: [...creada.valor.propiedades, propTexto("bypass", true)],
    } as unknown as CambiosDatabase;
    await expect(actualizarDatabase(raiz, creada.valor, creada.hash, bypassPropiedades)).rejects.toBeInstanceOf(
      CambiosDatabaseInvalidos,
    );

    const bypassVistas = { vistas: [] } as unknown as CambiosDatabase;
    await expect(actualizarDatabase(raiz, creada.valor, creada.hash, bypassVistas)).rejects.toBeInstanceOf(
      CambiosDatabaseInvalidos,
    );

    // nada de esto se persistió: el esquema queda exactamente como estaba
    const leida = await leerDatabase(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades).toEqual([propTexto("existente")]);
  });
});
