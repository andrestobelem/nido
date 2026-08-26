/**
 * Tests de `../src/crud/row.ts` (T-0019). Directorio temporal real.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictoDeEscritura } from "../src/almacenamiento/escritura.ts";
import { esErrorDeLectura } from "../src/almacenamiento/lectura.ts";
import { crearDatabase } from "../src/crud/database.ts";
import { RowInvalida, ValoresInvalidos } from "../src/crud/errores.ts";
import { actualizarRow, crearRow, leerRow } from "../src/crud/row.ts";
import type { Property, PropertyValue } from "../src/types.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-crud-row-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function propTexto(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "texto", requerida };
}

describe("crud/row: crear + leer", () => {
  test("crear una Row y volver a leerla da el mismo objeto", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1", true)] });
    const fila = await crearRow(raiz, db.valor, { titulo: "fila 1", valores: [{ propertyId: "p1", valor: "hola" }] });
    expect(fila.advertencias).toEqual([]);
    expect(fila.valor.parentId).toBe(db.valor.id);

    const leida = await leerRow(raiz, db.valor, fila.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor).toEqual(fila.valor);
    expect(leida.hash).toBe(fila.hash);
  });

  test("crear una Row sin valor para una property requerida se rechaza, sin escribir nada", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1", true)] });
    await expect(crearRow(raiz, db.valor, { titulo: "incompleta", valores: [] })).rejects.toBeInstanceOf(RowInvalida);
  });

  // Regresión del hallazgo de revisión de T-0013: `valores` con forma
  // incorrecta (JSON sintácticamente válido, pero no un `PropertyValue[]`
  // real — exactamente lo que puede llegar de `--valores` en la CLI) o bien
  // crasheaba dentro de `validarRow` con un error nativo críptico, o colaba
  // un `propertyId` inválido como "advertencia" de huérfano en vez de
  // rechazarse.
  test('crear con "valores" que no es un array se rechaza con ValoresInvalidos, en vez de crashear en validarRow', async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    const valoresRotos = { a: 1 } as unknown as PropertyValue[];
    await expect(crearRow(raiz, db.valor, { titulo: "x", valores: valoresRotos })).rejects.toBeInstanceOf(ValoresInvalidos);
  });

  test('crear con un elemento de "valores" sin propertyId se rechaza, en vez de colarse como advertencia de huérfano', async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    const valoresRotos = [{ foo: "bar" }] as unknown as PropertyValue[];
    await expect(crearRow(raiz, db.valor, { titulo: "x", valores: valoresRotos })).rejects.toBeInstanceOf(ValoresInvalidos);
  });
});

describe("crud/row: actualizar respeta CAS", () => {
  test("actualizar con el hash correcto persiste el cambio", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    const fila = await crearRow(raiz, db.valor, { titulo: "original", valores: [] });

    const actualizada = await actualizarRow(raiz, db.valor, fila.valor, fila.hash, { titulo: "renombrada" });
    expect(actualizada.valor.titulo).toBe("renombrada");

    const leida = await leerRow(raiz, db.valor, fila.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("renombrada");
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    const fila = await crearRow(raiz, db.valor, { titulo: "original", valores: [] });

    await actualizarRow(raiz, db.valor, fila.valor, fila.hash, { titulo: "cambiado por otro agente" });

    await expect(actualizarRow(raiz, db.valor, fila.valor, fila.hash, { titulo: "mi cambio" })).rejects.toBeInstanceOf(
      ConflictoDeEscritura,
    );

    const leida = await leerRow(raiz, db.valor, fila.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("cambiado por otro agente");
  });

  test("actualizar quitando el valor de una property requerida se rechaza, sin escribir nada", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1", true)] });
    const fila = await crearRow(raiz, db.valor, { titulo: "fila", valores: [{ propertyId: "p1", valor: "x" }] });

    await expect(actualizarRow(raiz, db.valor, fila.valor, fila.hash, { valores: [] })).rejects.toBeInstanceOf(RowInvalida);

    const leida = await leerRow(raiz, db.valor, fila.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.valores).toEqual([{ propertyId: "p1", valor: "x" }]); // sin cambios
  });

  test('actualizar con "valores" de forma inválida se rechaza con ValoresInvalidos, sin tocar el archivo', async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    const fila = await crearRow(raiz, db.valor, { titulo: "fila", valores: [{ propertyId: "p1", valor: "x" }] });

    const valoresRotos = [{ foo: "bar" }] as unknown as PropertyValue[];
    await expect(
      actualizarRow(raiz, db.valor, fila.valor, fila.hash, { valores: valoresRotos }),
    ).rejects.toBeInstanceOf(ValoresInvalidos);

    const leida = await leerRow(raiz, db.valor, fila.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.valores).toEqual([{ propertyId: "p1", valor: "x" }]); // sin cambios
  });
});
