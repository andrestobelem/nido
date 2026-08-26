/**
 * Tests de `../src/indice/vistas.ts` (T-0018, punto 4 del alcance,
 * ADR-004). Un único workspace de fixture (escrito con el motor real de
 * T-0017) sirve a todos los tests de este archivo: una Database con
 * Properties `select`, `multi_select` y `numero`, y siete Rows elegidas
 * para cubrir a propósito los casos de borde de ADR-004 — valores
 * presentes, ausentes por completo, y presentes-pero-vacíos.
 */

import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escribirDatabase, escribirRow } from "../src/almacenamiento/escritura.ts";
import { construirIndice } from "../src/indice/construccion.ts";
import { esErrorDeConsulta, resolverConsulta, resolverVista } from "../src/indice/vistas.ts";
import type { Database, Grupo, OrdenCampo, Row, View } from "../src/types.ts";
import type { Indice } from "../src/indice/tipos.ts";

const CREADO = "2026-08-26T00:00:00.000Z";
const ACTUALIZADO = "2026-08-26T01:00:00.000Z";

const DATABASE: Database = {
  id: "db-tareas",
  tipo: "pagina",
  parentId: null,
  titulo: "Tareas",
  creadoEn: CREADO,
  actualizadoEn: ACTUALIZADO,
  propiedades: [
    {
      id: "p-estado",
      nombre: "Estado",
      tipo: "select",
      requerida: false,
      config: {
        opciones: [
          { id: "o-abierto", nombre: "Abierto" },
          { id: "o-cerrado", nombre: "Cerrado" },
        ],
      },
    },
    {
      id: "p-etiquetas",
      nombre: "Etiquetas",
      tipo: "multi_select",
      requerida: false,
      config: {
        opciones: [
          { id: "e-urgente", nombre: "Urgente" },
          { id: "e-interno", nombre: "Interno" },
        ],
      },
    },
    { id: "p-prioridad", nombre: "Prioridad", tipo: "numero", requerida: false },
  ],
  vistas: [],
};

function fila(id: string, titulo: string, valores: Row["valores"]): Row {
  return { id, tipo: "fila", parentId: DATABASE.id, titulo, creadoEn: CREADO, actualizadoEn: ACTUALIZADO, valores };
}

const ROW_1 = fila("row-1", "Row Uno", [
  { propertyId: "p-estado", valor: "o-abierto" },
  { propertyId: "p-etiquetas", valor: ["e-urgente"] },
  { propertyId: "p-prioridad", valor: 10 },
]);
const ROW_2 = fila("row-2", "Row Dos", [
  { propertyId: "p-estado", valor: "o-cerrado" },
  { propertyId: "p-etiquetas", valor: ["e-interno"] },
  { propertyId: "p-prioridad", valor: 5 },
]);
// Etiquetas presente-pero-vacío, y sin ningún PropertyValue de prioridad (ausencia real, no "vacío").
const ROW_3 = fila("row-3", "Row Tres", [
  { propertyId: "p-estado", valor: "o-abierto" },
  { propertyId: "p-etiquetas", valor: [] },
]);
// Sin ningún PropertyValue de estado en absoluto (ausencia real).
const ROW_4 = fila("row-4", "Row Cuatro", [
  { propertyId: "p-etiquetas", valor: ["e-urgente", "e-interno"] },
  { propertyId: "p-prioridad", valor: 20 },
]);
// Sin ningún PropertyValue de etiquetas en absoluto (ausencia real, distinta del array vacío de ROW_3).
const ROW_5 = fila("row-5", "Row Cinco", [{ propertyId: "p-estado", valor: "o-cerrado" }]);
const ROW_6 = fila("row-6", "Row Seis", [
  { propertyId: "p-estado", valor: "o-abierto" },
  { propertyId: "p-etiquetas", valor: ["e-interno"] },
  { propertyId: "p-prioridad", valor: 1 },
]);
const ROW_7 = fila("row-7", "Row Siete", [
  { propertyId: "p-estado", valor: "o-abierto" },
  { propertyId: "p-etiquetas", valor: [] },
  { propertyId: "p-prioridad", valor: 20 },
]);
const TODAS_LAS_ROWS = [ROW_1, ROW_2, ROW_3, ROW_4, ROW_5, ROW_6, ROW_7];

let raiz: string;
let indice: Indice;

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-vistas-"));
  await escribirDatabase(raiz, `${DATABASE.id}.json`, DATABASE, null);
  for (const row of TODAS_LAS_ROWS) {
    await escribirRow(raiz, `${row.id}.json`, row, null);
  }
  indice = await construirIndice(raiz);
});

afterAll(async () => {
  await rm(raiz, { recursive: true, force: true });
});

function idsDe(filas: Row[]): string[] {
  return filas.map((f) => f.id).sort();
}

function resolver(filtros: Grupo | null, orden: OrdenCampo[] = []) {
  const resultado = resolverConsulta(indice, DATABASE, { filtros, orden });
  if (esErrorDeConsulta(resultado)) throw new Error(`la consulta no debería fallar: ${JSON.stringify(resultado)}`);
  return resultado;
}

describe("resolverConsulta: sanity del fixture", () => {
  test("el índice quedó poblado sin diagnósticos fatales y con las 7 rows", () => {
    expect(indice.filas.size).toBe(7);
    expect(indice.diagnosticos.filter((d) => d.error.severidad === "error")).toEqual([]);
  });
});

describe("resolverConsulta: filtro simple (igualdad)", () => {
  test("select igual: solo las rows con esa opción, nunca las que no tienen el valor en absoluto", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-abierto" }],
    };
    const resultado = resolver(filtros);
    expect(idsDe(resultado.filas)).toEqual(["row-1", "row-3", "row-6", "row-7"]);
  });
});

describe("resolverConsulta: Grupo con AND", () => {
  test("estado=abierto AND prioridad>5: exige ambas condiciones, ausencia de prioridad no matchea", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [
        { campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-abierto" },
        { campo: { tipo: "propiedad", propertyId: "p-prioridad" }, operador: "mayor_que", valor: 5 },
      ],
    };
    const resultado = resolver(filtros);
    expect(idsDe(resultado.filas)).toEqual(["row-1", "row-7"]);
  });
});

describe("resolverConsulta: Grupo con OR", () => {
  test("estado=abierto OR estado=cerrado: cualquiera de las dos, nunca la que no tiene estado", () => {
    const filtros: Grupo = {
      combinador: "o",
      condiciones: [
        { campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-abierto" },
        { campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-cerrado" },
      ],
    };
    const resultado = resolver(filtros);
    expect(idsDe(resultado.filas)).toEqual(["row-1", "row-2", "row-3", "row-5", "row-6", "row-7"]);
  });
});

describe("resolverConsulta: Grupo anidado de profundidad 2", () => {
  test("estado=abierto AND (prioridad>15 OR etiquetas contiene interno)", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [
        { campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-abierto" },
        {
          combinador: "o",
          condiciones: [
            { campo: { tipo: "propiedad", propertyId: "p-prioridad" }, operador: "mayor_que", valor: 15 },
            { campo: { tipo: "propiedad", propertyId: "p-etiquetas" }, operador: "contiene", valor: "e-interno" },
          ],
        },
      ],
    };
    const resultado = resolver(filtros);
    // row-1 (prioridad 10, sin e-interno) y row-3 (sin prioridad, sin e-interno) quedan afuera del OR anidado.
    expect(idsDe(resultado.filas)).toEqual(["row-6", "row-7"]);
  });

  test("un Grupo de profundidad 3 se rechaza en validación, nunca llega a traducirse", () => {
    const filtrosProfundidad3: unknown = {
      combinador: "y",
      condiciones: [
        {
          combinador: "o",
          condiciones: [
            {
              combinador: "y",
              condiciones: [{ campo: { tipo: "campo_base", campo: "titulo" }, operador: "igual", valor: "x" }],
            },
          ],
        },
      ],
    };
    const resultado = resolverConsulta(indice, DATABASE, { filtros: filtrosProfundidad3 as Grupo, orden: [] });
    expect(esErrorDeConsulta(resultado)).toBe(true);
  });
});

describe("resolverConsulta: filtro sobre multi_select", () => {
  test("contiene: solo las rows que efectivamente incluyen esa opción", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-etiquetas" }, operador: "contiene", valor: "e-interno" }],
    };
    const resultado = resolver(filtros);
    expect(idsDe(resultado.filas)).toEqual(["row-2", "row-4", "row-6"]);
  });
});

describe("resolverConsulta: operador negativo sin exclusión por NULL", () => {
  test("no_contiene (multi_select) incluye las rows sin la opción, con array vacío, Y sin ningún valor en absoluto", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-etiquetas" }, operador: "no_contiene", valor: "e-urgente" }],
    };
    const resultado = resolver(filtros);
    // row-1 y row-4 sí contienen "e-urgente" -> excluidas. El resto -incluida
    // row-3 (etiquetas: []) y row-5 (sin PropertyValue de etiquetas en
    // absoluto)- tiene que aparecer: son justamente el caso que la
    // propagación NULL por defecto de SQL excluiría por error (ADR-004
    // sección 2).
    expect(idsDe(resultado.filas)).toEqual(["row-2", "row-3", "row-5", "row-6", "row-7"]);
  });

  test("distinto (select) incluye las rows sin ningún valor de estado en absoluto", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "distinto", valor: "o-abierto" }],
    };
    const resultado = resolver(filtros);
    // row-4 no tiene NINGÚN PropertyValue de estado — "distinto de abierto" tiene que encontrarla igual, no excluirla.
    expect(idsDe(resultado.filas)).toEqual(["row-2", "row-4", "row-5"]);
  });
});

describe("resolverConsulta: orden multi-campo con NULLS LAST", () => {
  test("prioridad asc (ausentes al final) y titulo asc como desempate", () => {
    const orden: OrdenCampo[] = [
      { campo: { tipo: "propiedad", propertyId: "p-prioridad" }, direccion: "asc" },
      { campo: { tipo: "campo_base", campo: "titulo" }, direccion: "asc" },
    ];
    const resultado = resolver(null, orden);
    expect(resultado.filas.map((f) => f.id)).toEqual(["row-6", "row-2", "row-1", "row-4", "row-7", "row-5", "row-3"]);
  });

  test("multi_select no es un campo válido de orden: se rechaza en validación", () => {
    const orden: OrdenCampo[] = [{ campo: { tipo: "propiedad", propertyId: "p-etiquetas" }, direccion: "asc" }];
    const resultado = resolverConsulta(indice, DATABASE, { filtros: null, orden });
    expect(esErrorDeConsulta(resultado)).toBe(true);
  });
});

describe("resolverVista", () => {
  test("resuelve una View persistida delegando en resolverConsulta con la misma forma", () => {
    const view: View = {
      id: "view-1",
      nombre: "Abiertas",
      databaseId: DATABASE.id,
      filtros: {
        combinador: "y",
        condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-abierto" }],
      },
      orden: [],
    };
    const resultado = resolverVista(indice, DATABASE, view);
    if (esErrorDeConsulta(resultado)) throw new Error("no debería fallar");
    expect(idsDe(resultado.filas)).toEqual(["row-1", "row-3", "row-6", "row-7"]);
  });

  test("un filtro que referencia una opción de select inexistente no falla: no matchea nada y agrega un diagnóstico no fatal", () => {
    const filtros: Grupo = {
      combinador: "y",
      condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-estado" }, operador: "igual", valor: "o-no-existe" }],
    };
    const resultado = resolverConsulta(indice, DATABASE, { filtros, orden: [] });
    if (esErrorDeConsulta(resultado)) throw new Error("no debería fallar");
    expect(resultado.filas).toEqual([]);
    expect(resultado.diagnosticos.some((d) => d.codigo === "FILTRO_OPCION_INEXISTENTE" && d.severidad === "advertencia")).toBe(
      true,
    );
  });
});
