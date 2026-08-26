/**
 * Tests de `../src/sync/reporte.ts` (T-0012). Solo verifica el
 * agrupamiento/conteo que agrega `sincronizarWorkspace` sobre un `Indice` ya
 * construido — no reimplementa ninguna validación de ADR-002 sección 5
 * (eso ya lo prueba `indice-construccion.test.ts`). Mismo patrón de fixture
 * que ese archivo: se escriben los nodos con el motor real de T-0017
 * (`escribirPage`/`escribirDatabase`/`escribirRow`, `hashEsperado: null`)
 * sobre un directorio temporal real.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escribirDatabase, escribirPage, escribirRow } from "../src/almacenamiento/escritura.ts";
import { sincronizarWorkspace } from "../src/sync/reporte.ts";
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
  raiz = await mkdtemp(join(tmpdir(), "nido-core-sync-reporte-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("sincronizarWorkspace", () => {
  test("árbol sano: conteos correctos por tipo, sin diagnósticos, sano === true", async () => {
    const pagina = crearPage({ id: "p-1", parentId: null });
    const db = crearDatabase({ id: "db-1", parentId: null });
    const fila = crearRow({ id: "row-1", parentId: "db-1" });

    await escribirPage(raiz, "p-1.md", pagina, null);
    await escribirDatabase(raiz, "db-1.json", db, null);
    await escribirRow(raiz, "row-1.json", fila, null);

    const reporte = await sincronizarWorkspace(raiz);

    expect(reporte.raiz).toBe(raiz);
    expect(reporte.nodosValidos).toEqual({ paginas: 1, databases: 1, filas: 1 });
    expect(reporte.diagnosticos.errores).toEqual([]);
    expect(reporte.diagnosticos.advertencias).toEqual([]);
    expect(reporte.huerfanos).toEqual([]);
    expect(reporte.sano).toBe(true);
  });

  test("un parent_id colgante se cuenta como huérfano, separado del resto de errores, y sano === false", async () => {
    const huerfano = crearPage({ id: "huerfano", parentId: "no-existe" });
    const valido = crearPage({ id: "valido", parentId: null });

    await escribirPage(raiz, "huerfano.md", huerfano, null);
    await escribirPage(raiz, "valido.md", valido, null);

    const reporte = await sincronizarWorkspace(raiz);

    expect(reporte.nodosValidos.paginas).toBe(1); // solo "valido" quedó indexado
    expect(reporte.sano).toBe(false);
    expect(reporte.huerfanos).toHaveLength(1);
    expect(reporte.huerfanos[0]!.error.codigo).toBe("PARENT_ID_INVALIDO");
    expect(reporte.huerfanos[0]!.error.nodoId).toBe("huerfano");

    // El huérfano también aparece en `diagnosticos.errores` (subconjunto, no
    // categoría excluyente — ver comentario de `ReporteSincronizacion`).
    expect(reporte.diagnosticos.errores.some((d) => d.error.nodoId === "huerfano")).toBe(true);
    expect(reporte.diagnosticos.advertencias).toEqual([]);
  });

  test("dos archivos con el mismo id (ID_DUPLICADO) cuentan como error pero no como huérfano", async () => {
    const pageA = crearPage({ id: "dup", parentId: null, titulo: "A" });
    const pageB = crearPage({ id: "dup", parentId: null, titulo: "B" });

    await escribirPage(raiz, "dir-a/dup.md", pageA, null);
    await escribirPage(raiz, "dir-b/dup.md", pageB, null);

    const reporte = await sincronizarWorkspace(raiz);

    expect(reporte.nodosValidos.paginas).toBe(0);
    expect(reporte.sano).toBe(false);
    expect(reporte.huerfanos).toEqual([]); // ID_DUPLICADO no es PARENT_ID_INVALIDO
    expect(reporte.diagnosticos.errores.some((d) => d.error.codigo === "ID_DUPLICADO")).toBe(true);
  });

  test("un ciclo en parent_id cuenta como error, no como huérfano, y no afecta al resto del árbol", async () => {
    const a = crearPage({ id: "nodo-a", parentId: "nodo-b" });
    const b = crearPage({ id: "nodo-b", parentId: "nodo-a" });
    const valido = crearPage({ id: "valido", parentId: null });

    await escribirPage(raiz, "nodo-a.md", a, null);
    await escribirPage(raiz, "nodo-b.md", b, null);
    await escribirPage(raiz, "valido.md", valido, null);

    const reporte = await sincronizarWorkspace(raiz);

    expect(reporte.nodosValidos.paginas).toBe(1); // solo "valido"
    expect(reporte.sano).toBe(false);
    expect(reporte.huerfanos).toEqual([]);
    const codigos = reporte.diagnosticos.errores.map((d) => d.error.codigo);
    expect(codigos.filter((c) => c === "CICLO_EN_CONTENCION")).toHaveLength(2);
  });

  test("un PropertyValue huérfano es una advertencia, no un error, y no afecta a `sano`", async () => {
    const db = crearDatabase({ id: "db-1", propiedades: [] });
    const fila = crearRow({ id: "row-1", parentId: "db-1", valores: [{ propertyId: "ya-no-existe", valor: "x" }] });

    await escribirDatabase(raiz, "db-1.json", db, null);
    await escribirRow(raiz, "row-1.json", fila, null);

    const reporte = await sincronizarWorkspace(raiz);

    expect(reporte.nodosValidos.filas).toBe(1); // la advertencia no excluye la Row
    expect(reporte.sano).toBe(true); // solo errores afectan `sano`
    expect(reporte.diagnosticos.errores).toEqual([]);
    expect(reporte.diagnosticos.advertencias).toHaveLength(1);
    expect(reporte.diagnosticos.advertencias[0]!.error.codigo).toBe("PROPERTY_VALUE_HUERFANO");
  });

  test("workspace vacío: conteos en cero, sin diagnósticos, sano === true", async () => {
    const reporte = await sincronizarWorkspace(raiz);

    expect(reporte.nodosValidos).toEqual({ paginas: 0, databases: 0, filas: 0 });
    expect(reporte.diagnosticos.errores).toEqual([]);
    expect(reporte.diagnosticos.advertencias).toEqual([]);
    expect(reporte.huerfanos).toEqual([]);
    expect(reporte.sano).toBe(true);
  });
});
