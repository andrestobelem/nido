import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PathFueraDelWorkspace } from "../src/almacenamiento/confinamiento.ts";
import { esErrorDeLectura, leerDatabase, leerPage, leerRow, NodoNoEncontrado } from "../src/almacenamiento/lectura.ts";
import { serializarDatabase, serializarRow } from "../src/formato/database-row.ts";
import { serializarPage } from "../src/formato/page.ts";
import type { ErrorValidacion } from "../src/invariantes.ts";
import type { Database, Page, Property, Row } from "../src/types.ts";

const CREADO = "2026-08-26T00:00:00.000Z";
const ACTUALIZADO = "2026-08-26T01:30:00.000Z";

function crearPage(overrides: Partial<Page> = {}): Page {
  return {
    id: "pagina-1",
    tipo: "pagina",
    parentId: null,
    titulo: "Una página",
    cuerpo: "hola",
    creadoEn: CREADO,
    actualizadoEn: ACTUALIZADO,
    ...overrides,
  };
}

function crearDatabase(overrides: Partial<Database> = {}): Database {
  return {
    id: "db-1",
    tipo: "pagina",
    parentId: null,
    titulo: "una database",
    propiedades: [],
    vistas: [],
    creadoEn: CREADO,
    actualizadoEn: ACTUALIZADO,
    ...overrides,
  };
}

function crearRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    tipo: "fila",
    parentId: "db-1",
    titulo: "una fila",
    creadoEn: CREADO,
    actualizadoEn: ACTUALIZADO,
    valores: [],
    ...overrides,
  };
}

function propTexto(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "texto", requerida };
}

function codigos(errores: ErrorValidacion[]): string[] {
  return errores.map((e) => e.codigo);
}

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-lectura-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("leerPage", () => {
  test("lee y valida una Page escrita previamente: éxito", async () => {
    const page = crearPage();
    await Bun.write(join(raiz, "pagina-1.md"), serializarPage(page));

    const resultado = await leerPage(raiz, "pagina-1.md");
    expect(esErrorDeLectura(resultado)).toBe(false);
    if (esErrorDeLectura(resultado)) throw new Error("no debería fallar");
    expect(resultado.valor).toEqual(page);
    expect(resultado.advertencias).toEqual([]);
    expect(typeof resultado.hash).toBe("bigint");
  });

  test("rechaza un encabezado malformado (parseo total, punto 2/3 del checklist)", async () => {
    await Bun.write(join(raiz, "pagina-1.md"), "esto no tiene encabezado en absoluto");

    const resultado = await leerPage(raiz, "pagina-1.md");
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ENCABEZADO_INVALIDO"]);
  });

  test("rechaza cuando el id del contenido no coincide con el id del nombre de archivo (punto 4)", async () => {
    const page = crearPage({ id: "otro-id" });
    await Bun.write(join(raiz, "pagina-1.md"), serializarPage(page));

    const resultado = await leerPage(raiz, "pagina-1.md");
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ID_NO_COINCIDE_CON_ARCHIVO"]);
  });

  test("lanza NodoNoEncontrado si el archivo no existe", async () => {
    await expect(leerPage(raiz, "no-existe.md")).rejects.toBeInstanceOf(NodoNoEncontrado);
  });

  test("propaga el rechazo de confinamiento de path (punto 1) sin llegar a intentar parsear", async () => {
    await expect(leerPage(raiz, "../fuera.md")).rejects.toBeInstanceOf(PathFueraDelWorkspace);
  });
});

describe("leerDatabase", () => {
  test("lee y valida una Database escrita previamente: éxito", async () => {
    const db = crearDatabase({ propiedades: [propTexto("p1")] });
    await Bun.write(join(raiz, "db-1.json"), serializarDatabase(db));

    const resultado = await leerDatabase(raiz, "db-1.json");
    expect(esErrorDeLectura(resultado)).toBe(false);
    if (esErrorDeLectura(resultado)) throw new Error("no debería fallar");
    expect(resultado.valor).toEqual(db);
    expect(resultado.advertencias).toEqual([]);
  });

  test("rechaza JSON inválido (parseo total)", async () => {
    await Bun.write(join(raiz, "db-1.json"), "{ esto no es json valido");

    const resultado = await leerDatabase(raiz, "db-1.json");
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ESTRUCTURA_INVALIDA"]);
  });

  test("rechaza cuando el id del contenido no coincide con el id del nombre de archivo (punto 4)", async () => {
    const db = crearDatabase({ id: "otro-id" });
    await Bun.write(join(raiz, "db-1.json"), serializarDatabase(db));

    const resultado = await leerDatabase(raiz, "db-1.json");
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ID_NO_COINCIDE_CON_ARCHIVO"]);
  });

  test("lanza NodoNoEncontrado si el archivo no existe", async () => {
    await expect(leerDatabase(raiz, "no-existe.json")).rejects.toBeInstanceOf(NodoNoEncontrado);
  });
});

describe("leerRow", () => {
  test("lee y valida una Row contra el esquema de su Database: éxito (punto 8)", async () => {
    const db = crearDatabase({ propiedades: [propTexto("p1", true)] });
    const row = crearRow({ valores: [{ propertyId: "p1", valor: "hola" }] });
    await Bun.write(join(raiz, "row-1.json"), serializarRow(row));

    const resultado = await leerRow(raiz, "row-1.json", db);
    expect(esErrorDeLectura(resultado)).toBe(false);
    if (esErrorDeLectura(resultado)) throw new Error("no debería fallar");
    expect(resultado.valor).toEqual(row);
    expect(resultado.advertencias).toEqual([]);
  });

  test("rechaza (fatal) cuando el tipo de un PropertyValue no coincide con el de su Property (punto 8)", async () => {
    const db = crearDatabase({ propiedades: [{ id: "n1", nombre: "n1", tipo: "numero", requerida: false }] });
    const row = crearRow({ valores: [{ propertyId: "n1", valor: "no es un numero" as unknown as number }] });
    await Bun.write(join(raiz, "row-1.json"), serializarRow(row));

    const resultado = await leerRow(raiz, "row-1.json", db);
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["TIPO_INVALIDO"]);
  });

  test("rechaza (fatal) cuando falta un valor para una Property requerida (punto 8)", async () => {
    const db = crearDatabase({ propiedades: [propTexto("p1", true)] });
    const row = crearRow({ valores: [] });
    await Bun.write(join(raiz, "row-1.json"), serializarRow(row));

    const resultado = await leerRow(raiz, "row-1.json", db);
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["PROPERTY_REQUERIDA_SIN_VALOR"]);
  });

  test("un PropertyValue huérfano es una advertencia, no rechaza la Row (punto 8, ADR-006)", async () => {
    const db = crearDatabase({ propiedades: [] });
    const row = crearRow({ valores: [{ propertyId: "ya-no-existe", valor: "algo" }] });
    await Bun.write(join(raiz, "row-1.json"), serializarRow(row));

    const resultado = await leerRow(raiz, "row-1.json", db);
    expect(esErrorDeLectura(resultado)).toBe(false);
    if (esErrorDeLectura(resultado)) throw new Error("no debería fallar");
    expect(resultado.valor).toEqual(row);
    expect(codigos(resultado.advertencias)).toEqual(["PROPERTY_VALUE_HUERFANO"]);
  });

  test("rechaza cuando el id del contenido no coincide con el id del nombre de archivo (punto 4), antes incluso de mirar el esquema", async () => {
    const db = crearDatabase();
    const row = crearRow({ id: "otro-id" });
    await Bun.write(join(raiz, "row-1.json"), serializarRow(row));

    const resultado = await leerRow(raiz, "row-1.json", db);
    expect(esErrorDeLectura(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ID_NO_COINCIDE_CON_ARCHIVO"]);
  });

  test("lanza NodoNoEncontrado si el archivo no existe", async () => {
    await expect(leerRow(raiz, "no-existe.json", crearDatabase())).rejects.toBeInstanceOf(NodoNoEncontrado);
  });
});
