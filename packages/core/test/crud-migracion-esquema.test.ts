/**
 * Tests de la migración de esquema de `docs/adr/006-migracion-de-esquema.md`
 * vía `../src/crud/database.ts` (T-0019): `agregarProperty`,
 * `promoverPropertyARequerida`, `quitarProperty`. Directorio temporal real,
 * combinando el CRUD de Database con el de Row (`../src/crud/row.ts`) para
 * ejercitar los escenarios que exige el ADR.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictoDeEscritura } from "../src/almacenamiento/escritura.ts";
import { esErrorDeLectura } from "../src/almacenamiento/lectura.ts";
import { agregarProperty, actualizarDatabase, crearDatabase, leerDatabase, promoverPropertyARequerida, quitarProperty } from "../src/crud/database.ts";
import { PromocionFallida, PropertyNoEncontrada, PropertyRequeridaRechazada, PropertyIdDuplicado } from "../src/crud/errores.ts";
import { actualizarRow, crearRow, leerRow } from "../src/crud/row.ts";
import type { Property } from "../src/types.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-crud-migracion-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function propTexto(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "texto", requerida };
}

describe("agregarProperty (ADR-006 sección 1)", () => {
  test("Database vacía: agregar una property requerida de una tiene éxito", async () => {
    const db = await crearDatabase(raiz, { titulo: "vacía", parentId: null });
    const resultado = await agregarProperty(raiz, db.valor, db.hash, propTexto("p1", true));
    expect(resultado.valor.propiedades).toEqual([propTexto("p1", true)]);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades).toEqual([propTexto("p1", true)]);
  });

  test("Database con al menos una Row: agregar una property requerida se rechaza sin tocar el esquema", async () => {
    const db = await crearDatabase(raiz, { titulo: "con filas", parentId: null, propiedades: [propTexto("existente")] });
    await crearRow(raiz, db.valor, { titulo: "fila 1", valores: [{ propertyId: "existente", valor: "x" }] });

    await expect(agregarProperty(raiz, db.valor, db.hash, propTexto("nueva", true))).rejects.toBeInstanceOf(
      PropertyRequeridaRechazada,
    );

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades).toEqual([propTexto("existente")]); // sin cambios
  });

  test("Database con Rows: agregar una property no-requerida siempre funciona", async () => {
    const db = await crearDatabase(raiz, { titulo: "con filas", parentId: null, propiedades: [propTexto("existente")] });
    await crearRow(raiz, db.valor, { titulo: "fila 1", valores: [{ propertyId: "existente", valor: "x" }] });

    const resultado = await agregarProperty(raiz, db.valor, db.hash, propTexto("nueva", false));
    expect(resultado.valor.propiedades.map((p) => p.id)).toEqual(["existente", "nueva"]);
  });

  test("agregar una property con un id ya usado se rechaza", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    await expect(agregarProperty(raiz, db.valor, db.hash, propTexto("p1", false))).rejects.toBeInstanceOf(PropertyIdDuplicado);
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null });
    await actualizarDatabase(raiz, db.valor, db.hash, { titulo: "Cambiado por otro agente" });

    await expect(agregarProperty(raiz, db.valor, db.hash, propTexto("nueva"))).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades).toEqual([]); // sin cambios
  });

  test("regresión (hallazgo de revisión): una Row real pero inválida contra el esquema actual por una razón AJENA sigue contando — agregar una property requerida se rechaza igual", async () => {
    // Property "reused" (texto, no requerida) con una Row que le pone un valor string.
    let db = await crearDatabase(raiz, { titulo: "t", parentId: null, propiedades: [propTexto("reused")] });
    await crearRow(raiz, db.valor, { titulo: "filaA", valores: [{ propertyId: "reused", valor: "hola" }] });

    // quitarProperty siempre tiene éxito (ADR-006 sección 3): el valor de filaA queda huérfano.
    db = await quitarProperty(raiz, db.valor, db.hash, "reused");

    // Re-agregar "reused" con OTRO tipo (numero): el valor huérfano string ya
    // no matchea el tipo nuevo -> TIPO_INVALIDO fatal para filaA contra el
    // índice de T-0018 (../src/indice/construccion.ts), aunque el archivo de
    // filaA sigue existiendo tal cual en disco.
    db = await agregarProperty(raiz, db.valor, db.hash, { id: "reused", nombre: "reused", tipo: "numero", requerida: false });

    // filaA "existe" -> agregar una property requerida debe rechazarse igual,
    // no tener éxito como si la Database estuviera vacía.
    await expect(
      agregarProperty(raiz, db.valor, db.hash, propTexto("nueva-requerida", true)),
    ).rejects.toBeInstanceOf(PropertyRequeridaRechazada);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades.some((p) => p.id === "nueva-requerida")).toBe(false); // sin cambios
  });
});

describe("promoverPropertyARequerida (ADR-006 sección 2)", () => {
  async function armarDatabaseConFilas() {
    const db0 = await crearDatabase(raiz, { titulo: "tareas", parentId: null, propiedades: [propTexto("obligatoria", true)] });
    const db1 = await agregarProperty(raiz, db0.valor, db0.hash, propTexto("prioridad", false));
    const filaConValor = await crearRow(raiz, db1.valor, {
      titulo: "con valor",
      valores: [
        { propertyId: "obligatoria", valor: "a" },
        { propertyId: "prioridad", valor: "alta" },
      ],
    });
    const filaSinValor = await crearRow(raiz, db1.valor, {
      titulo: "sin valor",
      valores: [{ propertyId: "obligatoria", valor: "b" }],
    });
    return { database: db1.valor, hash: db1.hash, filaConValor, filaSinValor };
  }

  test("falla y reporta las Rows faltantes (acotado + total) si no todas tienen valor, sin tocar el esquema", async () => {
    const { database, hash, filaSinValor } = await armarDatabaseConFilas();

    let capturado: PromocionFallida | undefined;
    try {
      await promoverPropertyARequerida(raiz, database, hash, "prioridad");
    } catch (error) {
      if (error instanceof PromocionFallida) capturado = error;
      else throw error;
    }
    expect(capturado).toBeDefined();
    expect(capturado!.totalFaltantes).toBe(1);
    expect(capturado!.rowsFaltantes.map((r) => r.id)).toEqual([filaSinValor.valor.id]);

    const leida = await leerDatabase(raiz, database.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades.find((p) => p.id === "prioridad")!.requerida).toBe(false);
  });

  test("tiene éxito si todas las Rows ya tienen valor", async () => {
    const { database, hash, filaSinValor } = await armarDatabaseConFilas();

    // Se completa la fila que faltaba, por el camino normal de escritura de Row.
    const filaLeida = await leerRow(raiz, database, filaSinValor.valor.id);
    if (esErrorDeLectura(filaLeida)) throw new Error("no debería fallar");
    await actualizarRow(raiz, database, filaLeida.valor, filaLeida.hash, {
      valores: [...filaLeida.valor.valores, { propertyId: "prioridad", valor: "baja" }],
    });

    const resultado = await promoverPropertyARequerida(raiz, database, hash, "prioridad");
    expect(resultado.valor.propiedades.find((p) => p.id === "prioridad")!.requerida).toBe(true);

    const leida = await leerDatabase(raiz, database.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades.find((p) => p.id === "prioridad")!.requerida).toBe(true);
  });

  test("promover una property ya requerida es un no-op", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1", true)] });
    const resultado = await promoverPropertyARequerida(raiz, db.valor, db.hash, "p1");
    expect(resultado.valor).toEqual(db.valor);
  });

  test("property inexistente: PropertyNoEncontrada", async () => {
    const db = await crearDatabase(raiz, { titulo: "x", parentId: null });
    await expect(promoverPropertyARequerida(raiz, db.valor, db.hash, "no-existe")).rejects.toBeInstanceOf(PropertyNoEncontrada);
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio (camino que sí escribe)", async () => {
    const { database, hash, filaSinValor } = await armarDatabaseConFilas();
    const filaLeida = await leerRow(raiz, database, filaSinValor.valor.id);
    if (esErrorDeLectura(filaLeida)) throw new Error("no debería fallar");
    await actualizarRow(raiz, database, filaLeida.valor, filaLeida.hash, {
      valores: [...filaLeida.valor.valores, { propertyId: "prioridad", valor: "baja" }],
    });

    // "database"/"hash" quedaron con la vista vieja de la Database (antes de que
    // otro agente le cambiara el título) — la promoción en sí sería válida (todas
    // las Rows ya tienen valor), pero el hash pasado ya no coincide con el disco.
    await actualizarDatabase(raiz, database, hash, { titulo: "Cambiado por otro agente" });

    await expect(promoverPropertyARequerida(raiz, database, hash, "prioridad")).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, database.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades.find((p) => p.id === "prioridad")!.requerida).toBe(false); // sin cambios
  });

  test("regresión (hallazgo de revisión): una Row real pero inválida contra el esquema actual por una razón AJENA sigue contando como faltante", async () => {
    // Property "reused" (texto, no requerida) con una Row que le pone un valor string.
    let db = await crearDatabase(raiz, { titulo: "t", parentId: null, propiedades: [propTexto("reused")] });
    const filaInvalidada = await crearRow(raiz, db.valor, { titulo: "filaA", valores: [{ propertyId: "reused", valor: "hola" }] });

    // quitarProperty siempre tiene éxito (ADR-006 sección 3): el valor de filaA queda huérfano.
    db = await quitarProperty(raiz, db.valor, db.hash, "reused");

    // Re-agregar "reused" con OTRO tipo (numero): el valor huérfano string ya
    // no matchea el tipo nuevo -> TIPO_INVALIDO fatal para filaA contra el
    // índice de T-0018, aunque el archivo de filaA sigue existiendo tal cual
    // en disco y nunca tuvo (ni podía tener) valor para "prioridad".
    db = await agregarProperty(raiz, db.valor, db.hash, { id: "reused", nombre: "reused", tipo: "numero", requerida: false });
    db = await agregarProperty(raiz, db.valor, db.hash, propTexto("prioridad", false));

    let capturado: PromocionFallida | undefined;
    try {
      await promoverPropertyARequerida(raiz, db.valor, db.hash, "prioridad");
    } catch (error) {
      if (error instanceof PromocionFallida) capturado = error;
      else throw error;
    }
    expect(capturado).toBeDefined();
    expect(capturado!.totalFaltantes).toBe(1);
    expect(capturado!.rowsFaltantes.map((r) => r.id)).toEqual([filaInvalidada.valor.id]);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades.find((p) => p.id === "prioridad")!.requerida).toBe(false); // sin cambios
  });

  test("un conflicto real se reporta también en el no-op (property ya requerida, pero el hash quedó viejo) — regresión del Hallazgo 1", async () => {
    const db = await crearDatabase(raiz, { titulo: "titulo original", parentId: null, propiedades: [propTexto("p1", true)] });

    // Otro agente actualiza la Database (escritura real, el hash en disco cambia)
    // mientras este llamador todavía tiene en memoria el hash de antes de ese cambio.
    await actualizarDatabase(raiz, db.valor, db.hash, { titulo: "titulo cambiado por otro agente" });

    // "p1" ya es requerida, así que esto entra por el camino no-op — pero el
    // hash que se pasa ("db.hash") ya no coincide con el archivo real: debe
    // fallar igual que cualquier otra escritura con CAS, nunca devolver el
    // estado stale en silencio.
    await expect(promoverPropertyARequerida(raiz, db.valor, db.hash, "p1")).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("titulo cambiado por otro agente"); // el cambio real no se pisó
  });
});

describe("quitarProperty (ADR-006 sección 3): nunca falla por las Rows, nunca borra el huérfano", () => {
  test("quitar una Property con Rows existentes tiene éxito, y la Row conserva su PropertyValue huérfano", async () => {
    const db = await crearDatabase(raiz, { titulo: "tareas", parentId: null, propiedades: [propTexto("p1"), propTexto("p2")] });
    const fila = await crearRow(raiz, db.valor, {
      titulo: "fila",
      valores: [
        { propertyId: "p1", valor: "x" },
        { propertyId: "p2", valor: "y" },
      ],
    });

    const dbSinP2 = await quitarProperty(raiz, db.valor, db.hash, "p2");
    expect(dbSinP2.valor.propiedades.map((p) => p.id)).toEqual(["p1"]);

    // El archivo de la Database ya no declara "p2"...
    const dbLeida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(dbLeida)) throw new Error("no debería fallar");
    expect(dbLeida.valor.propiedades.map((p) => p.id)).toEqual(["p1"]);

    // ...pero la Row sigue teniendo, tal cual, el PropertyValue de "p2" — ahora huérfano.
    const filaLeida = await leerRow(raiz, dbSinP2.valor, fila.valor.id);
    if (esErrorDeLectura(filaLeida)) throw new Error("no debería fallar");
    expect(filaLeida.valor.valores).toEqual([
      { propertyId: "p1", valor: "x" },
      { propertyId: "p2", valor: "y" },
    ]);
    expect(filaLeida.advertencias.some((a) => a.codigo === "PROPERTY_VALUE_HUERFANO" && a.propertyId === "p2")).toBe(true);
  });

  test("property inexistente: PropertyNoEncontrada", async () => {
    const db = await crearDatabase(raiz, { titulo: "x", parentId: null });
    await expect(quitarProperty(raiz, db.valor, db.hash, "no-existe")).rejects.toBeInstanceOf(PropertyNoEncontrada);
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [propTexto("p1")] });
    await actualizarDatabase(raiz, db.valor, db.hash, { titulo: "Cambiado por otro agente" });

    await expect(quitarProperty(raiz, db.valor, db.hash, "p1")).rejects.toBeInstanceOf(ConflictoDeEscritura);

    const leida = await leerDatabase(raiz, db.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.propiedades.map((p) => p.id)).toEqual(["p1"]); // sin cambios
  });
});
