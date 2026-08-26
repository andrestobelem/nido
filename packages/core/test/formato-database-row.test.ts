import { describe, expect, test } from "bun:test";
import {
  parsearDatabase,
  parsearRow,
  serializarDatabase,
  serializarRow,
} from "../src/formato/database-row.ts";
import type { ErrorValidacion } from "../src/invariantes.ts";
import type { Database, Property, PropertyValue, Row, View } from "../src/types.ts";

const CREADO = "2026-08-26T00:00:00.000Z";
const ACTUALIZADO = "2026-08-26T01:30:00.000Z";

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

function propTexto(id: string): Property {
  return { id, nombre: id, tipo: "texto", requerida: false };
}

function esErrores(valor: unknown): valor is ErrorValidacion[] {
  return Array.isArray(valor);
}

// ---------------------------------------------------------------------------
// serializarDatabase: orden y nombre de claves (ADR-002 sección 3: en disco,
// snake_case — ver comentario de cabecera de src/formato/database-row.ts)
// ---------------------------------------------------------------------------

describe("serializarDatabase — orden de claves", () => {
  test("orden fijo sin cuerpo: id, tipo, parent_id, titulo, propiedades, vistas, creado_en, actualizado_en", () => {
    const db = crearDatabase();
    const salida = serializarDatabase(db);
    const parseado = JSON.parse(salida);
    expect(Object.keys(parseado)).toEqual([
      "id",
      "tipo",
      "parent_id",
      "titulo",
      "propiedades",
      "vistas",
      "creado_en",
      "actualizado_en",
    ]);
  });

  test("cuerpo aparece en su posición fija cuando está presente", () => {
    const db = crearDatabase({ cuerpo: "algo de texto" });
    const parseado = JSON.parse(serializarDatabase(db));
    expect(Object.keys(parseado)).toEqual([
      "id",
      "tipo",
      "parent_id",
      "titulo",
      "cuerpo",
      "propiedades",
      "vistas",
      "creado_en",
      "actualizado_en",
    ]);
    expect(parseado.cuerpo).toBe("algo de texto");
  });

  test("cuerpo ausente (undefined) nunca se emite como null: la clave no aparece", () => {
    const db = crearDatabase();
    const parseado = JSON.parse(serializarDatabase(db));
    expect("cuerpo" in parseado).toBe(false);
  });

  test("parentId de una Database de nivel superior se serializa como parent_id: null (no ausente)", () => {
    const db = crearDatabase({ parentId: null });
    const parseado = JSON.parse(serializarDatabase(db));
    expect("parent_id" in parseado).toBe(true);
    expect(parseado.parent_id).toBeNull();
  });

  test("determinismo: el orden de salida no depende del orden de inserción del objeto en memoria", () => {
    const dbConstruidaAlReves = {
      actualizadoEn: ACTUALIZADO,
      creadoEn: CREADO,
      vistas: [] as View[],
      propiedades: [] as Property[],
      titulo: "una database",
      parentId: null,
      tipo: "pagina" as const,
      id: "db-1",
    } satisfies Database;
    const dbNormal = crearDatabase();
    expect(serializarDatabase(dbConstruidaAlReves)).toBe(serializarDatabase(dbNormal));
  });

  test("termina en newline y usa indentación de 2 espacios, igual que packages/tickets", () => {
    const salida = serializarDatabase(crearDatabase());
    expect(salida.endsWith("\n")).toBe(true);
    expect(salida).toContain('{\n  "id"');
  });

  test("propiedades y vistas se preservan tal cual vienen, sin reordenar ni traducir claves internas", () => {
    const propiedades: Property[] = [propTexto("z"), propTexto("a"), propTexto("m")];
    const vista: View = { id: "v1", nombre: "v", databaseId: "db-1", filtros: null, orden: [] };
    const db = crearDatabase({ propiedades, vistas: [vista] });
    const parseado = JSON.parse(serializarDatabase(db));
    expect(parseado.propiedades.map((p: Property) => p.id)).toEqual(["z", "a", "m"]);
    // View no se traduce: sus propias claves quedan camelCase, tal cual el
    // objeto en memoria (fuera de alcance de este ticket — ver comentario
    // de cabecera del módulo).
    expect(parseado.vistas[0].databaseId).toBe("db-1");
  });
});

// ---------------------------------------------------------------------------
// serializarDatabase: fechas
// ---------------------------------------------------------------------------

describe("serializarDatabase — fechas", () => {
  test("una fecha ya canónica se preserva exactamente", () => {
    const db = crearDatabase({ creadoEn: "2026-01-15T09:05:03.123Z" });
    const parseado = JSON.parse(serializarDatabase(db));
    expect(parseado.creado_en).toBe("2026-01-15T09:05:03.123Z");
  });

  test("una fecha sin milisegundos se normaliza a la forma completa toISOString()", () => {
    const db = crearDatabase({ creadoEn: "2026-01-15T09:05:03Z" });
    const parseado = JSON.parse(serializarDatabase(db));
    expect(parseado.creado_en).toBe("2026-01-15T09:05:03.000Z");
  });

  test("una fecha inválida hace throw en vez de serializar basura en silencio", () => {
    const db = crearDatabase({ creadoEn: "no-es-una-fecha" });
    expect(() => serializarDatabase(db)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// serializarRow: orden de claves y de valores
// ---------------------------------------------------------------------------

describe("serializarRow — orden de claves", () => {
  test("orden fijo: id, tipo, parent_id, titulo, creado_en, actualizado_en, valores", () => {
    const row = crearRow();
    const parseado = JSON.parse(serializarRow(row));
    expect(Object.keys(parseado)).toEqual([
      "id",
      "tipo",
      "parent_id",
      "titulo",
      "creado_en",
      "actualizado_en",
      "valores",
    ]);
  });

  test("cada elemento de valores usa la clave property_id (no propertyId) en disco", () => {
    const row = crearRow({ valores: [{ propertyId: "p1", valor: "x" }] });
    const parseado = JSON.parse(serializarRow(row));
    expect(Object.keys(parseado.valores[0])).toEqual(["property_id", "valor"]);
    expect(parseado.valores[0].property_id).toBe("p1");
  });

  test("valores se ordenan por property_id ascendente, sin importar el orden de entrada", () => {
    const valores: PropertyValue[] = [
      { propertyId: "zeta", valor: "1" },
      { propertyId: "alfa", valor: "2" },
      { propertyId: "medio", valor: "3" },
    ];
    const row = crearRow({ valores });
    const parseado = JSON.parse(serializarRow(row));
    expect(parseado.valores.map((v: { property_id: string }) => v.property_id)).toEqual([
      "alfa",
      "medio",
      "zeta",
    ]);
  });

  test("no muta el array de valores original", () => {
    const valores: PropertyValue[] = [
      { propertyId: "zeta", valor: "1" },
      { propertyId: "alfa", valor: "2" },
    ];
    const row = crearRow({ valores });
    serializarRow(row);
    expect(valores.map((v) => v.propertyId)).toEqual(["zeta", "alfa"]);
  });

  test("determinismo: mismo objeto (aun construido con otro orden de inserción) -> mismos bytes", () => {
    const rowNormal = crearRow({ valores: [{ propertyId: "p1", valor: "x" }] });
    const rowAlReves = {
      valores: [{ propertyId: "p1", valor: "x" }],
      actualizadoEn: ACTUALIZADO,
      creadoEn: CREADO,
      titulo: "una fila",
      parentId: "db-1",
      tipo: "fila" as const,
      id: "row-1",
    } satisfies Row;
    expect(serializarRow(rowNormal)).toBe(serializarRow(rowAlReves));
  });
});

// ---------------------------------------------------------------------------
// serializarRow: reglas de valor por tipo de PropertyValue
// ---------------------------------------------------------------------------

describe("serializarRow — reglas de valor", () => {
  test("multi_select (string[]) se ordena lexicográficamente y se deduplica", () => {
    const row = crearRow({ valores: [{ propertyId: "tags", valor: ["zeta", "alfa", "alfa", "medio"] }] });
    const parseado = JSON.parse(serializarRow(row));
    expect(parseado.valores[0].valor).toEqual(["alfa", "medio", "zeta"]);
  });

  test("fecha (string YYYY-MM-DD) se serializa verbatim, nunca reparseada a Date", () => {
    const row = crearRow({ valores: [{ propertyId: "vencimiento", valor: "2026-02-30" }] });
    // "2026-02-30" no es una fecha de calendario real, pero como PropertyValue
    // de tipo fecha es un string opaco: el serializador no debe intentar
    // interpretarla ni normalizarla — eso es responsabilidad de validarRow.
    const parseado = JSON.parse(serializarRow(row));
    expect(parseado.valores[0].valor).toBe("2026-02-30");
  });

  test("texto se serializa verbatim", () => {
    const row = crearRow({ valores: [{ propertyId: "nombre", valor: "hola mundo" }] });
    const parseado = JSON.parse(serializarRow(row));
    expect(parseado.valores[0].valor).toBe("hola mundo");
  });

  test("checkbox (boolean) se serializa verbatim", () => {
    const row = crearRow({ valores: [{ propertyId: "hecho", valor: true }] });
    const parseado = JSON.parse(serializarRow(row));
    expect(parseado.valores[0].valor).toBe(true);
  });

  test("numero válido se serializa tal cual", () => {
    const row = crearRow({ valores: [{ propertyId: "cantidad", valor: 42.5 }] });
    const parseado = JSON.parse(serializarRow(row));
    expect(parseado.valores[0].valor).toBe(42.5);
  });

  test("numero NaN hace throw defensivo (nunca se serializa como null en silencio)", () => {
    const row = crearRow({ valores: [{ propertyId: "cantidad", valor: NaN }] });
    expect(() => serializarRow(row)).toThrow();
  });

  test("numero Infinity hace throw defensivo", () => {
    const row = crearRow({ valores: [{ propertyId: "cantidad", valor: Infinity }] });
    expect(() => serializarRow(row)).toThrow();
  });

  test("numero -Infinity hace throw defensivo", () => {
    const row = crearRow({ valores: [{ propertyId: "cantidad", valor: -Infinity }] });
    expect(() => serializarRow(row)).toThrow();
  });

  test("numero -0 hace throw defensivo", () => {
    const row = crearRow({ valores: [{ propertyId: "cantidad", valor: -0 }] });
    expect(() => serializarRow(row)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Round-trip: parsear(serializar(x)) === x
// ---------------------------------------------------------------------------

describe("round-trip Database", () => {
  test("round-trip sin cuerpo", () => {
    const db = crearDatabase({
      propiedades: [propTexto("p1")],
      vistas: [],
    });
    const resultado = parsearDatabase(serializarDatabase(db));
    expect(esErrores(resultado)).toBe(false);
    expect(resultado).toEqual(db);
  });

  test("round-trip con cuerpo presente", () => {
    const db = crearDatabase({ cuerpo: "texto libre" });
    const resultado = parsearDatabase(serializarDatabase(db));
    expect(resultado).toEqual(db);
  });

  test("round-trip con parentId no nulo", () => {
    const db = crearDatabase({ parentId: "page-padre" });
    const resultado = parsearDatabase(serializarDatabase(db));
    expect(resultado).toEqual(db);
  });

  test("round-trip con una View embebida se preserva tal cual (incluye sus claves camelCase propias)", () => {
    const vista: View = {
      id: "v1",
      nombre: "vista 1",
      databaseId: "db-1",
      filtros: null,
      orden: [],
    };
    const db = crearDatabase({ vistas: [vista] });
    const resultado = parsearDatabase(serializarDatabase(db));
    expect(resultado).toEqual(db);
  });
});

describe("round-trip Row", () => {
  test("round-trip con valores de varios tipos", () => {
    const row = crearRow({
      valores: [
        { propertyId: "b-numero", valor: 3 },
        { propertyId: "a-texto", valor: "hola" },
        { propertyId: "c-check", valor: false },
        { propertyId: "d-multi", valor: ["x", "y"] },
      ],
    });
    const resultado = parsearRow(serializarRow(row));
    expect(esErrores(resultado)).toBe(false);
    // El resultado tiene los valores en orden canónico (por propertyId), no
    // en el orden de construcción original — por eso comparamos contra la
    // versión ya serializada-y-reparseada esperada, no contra `row` crudo.
    if (!esErrores(resultado)) {
      expect(resultado.valores.map((v) => v.propertyId)).toEqual([
        "a-texto",
        "b-numero",
        "c-check",
        "d-multi",
      ]);
      expect(resultado.id).toBe(row.id);
      expect(resultado.titulo).toBe(row.titulo);
    }
  });

  test("round-trip vacío", () => {
    const row = crearRow();
    const resultado = parsearRow(serializarRow(row));
    expect(resultado).toEqual(row);
  });
});

// ---------------------------------------------------------------------------
// parsearDatabase: parseo total y validación de forma
// ---------------------------------------------------------------------------

describe("parsearDatabase — parseo total", () => {
  test("JSON sintácticamente inválido rechaza el archivo completo", () => {
    const resultado = parsearDatabase("{ esto no es json ");
    expect(esErrores(resultado)).toBe(true);
    if (esErrores(resultado)) {
      expect(resultado.length).toBeGreaterThan(0);
      expect(resultado[0]?.codigo).toBe("ESTRUCTURA_INVALIDA");
      expect(resultado[0]?.severidad).toBe("error");
    }
  });

  test("un array en vez de un objeto se rechaza", () => {
    const resultado = parsearDatabase("[]");
    expect(esErrores(resultado)).toBe(true);
  });

  test("falta una clave requerida", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    delete bruto.titulo;
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
    if (esErrores(resultado)) {
      expect(resultado.some((e) => e.mensaje.includes('"titulo"'))).toBe(true);
    }
  });

  test("una clave inesperada se rechaza", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.campoQueNoExiste = 123;
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
    if (esErrores(resultado)) {
      expect(resultado.some((e) => e.mensaje.includes("campoQueNoExiste"))).toBe(true);
    }
  });

  test("una clave camelCase en vez de snake_case (p. ej. parentId) se rechaza como clave inesperada + faltante", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.parentId = bruto.parent_id;
    delete bruto.parent_id;
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
    if (esErrores(resultado)) {
      expect(resultado.some((e) => e.mensaje.includes('"parent_id"'))).toBe(true);
      expect(resultado.some((e) => e.mensaje.includes("parentId"))).toBe(true);
    }
  });

  test('tipo distinto de "pagina" se rechaza', () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.tipo = "fila";
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("cuerpo: null se rechaza (regla ausente-vs-null de ADR-002)", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.cuerpo = null;
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("creado_en con formato no canónico se rechaza", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.creado_en = "2026-08-26";
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("creado_en con fecha de calendario inválida se rechaza", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.creado_en = "2026-02-30T00:00:00.000Z";
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("propiedades no-array se rechaza", () => {
    const bruto = JSON.parse(serializarDatabase(crearDatabase()));
    bruto.propiedades = "no es un array";
    const resultado = parsearDatabase(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("reporta varios errores a la vez, no solo el primero", () => {
    const resultado = parsearDatabase(JSON.stringify({ id: "x" }));
    expect(esErrores(resultado)).toBe(true);
    if (esErrores(resultado)) {
      expect(resultado.length).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// parsearRow: parseo total y validación de forma
// ---------------------------------------------------------------------------

describe("parsearRow — parseo total", () => {
  test("JSON sintácticamente inválido rechaza el archivo completo", () => {
    const resultado = parsearRow("no es json");
    expect(esErrores(resultado)).toBe(true);
  });

  test('tipo distinto de "fila" se rechaza', () => {
    const bruto = JSON.parse(serializarRow(crearRow()));
    bruto.tipo = "pagina";
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("parent_id null se rechaza (una Row siempre pertenece a una Database)", () => {
    const bruto = JSON.parse(serializarRow(crearRow()));
    bruto.parent_id = null;
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("un elemento de valores con clave inesperada se rechaza", () => {
    const bruto = JSON.parse(serializarRow(crearRow({ valores: [{ propertyId: "p1", valor: "x" }] })));
    bruto.valores[0].tipo = "texto";
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
    if (esErrores(resultado)) {
      expect(resultado.some((e) => e.mensaje.includes("claves inesperadas"))).toBe(true);
    }
  });

  test("un elemento de valores con propertyId (camelCase) en vez de property_id se rechaza", () => {
    const bruto = JSON.parse(serializarRow(crearRow({ valores: [{ propertyId: "p1", valor: "x" }] })));
    bruto.valores[0].propertyId = bruto.valores[0].property_id;
    delete bruto.valores[0].property_id;
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("un elemento de valores con array de no-strings se rechaza", () => {
    const texto = serializarRow(crearRow({ valores: [{ propertyId: "p1", valor: ["a"] }] }));
    const bruto = JSON.parse(texto);
    bruto.valores[0].valor = ["a", 5, "b"];
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("un elemento de valores con property_id no-string se rechaza", () => {
    const bruto = JSON.parse(serializarRow(crearRow({ valores: [{ propertyId: "p1", valor: "x" }] })));
    bruto.valores[0].property_id = 5;
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("-0 literal en el JSON (no producible por nuestro propio serializador) se rechaza en la lectura", () => {
    // JSON.stringify(-0) da "0", así que para probar este caso escribimos el
    // texto JSON a mano en vez de pasar por nuestro propio serializador.
    const contenido = `{
      "id": "row-1",
      "tipo": "fila",
      "parent_id": "db-1",
      "titulo": "una fila",
      "creado_en": "${CREADO}",
      "actualizado_en": "${ACTUALIZADO}",
      "valores": [{ "property_id": "cantidad", "valor": -0 }]
    }`;
    const resultado = parsearRow(contenido);
    expect(esErrores(resultado)).toBe(true);
  });

  test("valores no-array se rechaza", () => {
    const bruto = JSON.parse(serializarRow(crearRow()));
    bruto.valores = { no: "un array" };
    const resultado = parsearRow(JSON.stringify(bruto));
    expect(esErrores(resultado)).toBe(true);
  });

  test("acepta valores en cualquier orden de entrada (el lector es laxo en orden)", () => {
    const contenido = JSON.stringify({
      id: "row-1",
      tipo: "fila",
      parent_id: "db-1",
      titulo: "una fila",
      creado_en: CREADO,
      actualizado_en: ACTUALIZADO,
      valores: [
        { property_id: "zeta", valor: "1" },
        { property_id: "alfa", valor: "2" },
      ],
    });
    const resultado = parsearRow(contenido);
    expect(esErrores(resultado)).toBe(false);
    if (!esErrores(resultado)) {
      // El orden de entrada se preserva en el parseo: el parser no reordena,
      // solo el serializador canonicaliza en la próxima escritura.
      expect(resultado.valores.map((v) => v.propertyId)).toEqual(["zeta", "alfa"]);
    }
  });
});
