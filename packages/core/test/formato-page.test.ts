import { describe, expect, test } from "bun:test";
import {
  esErrorDeParseo,
  parsearPage,
  serializarPage,
  TituloConSaltoDeLinea,
  ValorDeEncabezadoConSaltoDeLinea,
} from "../src/formato/page.ts";
import type { ErrorValidacion } from "../src/invariantes.ts";
import type { Page } from "../src/types.ts";

const AHORA = "2026-08-26T10:00:00.000Z";
const LUEGO = "2026-08-26T11:30:05.123Z";

function crearPage(overrides: Partial<Page> = {}): Page {
  return {
    id: "pagina-1",
    tipo: "pagina",
    parentId: null,
    titulo: "Una página",
    cuerpo: "Hola mundo.",
    creadoEn: AHORA,
    actualizadoEn: LUEGO,
    ...overrides,
  };
}

function codigos(errores: ErrorValidacion[]): string[] {
  return errores.map((error) => error.codigo);
}

describe("serializarPage", () => {
  test("emite las seis claves en el orden fijo del ADR, con comillas dobles y delimitadores exactos", () => {
    const page = crearPage({ id: "abc", parentId: "padre-1", titulo: "Título", cuerpo: "cuerpo" });

    expect(serializarPage(page)).toBe(
      [
        "---",
        'id: "abc"',
        'tipo: "pagina"',
        'parent_id: "padre-1"',
        'titulo: "Título"',
        `creado_en: "${AHORA}"`,
        `actualizado_en: "${LUEGO}"`,
        "---",
        "cuerpo",
      ].join("\n"),
    );
  });

  test("parent_id null se emite sin comillas, como literal `null`", () => {
    const page = crearPage({ parentId: null });
    const salida = serializarPage(page);

    expect(salida).toContain("\nparent_id: null\n");
    expect(salida).not.toContain('"null"');
  });

  test("escapa comillas dobles y backslashes en titulo con \\\" y \\\\ únicamente", () => {
    const page = crearPage({ titulo: 'Con "comillas" y \\backslash\\' });
    const salida = serializarPage(page);

    expect(salida).toContain('titulo: "Con \\"comillas\\" y \\\\backslash\\\\"');
  });

  test("el cuerpo va verbatim: vacío no agrega ni quita un newline extra", () => {
    const page = crearPage({ cuerpo: "" });
    expect(serializarPage(page)).toBe(
      ["---", 'id: "pagina-1"', 'tipo: "pagina"', "parent_id: null", 'titulo: "Una página"', `creado_en: "${AHORA}"`, `actualizado_en: "${LUEGO}"`, "---", ""].join(
        "\n",
      ),
    );
  });

  test("el cuerpo preserva saltos de línea internos y no colapsa nada", () => {
    const page = crearPage({ cuerpo: "línea 1\n\nlínea 3\n" });
    const salida = serializarPage(page);
    expect(salida.endsWith("---\nlínea 1\n\nlínea 3\n")).toBe(true);
  });

  test("lanza TituloConSaltoDeLinea si titulo contiene un salto de línea literal", () => {
    const page = crearPage({ titulo: "línea 1\nlínea 2" });
    expect(() => serializarPage(page)).toThrow(TituloConSaltoDeLinea);
  });

  test("lanza ValorDeEncabezadoConSaltoDeLinea si id contiene un salto de línea literal", () => {
    const page = crearPage({ id: "id-con-salto\nde-linea" });
    expect(() => serializarPage(page)).toThrow(ValorDeEncabezadoConSaltoDeLinea);
  });

  test("lanza ValorDeEncabezadoConSaltoDeLinea si parent_id (string) contiene un salto de línea literal", () => {
    const page = crearPage({ parentId: "padre\ncon-salto" });
    expect(() => serializarPage(page)).toThrow(ValorDeEncabezadoConSaltoDeLinea);
  });

  test("parent_id null no dispara la validación de salto de línea (nada que chequear)", () => {
    const page = crearPage({ parentId: null, titulo: "sin problemas" });
    expect(() => serializarPage(page)).not.toThrow();
  });

  test("lanza ValorDeEncabezadoConSaltoDeLinea si creado_en contiene un salto de línea literal", () => {
    const page = crearPage({ creadoEn: `${AHORA}\nparent_id: "padre-FALSIFICADO"` });
    expect(() => serializarPage(page)).toThrow(ValorDeEncabezadoConSaltoDeLinea);
  });

  test("lanza ValorDeEncabezadoConSaltoDeLinea si actualizado_en contiene un salto de línea literal", () => {
    const page = crearPage({ actualizadoEn: `${LUEGO}\ntitulo: "otro titulo"` });
    expect(() => serializarPage(page)).toThrow(ValorDeEncabezadoConSaltoDeLinea);
  });
});

describe("parsearPage: round-trip con serializarPage", () => {
  const casos: [string, Partial<Page>][] = [
    ["página de nivel superior (parent_id null)", { parentId: null }],
    ["página con parent_id string", { parentId: "otro-id" }],
    ["cuerpo vacío", { cuerpo: "" }],
    ["cuerpo multilínea con líneas vacías", { cuerpo: "primera\n\ntercera\n" }],
    ["cuerpo que contiene una línea literal '---' (no debe confundirse con un delimitador)", { cuerpo: "antes\n---\ndespués" }],
    ["titulo con comillas y backslashes", { titulo: 'Con "comillas" y \\backslash' }],
    ["id con comillas y backslashes", { id: 'id-"raro"-\\1' }],
  ];

  for (const [descripcion, overrides] of casos) {
    test(descripcion, () => {
      const original = crearPage(overrides);
      const resultado = parsearPage(serializarPage(original));
      expect(esErrorDeParseo(resultado)).toBe(false);
      expect(resultado).toEqual(original);
    });
  }
});

describe("parsearPage: acepta variaciones válidas de formato", () => {
  test("acepta las seis claves en cualquier orden", () => {
    const contenido = [
      "---",
      `actualizado_en: "${LUEGO}"`,
      'titulo: "Reordenada"',
      'parent_id: "padre-1"',
      `creado_en: "${AHORA}"`,
      'tipo: "pagina"',
      'id: "reordenada-1"',
      "---",
      "cuerpo",
    ].join("\n");

    const resultado = parsearPage(contenido);
    expect(esErrorDeParseo(resultado)).toBe(false);
    expect(resultado).toEqual(
      crearPage({ id: "reordenada-1", parentId: "padre-1", titulo: "Reordenada", cuerpo: "cuerpo" }),
    );
  });

  test("el cuerpo es todo lo que sigue al segundo delimitador, verbatim hasta EOF, incluso vacío sin newline final", () => {
    const contenido = [
      "---",
      'id: "x"',
      'tipo: "pagina"',
      "parent_id: null",
      'titulo: "t"',
      `creado_en: "${AHORA}"`,
      `actualizado_en: "${LUEGO}"`,
      "---",
    ].join("\n");

    const resultado = parsearPage(contenido);
    expect(esErrorDeParseo(resultado)).toBe(false);
    expect((resultado as Page).cuerpo).toBe("");
  });
});

describe("parsearPage: rechaza el archivo completo (no un parseo parcial) ante cualquier desvío del grammar", () => {
  function encabezadoValido(overridesDeLinea: Record<string, string> = {}): Record<string, string> {
    return {
      id: 'id: "x"',
      tipo: 'tipo: "pagina"',
      parent_id: "parent_id: null",
      titulo: 'titulo: "t"',
      creado_en: `creado_en: "${AHORA}"`,
      actualizado_en: `actualizado_en: "${LUEGO}"`,
      ...overridesDeLinea,
    };
  }

  function construir(lineasClaves: string[], cuerpo = "cuerpo"): string {
    return ["---", ...lineasClaves, "---", cuerpo].join("\n");
  }

  test("contenido vacío", () => {
    const resultado = parsearPage("");
    expect(esErrorDeParseo(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ENCABEZADO_INVALIDO"]);
  });

  test("no abre con el delimitador exacto (ej. frontmatter con motor, '---js')", () => {
    const resultado = parsearPage(construir(Object.values(encabezadoValido())).replace("---\n", "---js\n"));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("no abre con '---' en absoluto", () => {
    const resultado = parsearPage("id: \"x\"\ncuerpo libre sin encabezado");
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("no tiene delimitador de cierre", () => {
    const contenido = ["---", ...Object.values(encabezadoValido()), "cuerpo sin cierre nunca llega"].join("\n");
    const resultado = parsearPage(contenido);
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("archivo es solo '---' sin nada más", () => {
    const resultado = parsearPage("---");
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("falta una clave requerida (parent_id)", () => {
    const claves = encabezadoValido();
    delete (claves as Record<string, string | undefined>).parent_id;
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ENCABEZADO_INVALIDO"]);
  });

  test("sobra una clave desconocida", () => {
    const lineas = [...Object.values(encabezadoValido()), 'extra_campo: "no debería estar"'];
    const resultado = parsearPage(construir(lineas));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("una clave aparece duplicada", () => {
    const lineas = [...Object.values(encabezadoValido()), 'titulo: "otra vez"'];
    const resultado = parsearPage(construir(lineas));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("tipo distinto de \"pagina\"", () => {
    const claves = encabezadoValido({ tipo: 'tipo: "fila"' });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("parent_id sin comillas y distinto de null", () => {
    const claves = encabezadoValido({ parent_id: "parent_id: sin-comillas" });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("titulo sin comillas dobles", () => {
    const claves = encabezadoValido({ titulo: "titulo: sin comillas" });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("creado_en que no matchea ISO-8601 UTC completo", () => {
    const claves = encabezadoValido({ creado_en: 'creado_en: "2026-08-26"' });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("creado_en/actualizado_en con la cantidad correcta de dígitos pero fuera de rango (mes/día/hora/minuto/segundo) se rechaza, no alcanza con contar dígitos", () => {
    const claves = encabezadoValido({ creado_en: 'creado_en: "9999-99-99T99:99:99.999Z"' });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
    expect(codigos(resultado as ErrorValidacion[])).toEqual(["ENCABEZADO_INVALIDO"]);
  });

  test("valor con un escape no reconocido (\\n literal de dos caracteres) se rechaza, no se interpreta como salto de línea", () => {
    const claves = encabezadoValido({ titulo: 'titulo: "línea\\nfalsa"' });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("no ejecuta nada ni interpreta anchors/tags de YAML: los trata como texto y los rechaza si no matchean el grammar", () => {
    const claves = encabezadoValido({ titulo: "titulo: &anchor *ref" });
    const resultado = parsearPage(construir(Object.values(claves)));
    expect(esErrorDeParseo(resultado)).toBe(true);
  });

  test("acumula varios problemas distintos del encabezado en una sola pasada", () => {
    const claves = encabezadoValido({ tipo: 'tipo: "fila"', titulo: "titulo: sin comillas" });
    delete (claves as Record<string, string | undefined>).parent_id;
    const resultado = parsearPage(construir(Object.values(claves)));

    expect(esErrorDeParseo(resultado)).toBe(true);
    const errores = resultado as ErrorValidacion[];
    expect(errores.length).toBeGreaterThanOrEqual(3);
    expect(errores.every((error) => error.severidad === "error")).toBe(true);
    expect(errores.every((error) => error.codigo === "ENCABEZADO_INVALIDO")).toBe(true);
  });

  test('una línea de encabezado que no matchea "clave: valor" en absoluto', () => {
    const contenido = construir([...Object.values(encabezadoValido()).slice(0, 5), "esto-no-tiene-forma-clave-valor"]);
    const resultado = parsearPage(contenido);
    expect(esErrorDeParseo(resultado)).toBe(true);
  });
});

describe("esErrorDeParseo", () => {
  test("true para un array de errores, false para un Page", () => {
    expect(esErrorDeParseo([])).toBe(true);
    expect(esErrorDeParseo(crearPage())).toBe(false);
  });
});
