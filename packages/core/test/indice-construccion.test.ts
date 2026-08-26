/**
 * Tests de `../src/indice/construccion.ts` (T-0018, puntos 1/2/5/6/7/9 del
 * alcance). Los archivos de fixture se escriben siempre con el motor real
 * de T-0017 (`escribirPage`/`escribirDatabase`/`escribirRow`, con
 * `hashEsperado: null` — creación) sobre un directorio temporal real, nunca
 * a mano con un formato distinto al que producen T-0015/T-0016/T-0017.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escribirDatabase, escribirPage, escribirRow } from "../src/almacenamiento/escritura.ts";
import { construirIndice } from "../src/indice/construccion.ts";
import type { Database, Page, Row } from "../src/types.ts";

const CREADO = "2026-08-26T00:00:00.000Z";
const ACTUALIZADO = "2026-08-26T01:00:00.000Z";

function crearPage(overrides: Partial<Page> = {}): Page {
  return {
    id: "pagina-1",
    tipo: "pagina",
    parentId: null,
    titulo: "Una pagina",
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

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-indice-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("construirIndice", () => {
  test("escanea un árbol válido con Page/Database/Row anidados y puebla el índice", async () => {
    const root = crearPage({ id: "root", parentId: null, titulo: "Raíz" });
    const sub = crearPage({ id: "sub", parentId: "root", titulo: "Sub página" });
    const db = crearDatabase({
      id: "db-1",
      parentId: "root",
      propiedades: [{ id: "p1", nombre: "nombre", tipo: "texto", requerida: true }],
    });
    const row = crearRow({ id: "row-1", parentId: "db-1", valores: [{ propertyId: "p1", valor: "hola" }] });

    await escribirPage(raiz, "root.md", root, null);
    await escribirPage(raiz, "sub.md", sub, null);
    await escribirDatabase(raiz, "db-1.json", db, null);
    await escribirRow(raiz, "row-1.json", row, null);

    const indice = await construirIndice(raiz);

    expect(indice.diagnosticos).toEqual([]);
    expect(indice.paginas.size).toBe(2);
    expect(indice.databases.size).toBe(1);
    expect(indice.filas.size).toBe(1);
    expect(indice.paginas.get("root")?.valor).toEqual(root);
    expect(indice.paginas.get("sub")?.valor).toEqual(sub);
    expect(indice.databases.get("db-1")?.valor).toEqual(db);
    expect(indice.filas.get("row-1")?.valor).toEqual(row);

    // El índice sqlite también quedó poblado (consultable) — no solo los mapas en memoria.
    const filasEnSqlite = indice.sqlite.query("SELECT id FROM nodos WHERE tipo = 'fila'").all() as { id: string }[];
    expect(filasEnSqlite.map((f) => f.id)).toEqual(["row-1"]);
  });

  test("dos archivos con el mismo id: se reporta el conflicto y ninguno gana en silencio", async () => {
    const pageA = crearPage({ id: "dup", parentId: null, titulo: "Versión A" });
    const pageB = crearPage({ id: "dup", parentId: null, titulo: "Versión B" });

    await escribirPage(raiz, "dir-a/dup.md", pageA, null);
    await escribirPage(raiz, "dir-b/dup.md", pageB, null);

    const indice = await construirIndice(raiz);

    // Ninguna de las dos versiones "gana": el id queda totalmente excluido.
    expect(indice.paginas.has("dup")).toBe(false);

    const errorDup = indice.diagnosticos.find((d) => d.error.codigo === "ID_DUPLICADO");
    expect(errorDup).toBeDefined();
    expect(errorDup!.error.severidad).toBe("error");
    expect(errorDup!.paths.slice().sort()).toEqual([join("dir-a", "dup.md"), join("dir-b", "dup.md")].sort());
  });

  test("un parent_id colgante deja ese nodo excluido/marcado, pero el resto del árbol se indexa igual", async () => {
    const huerfano = crearPage({ id: "huerfano", parentId: "no-existe", titulo: "Huérfano" });
    const valido = crearPage({ id: "valido", parentId: null, titulo: "Válido" });

    await escribirPage(raiz, "huerfano.md", huerfano, null);
    await escribirPage(raiz, "valido.md", valido, null);

    const indice = await construirIndice(raiz);

    expect(indice.paginas.has("huerfano")).toBe(false);
    expect(indice.paginas.get("valido")?.valor).toEqual(valido);

    const errorHuerfano = indice.diagnosticos.find((d) => d.error.codigo === "PARENT_ID_INVALIDO" && d.error.nodoId === "huerfano");
    expect(errorHuerfano).toBeDefined();
    expect(errorHuerfano!.paths).toEqual(["huerfano.md"]);
  });

  test("orfandad en cascada: un hijo de un nodo huérfano también queda excluido", async () => {
    const huerfano = crearPage({ id: "huerfano", parentId: "no-existe", titulo: "Huérfano" });
    const hijo = crearPage({ id: "hijo", parentId: "huerfano", titulo: "Hijo del huérfano" });
    const valido = crearPage({ id: "valido", parentId: null, titulo: "Válido" });

    await escribirPage(raiz, "huerfano.md", huerfano, null);
    await escribirPage(raiz, "hijo.md", hijo, null);
    await escribirPage(raiz, "valido.md", valido, null);

    const indice = await construirIndice(raiz);

    expect(indice.paginas.has("huerfano")).toBe(false);
    expect(indice.paginas.has("hijo")).toBe(false);
    expect(indice.paginas.get("valido")?.valor).toEqual(valido);
  });

  test("una Row cuyo parent_id no resuelve a una Database válida queda excluida sin abortar el resto", async () => {
    const db = crearDatabase({ id: "db-1", propiedades: [] });
    const rowHuerfana = crearRow({ id: "row-huerfana", parentId: "no-existe" });
    const rowValida = crearRow({ id: "row-valida", parentId: "db-1" });

    await escribirDatabase(raiz, "db-1.json", db, null);
    await escribirRow(raiz, "row-huerfana.json", rowHuerfana, null);
    await escribirRow(raiz, "row-valida.json", rowValida, null);

    const indice = await construirIndice(raiz);

    expect(indice.filas.has("row-huerfana")).toBe(false);
    expect(indice.filas.get("row-valida")?.valor).toEqual(rowValida);
    const errorRow = indice.diagnosticos.find((d) => d.error.codigo === "PARENT_ID_INVALIDO" && d.error.rowId === "row-huerfana");
    expect(errorRow).toBeDefined();
  });

  test("un ciclo en parent_id excluye a los nodos del ciclo, pero indexa el resto del árbol igual", async () => {
    const a = crearPage({ id: "nodo-a", parentId: "nodo-b", titulo: "A" });
    const b = crearPage({ id: "nodo-b", parentId: "nodo-a", titulo: "B" });
    const valido = crearPage({ id: "valido", parentId: null, titulo: "Válido" });

    await escribirPage(raiz, "nodo-a.md", a, null);
    await escribirPage(raiz, "nodo-b.md", b, null);
    await escribirPage(raiz, "valido.md", valido, null);

    const indice = await construirIndice(raiz);

    expect(indice.paginas.has("nodo-a")).toBe(false);
    expect(indice.paginas.has("nodo-b")).toBe(false);
    expect(indice.paginas.get("valido")?.valor).toEqual(valido);

    const idsEnCiclo = new Set(
      indice.diagnosticos.filter((d) => d.error.codigo === "CICLO_EN_CONTENCION").map((d) => d.error.nodoId),
    );
    expect(idsEnCiclo).toEqual(new Set(["nodo-a", "nodo-b"]));
  });

  test("un ciclo de 3 nodos también se detecta y excluye completo", async () => {
    const a = crearPage({ id: "c-a", parentId: "c-b", titulo: "A" });
    const b = crearPage({ id: "c-b", parentId: "c-c", titulo: "B" });
    const c = crearPage({ id: "c-c", parentId: "c-a", titulo: "C" });

    await escribirPage(raiz, "c-a.md", a, null);
    await escribirPage(raiz, "c-b.md", b, null);
    await escribirPage(raiz, "c-c.md", c, null);

    const indice = await construirIndice(raiz);

    expect(indice.paginas.size).toBe(0);
    const idsEnCiclo = new Set(
      indice.diagnosticos.filter((d) => d.error.codigo === "CICLO_EN_CONTENCION").map((d) => d.error.nodoId),
    );
    expect(idsEnCiclo).toEqual(new Set(["c-a", "c-b", "c-c"]));
  });

  test("un archivo de Page con encabezado inválido se excluye y se reporta, sin abortar el escaneo", async () => {
    const valido = crearPage({ id: "valido", parentId: null, titulo: "Válido" });
    await escribirPage(raiz, "valido.md", valido, null);
    await Bun.write(join(raiz, "roto.md"), "esto no tiene encabezado de Page en absoluto");

    const indice = await construirIndice(raiz);

    expect(indice.paginas.get("valido")?.valor).toEqual(valido);
    expect(indice.paginas.has("roto")).toBe(false);
    const errorRoto = indice.diagnosticos.find((d) => d.paths.includes("roto.md"));
    expect(errorRoto?.error.codigo).toBe("ENCABEZADO_INVALIDO");
  });

  test("un archivo .json con contenido no-JSON se excluye y se reporta, sin abortar el escaneo", async () => {
    const valido = crearPage({ id: "valido", parentId: null, titulo: "Válido" });
    await escribirPage(raiz, "valido.md", valido, null);
    await Bun.write(join(raiz, "roto.json"), "{ esto no es json valido");

    const indice = await construirIndice(raiz);

    expect(indice.paginas.get("valido")?.valor).toEqual(valido);
    const errorRoto = indice.diagnosticos.find((d) => d.paths.includes("roto.json"));
    expect(errorRoto?.error.codigo).toBe("ESTRUCTURA_INVALIDA");
  });

  test("un archivo .json cuyo campo tipo no es 'pagina' ni 'fila' se excluye y se reporta, sin abortar el escaneo", async () => {
    const valido = crearPage({ id: "valido", parentId: null, titulo: "Válido" });
    await escribirPage(raiz, "valido.md", valido, null);
    await Bun.write(join(raiz, "ambiguo.json"), JSON.stringify({ id: "ambiguo", tipo: "algo-desconocido" }));

    const indice = await construirIndice(raiz);

    expect(indice.paginas.get("valido")?.valor).toEqual(valido);
    expect(indice.databases.has("ambiguo")).toBe(false);
    expect(indice.filas.has("ambiguo")).toBe(false);
    const errorAmbiguo = indice.diagnosticos.find((d) => d.paths.includes("ambiguo.json"));
    expect(errorAmbiguo?.error.codigo).toBe("ESTRUCTURA_INVALIDA");
  });

  test("un PropertyValue huérfano en una Row es una advertencia: la Row igual se indexa", async () => {
    const db = crearDatabase({ id: "db-1", propiedades: [] });
    const row = crearRow({ id: "row-1", parentId: "db-1", valores: [{ propertyId: "ya-no-existe", valor: "x" }] });

    await escribirDatabase(raiz, "db-1.json", db, null);
    await escribirRow(raiz, "row-1.json", row, null);

    const indice = await construirIndice(raiz);

    expect(indice.filas.get("row-1")?.valor).toEqual(row);
    const advertencia = indice.diagnosticos.find((d) => d.error.codigo === "PROPERTY_VALUE_HUERFANO");
    expect(advertencia).toBeDefined();
    expect(advertencia!.error.severidad).toBe("advertencia");
  });
});
