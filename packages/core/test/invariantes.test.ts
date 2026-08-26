import { describe, expect, test } from "bun:test";
import {
  type ErrorValidacion,
  type NodoConParent,
  tieneErroresFatales,
  validarArbolContencion,
  validarFormaDePropiedades,
  validarFormaDeValores,
  validarIdsUnicos,
  validarRow,
  validarRowPerteneceADatabase,
} from "../src/invariantes.ts";
import type { Database, OpcionProperty, OrdenCampo, Property, PropertyValue, Row } from "../src/types.ts";

const AHORA = "2026-08-26T00:00:00.000Z";

function crearDatabase(propiedades: Property[]): Database {
  return {
    id: "db-1",
    tipo: "pagina",
    parentId: null,
    titulo: "una database",
    cuerpo: "",
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    propiedades,
    vistas: [],
  };
}

function crearRow(valores: PropertyValue[], overrides: Partial<Row> = {}): Row {
  return {
    id: "row-1",
    tipo: "fila",
    parentId: "db-1",
    titulo: "una fila",
    creadoEn: AHORA,
    actualizadoEn: AHORA,
    valores,
    ...overrides,
  };
}

function propTexto(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "texto", requerida };
}
function propNumero(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "numero", requerida };
}
function propFecha(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "fecha", requerida };
}
function propCheckbox(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "checkbox", requerida };
}
function propAgente(id: string, requerida = false): Property {
  return { id, nombre: id, tipo: "agente", requerida };
}
function propSelect(id: string, opciones: OpcionProperty[], requerida = false): Property {
  return { id, nombre: id, tipo: "select", requerida, config: { opciones } };
}
function propMultiSelect(id: string, opciones: OpcionProperty[], requerida = false): Property {
  return { id, nombre: id, tipo: "multi_select", requerida, config: { opciones } };
}

function codigos(errores: ErrorValidacion[]): string[] {
  return errores.map((error) => error.codigo);
}

describe("tipos (revisión de T-0009)", () => {
  test("ADR-002: Database se puede construir sin `cuerpo` — el campo es opcional, no requerido como en Page", () => {
    const database: Database = {
      id: "db-sin-cuerpo",
      tipo: "pagina",
      parentId: null,
      titulo: "database sin cuerpo",
      creadoEn: AHORA,
      actualizadoEn: AHORA,
      propiedades: [],
      vistas: [],
    };

    expect(database.cuerpo).toBeUndefined();
  });

  test("ADR-004: OrdenCampo puede referenciar un campo base (creado_en/actualizado_en), no solo una Property", () => {
    const ordenPorPropiedad: OrdenCampo = {
      campo: { tipo: "propiedad", propertyId: "puntaje" },
      direccion: "asc",
    };
    const ordenPorCampoBase: OrdenCampo = {
      campo: { tipo: "campo_base", campo: "actualizado_en" },
      direccion: "desc",
    };

    expect(ordenPorPropiedad.campo).toEqual({ tipo: "propiedad", propertyId: "puntaje" });
    expect(ordenPorCampoBase.campo).toEqual({ tipo: "campo_base", campo: "actualizado_en" });
  });
});

describe("validarRow", () => {
  test("pasa sin errores cuando cada Property requerida tiene un valor del tipo correcto", () => {
    const database = crearDatabase([
      propTexto("titulo_corto", true),
      propNumero("puntaje"),
      propSelect("estado", [{ id: "abierto", nombre: "Abierto" }], true),
    ]);
    const row = crearRow([
      { propertyId: "titulo_corto", valor: "hola" },
      { propertyId: "puntaje", valor: 3 },
      { propertyId: "estado", valor: "abierto" },
    ]);

    expect(validarRow(database, row)).toEqual([]);
  });

  test("pasa sin errores cuando una Property no requerida simplemente no tiene valor", () => {
    const database = crearDatabase([propTexto("nota", false)]);
    const row = crearRow([]);

    expect(validarRow(database, row)).toEqual([]);
  });

  test("invariante 2: rechaza (fatal) cuando falta el valor de una Property requerida", () => {
    const database = crearDatabase([propTexto("titulo_corto", true)]);
    const row = crearRow([]);

    const errores = validarRow(database, row);
    expect(codigos(errores)).toContain("PROPERTY_REQUERIDA_SIN_VALOR");
    expect(errores[0]?.severidad).toBe("error");
    expect(tieneErroresFatales(errores)).toBe(true);
  });

  test("invariante 2: rechaza (fatal) cuando hay dos PropertyValue para la misma Property", () => {
    const database = crearDatabase([propNumero("puntaje")]);
    const row = crearRow([
      { propertyId: "puntaje", valor: 3 },
      { propertyId: "puntaje", valor: 5 },
    ]);

    const errores = validarRow(database, row);
    expect(codigos(errores)).toEqual(["PROPERTY_VALUE_DUPLICADO"]);
    expect(errores[0]?.severidad).toBe("error");
    expect(errores[0]?.propertyId).toBe("puntaje");
    expect(tieneErroresFatales(errores)).toBe(true);
  });

  test("invariante 2: reporta un solo PROPERTY_VALUE_DUPLICADO aunque haya tres o más valores repetidos", () => {
    const database = crearDatabase([propTexto("nota")]);
    const row = crearRow([
      { propertyId: "nota", valor: "a" },
      { propertyId: "nota", valor: "b" },
      { propertyId: "nota", valor: "c" },
    ]);

    expect(codigos(validarRow(database, row)).filter((c) => c === "PROPERTY_VALUE_DUPLICADO")).toHaveLength(1);
  });

  test("ADR-006: un PropertyValue huérfano no rechaza la Row entera, solo se reporta como advertencia", () => {
    const database = crearDatabase([propTexto("nota", false)]);
    const row = crearRow([
      { propertyId: "nota", valor: "todo bien" },
      { propertyId: "property-que-ya-no-existe", valor: "restos de un quitar Property" },
    ]);

    const errores = validarRow(database, row);
    const huerfano = errores.find((error) => error.codigo === "PROPERTY_VALUE_HUERFANO");
    expect(huerfano).toBeDefined();
    expect(huerfano?.severidad).toBe("advertencia");
    // El huérfano es el único hallazgo: no hay ningún error fatal.
    expect(tieneErroresFatales(errores)).toBe(false);
  });

  test("invariante 3: numero rechaza NaN", () => {
    const database = crearDatabase([propNumero("puntaje")]);
    const row = crearRow([{ propertyId: "puntaje", valor: Number.NaN }]);

    const errores = validarRow(database, row);
    expect(codigos(errores)).toEqual(["TIPO_INVALIDO"]);
    expect(errores[0]?.severidad).toBe("error");
  });

  test("invariante 3: numero rechaza Infinity, -Infinity y -0", () => {
    const database = crearDatabase([propNumero("puntaje")]);

    for (const valorInvalido of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
      const row = crearRow([{ propertyId: "puntaje", valor: valorInvalido }]);
      expect(codigos(validarRow(database, row))).toEqual(["TIPO_INVALIDO"]);
    }
  });

  test("el mensaje de numero inválido no miente sobre el valor recibido (NaN/Infinity/-0 vía JSON.stringify colapsan a null/0)", () => {
    const database = crearDatabase([propNumero("puntaje")]);

    const casos: [number, string][] = [
      [Number.NaN, "NaN"],
      [Number.POSITIVE_INFINITY, "Infinity"],
      [Number.NEGATIVE_INFINITY, "-Infinity"],
      [-0, "-0"],
    ];
    for (const [valorInvalido, textoEsperado] of casos) {
      const row = crearRow([{ propertyId: "puntaje", valor: valorInvalido }]);
      const [error] = validarRow(database, row);
      expect(error?.mensaje).toContain(`recibió ${textoEsperado}`);
      expect(error?.mensaje).not.toContain("recibió null");
    }
  });

  test("invariante 3: numero acepta un número finito normal, incluyendo 0", () => {
    const database = crearDatabase([propNumero("puntaje")]);
    const row = crearRow([{ propertyId: "puntaje", valor: 0 }]);

    expect(validarRow(database, row)).toEqual([]);
  });

  test("invariante 3: fecha rechaza formas mal formadas", () => {
    const database = crearDatabase([propFecha("vencimiento")]);

    for (const valorInvalido of ["2026/08/26", "20260826", "no-es-una-fecha", "2026-13-01", "2026-08-32"]) {
      const row = crearRow([{ propertyId: "vencimiento", valor: valorInvalido }]);
      expect(codigos(validarRow(database, row))).toEqual(["TIPO_INVALIDO"]);
    }
  });

  test("invariante 3: fecha acepta la forma YYYY-MM-DD", () => {
    const database = crearDatabase([propFecha("vencimiento")]);
    const row = crearRow([{ propertyId: "vencimiento", valor: "2026-08-26" }]);

    expect(validarRow(database, row)).toEqual([]);
  });

  test("invariante 3: checkbox rechaza un valor que no es boolean", () => {
    const database = crearDatabase([propCheckbox("urgente")]);
    const row = crearRow([{ propertyId: "urgente", valor: "true" }]);

    expect(codigos(validarRow(database, row))).toEqual(["TIPO_INVALIDO"]);
  });

  test("invariante 3: select rechaza un id de opción que no existe en config.opciones", () => {
    const database = crearDatabase([propSelect("estado", [{ id: "abierto", nombre: "Abierto" }])]);
    const row = crearRow([{ propertyId: "estado", valor: "no-existe" }]);

    expect(codigos(validarRow(database, row))).toEqual(["TIPO_INVALIDO"]);
  });

  test("invariante 3: multi_select rechaza si algún id de opción no existe en config.opciones", () => {
    const database = crearDatabase([
      propMultiSelect("etiquetas", [
        { id: "urgente", nombre: "Urgente" },
        { id: "bug", nombre: "Bug" },
      ]),
    ]);
    const row = crearRow([{ propertyId: "etiquetas", valor: ["urgente", "no-existe"] }]);

    expect(codigos(validarRow(database, row))).toEqual(["TIPO_INVALIDO"]);
  });

  test("invariante 3: multi_select acepta un array de ids existentes, incluyendo vacío", () => {
    const database = crearDatabase([
      propMultiSelect("etiquetas", [
        { id: "urgente", nombre: "Urgente" },
        { id: "bug", nombre: "Bug" },
      ]),
    ]);
    const row = crearRow([{ propertyId: "etiquetas", valor: ["urgente"] }]);
    const rowVacia = crearRow([{ propertyId: "etiquetas", valor: [] }]);

    expect(validarRow(database, row)).toEqual([]);
    expect(validarRow(database, rowVacia)).toEqual([]);
  });

  test("invariante 3: agente y texto rechazan valores que no son string", () => {
    const database = crearDatabase([propAgente("asignado_a"), propTexto("nota")]);

    const rowAgente = crearRow([{ propertyId: "asignado_a", valor: 123 }]);
    expect(codigos(validarRow(database, rowAgente))).toEqual(["TIPO_INVALIDO"]);

    const rowTexto = crearRow([{ propertyId: "nota", valor: false }]);
    expect(codigos(validarRow(database, rowTexto))).toEqual(["TIPO_INVALIDO"]);
  });

  test("acumula errores de varias Properties distintas en una sola llamada", () => {
    const database = crearDatabase([propTexto("titulo_corto", true), propNumero("puntaje")]);
    const row = crearRow([{ propertyId: "puntaje", valor: Number.NaN }]);

    const errores = validarRow(database, row);
    expect(codigos(errores).sort()).toEqual(["PROPERTY_REQUERIDA_SIN_VALOR", "TIPO_INVALIDO"]);
  });
});

describe("validarRowPerteneceADatabase", () => {
  test("pasa cuando parentId resuelve a una Database conocida", () => {
    const row = crearRow([], { parentId: "db-1" });
    expect(validarRowPerteneceADatabase(row, new Set(["db-1", "db-2"]))).toEqual([]);
  });

  test("invariante 1: rechaza cuando parentId no corresponde a ninguna Database conocida", () => {
    const row = crearRow([], { parentId: "db-fantasma" });
    const errores = validarRowPerteneceADatabase(row, new Set(["db-1"]));

    expect(codigos(errores)).toEqual(["PARENT_ID_INVALIDO"]);
    expect(errores[0]?.severidad).toBe("error");
  });
});

describe("validarArbolContencion", () => {
  test("pasa sin errores para un árbol válido", () => {
    const nodos: NodoConParent[] = [
      { id: "workspace-child", parentId: null },
      { id: "hijo-1", parentId: "workspace-child" },
      { id: "hijo-2", parentId: "hijo-1" },
    ];

    expect(validarArbolContencion(nodos)).toEqual([]);
  });

  test("no reporta ciclo cuando el parentId apunta fuera del conjunto (parent_id colgante)", () => {
    const nodos: NodoConParent[] = [{ id: "huerfano", parentId: "no-existe-en-este-conjunto" }];

    expect(validarArbolContencion(nodos)).toEqual([]);
  });

  test("invariante 5: detecta un ciclo directo entre dos nodos y marca a ambos", () => {
    const nodos: NodoConParent[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];

    const errores = validarArbolContencion(nodos);
    expect(errores).toHaveLength(2);
    expect(errores.every((error) => error.codigo === "CICLO_EN_CONTENCION")).toBe(true);
    expect(errores.map((error) => error.nodoId).sort()).toEqual(["a", "b"]);
  });

  test("invariante 5: detecta un ciclo de tres nodos y marca a los tres", () => {
    const nodos: NodoConParent[] = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "c" },
      { id: "c", parentId: "a" },
    ];

    const errores = validarArbolContencion(nodos);
    expect(errores.map((error) => error.nodoId).sort()).toEqual(["a", "b", "c"]);
  });

  test("invariante 5: detecta un nodo que es su propio parent", () => {
    const nodos: NodoConParent[] = [{ id: "a", parentId: "a" }];

    const errores = validarArbolContencion(nodos);
    expect(codigos(errores)).toEqual(["CICLO_EN_CONTENCION"]);
  });
});

describe("validarIdsUnicos", () => {
  test("pasa sin errores cuando todos los ids son distintos", () => {
    expect(validarIdsUnicos([{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([]);
  });

  test("invariante 7: detecta un id duplicado", () => {
    const errores = validarIdsUnicos([{ id: "a" }, { id: "b" }, { id: "a" }]);

    expect(codigos(errores)).toEqual(["ID_DUPLICADO"]);
    expect(errores[0]?.nodoId).toBe("a");
    expect(errores[0]?.severidad).toBe("error");
  });

  test("reporta cada id duplicado distinto por separado", () => {
    const errores = validarIdsUnicos([{ id: "a" }, { id: "a" }, { id: "b" }, { id: "b" }, { id: "c" }]);

    expect(errores.map((error) => error.nodoId).sort()).toEqual(["a", "b"]);
  });
});

describe("tieneErroresFatales", () => {
  test("false para una lista vacía", () => {
    expect(tieneErroresFatales([])).toBe(false);
  });

  test("false cuando solo hay advertencias", () => {
    const soloAdvertencia: ErrorValidacion[] = [
      { codigo: "PROPERTY_VALUE_HUERFANO", mensaje: "x", severidad: "advertencia" },
    ];
    expect(tieneErroresFatales(soloAdvertencia)).toBe(false);
  });

  test("true cuando hay al menos un error fatal", () => {
    const conFatal: ErrorValidacion[] = [
      { codigo: "PROPERTY_VALUE_HUERFANO", mensaje: "x", severidad: "advertencia" },
      { codigo: "TIPO_INVALIDO", mensaje: "y", severidad: "error" },
    ];
    expect(tieneErroresFatales(conFatal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Guardas de forma para Property[]/PropertyValue[] (entrada no confiable) —
// regresión del hallazgo de revisión de T-0013: `crearDatabase`/`crearRow`
// no validaban la FORMA de estos arrays (solo su sintaxis JSON, en la CLI),
// así que un `--propiedades`/`--valores` sintácticamente válido pero mal
// formado corrompía el workspace en silencio o crasheaba con un error nativo
// críptico en vez de un error de dominio legible.
// ---------------------------------------------------------------------------

describe("validarFormaDePropiedades", () => {
  test("pasa sin errores para un array de Property bien formado, incluyendo select con config.opciones", () => {
    const propiedades = [
      propTexto("p1"),
      { id: "p2", nombre: "estado", tipo: "select", requerida: false, config: { opciones: [{ id: "o1", nombre: "uno" }] } },
    ];
    expect(validarFormaDePropiedades(propiedades)).toEqual([]);
  });

  test("array vacío es válido (Database sin esquema todavía)", () => {
    expect(validarFormaDePropiedades([])).toEqual([]);
  });

  test('rechaza algo que no es un array ("propiedades" no puede ser un objeto)', () => {
    const errores = validarFormaDePropiedades({ id: "p1" });
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
  });

  test("rechaza un elemento sin id/nombre/requerida/tipo reconocibles, sin crashear", () => {
    const errores = validarFormaDePropiedades([{ foo: "bar" }]);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.every((error) => error.codigo === "ESTRUCTURA_INVALIDA" && error.severidad === "error")).toBe(true);
  });

  test('rechaza un "tipo" que no es ninguno de los siete válidos', () => {
    const errores = validarFormaDePropiedades([{ id: "p1", nombre: "x", requerida: false, tipo: "url" }]);
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
  });

  test('rechaza un select sin "config.opciones" en vez de crashear más adelante contra `propiedad.config.opciones`', () => {
    const errores = validarFormaDePropiedades([{ id: "p1", nombre: "estado", tipo: "select", requerida: false }]);
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
    expect(errores[0]?.propertyId).toBe("p1");
  });

  test('rechaza "config" presente en un tipo que no es select/multi_select', () => {
    const errores = validarFormaDePropiedades([
      { id: "p1", nombre: "x", tipo: "texto", requerida: false, config: { opciones: [] } },
    ]);
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
  });

  test("rechaza un id de Property duplicado dentro del mismo array de entrada", () => {
    const errores = validarFormaDePropiedades([propTexto("p1"), propNumero("p1")]);
    expect(codigos(errores)).toEqual(["ID_DUPLICADO"]);
  });
});

describe("validarFormaDeValores", () => {
  test("pasa sin errores para un array de PropertyValue bien formado", () => {
    expect(
      validarFormaDeValores([
        { propertyId: "p1", valor: "hola" },
        { propertyId: "p2", valor: 3 },
        { propertyId: "p3", valor: true },
        { propertyId: "p4", valor: ["a", "b"] },
      ]),
    ).toEqual([]);
  });

  test("array vacío es válido", () => {
    expect(validarFormaDeValores([])).toEqual([]);
  });

  test('rechaza algo que no es un array (un objeto en vez de "valores")', () => {
    const errores = validarFormaDeValores({ a: 1 });
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
  });

  test('rechaza un elemento sin "propertyId" string, en vez de dejarlo pasar como huérfano silencioso', () => {
    const errores = validarFormaDeValores([{ foo: "bar" }]);
    expect(errores.length).toBeGreaterThan(0);
    expect(errores.every((error) => error.codigo === "ESTRUCTURA_INVALIDA" && error.severidad === "error")).toBe(true);
  });

  test('rechaza un "valor" que no es ninguna de las cuatro formas válidas de ValorPropertyValue', () => {
    const errores = validarFormaDeValores([{ propertyId: "p1", valor: { anidado: true } }]);
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
    expect(errores[0]?.propertyId).toBe("p1");
  });

  test("rechaza NaN/Infinity/-0 en valor numérico, igual que validarTipoValor", () => {
    expect(codigos(validarFormaDeValores([{ propertyId: "p1", valor: NaN }]))).toEqual(["ESTRUCTURA_INVALIDA"]);
    expect(codigos(validarFormaDeValores([{ propertyId: "p1", valor: Infinity }]))).toEqual(["ESTRUCTURA_INVALIDA"]);
    expect(codigos(validarFormaDeValores([{ propertyId: "p1", valor: -0 }]))).toEqual(["ESTRUCTURA_INVALIDA"]);
  });

  test("rechaza claves inesperadas en un elemento", () => {
    const errores = validarFormaDeValores([{ propertyId: "p1", valor: "x", extra: 1 }]);
    expect(codigos(errores)).toEqual(["ESTRUCTURA_INVALIDA"]);
  });
});
