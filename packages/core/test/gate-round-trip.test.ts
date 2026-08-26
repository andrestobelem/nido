/**
 * T-0011 — Gate de aceptación de round-trip sin pérdida.
 *
 * Este archivo NO agrega dominio nuevo: ejercita end-to-end lo que T-0015 a
 * T-0019 ya implementan (`../src/formato/*.ts`, `../src/almacenamiento/*.ts`,
 * `../src/indice/*.ts`, `../src/crud/*.ts`), con escenarios de aceptación de
 * más alto nivel que ninguna capa individual cubre por sí sola:
 *
 * 1. Round-trip repo→base→repo de contenido adversarial (unicode, emoji,
 *    comillas/backslashes, valores límite de numero/fecha, multi_select con
 *    muchas opciones), releído simulando un **proceso nuevo**:
 *    `construirIndice` reconstruye el índice desde cero a partir de los
 *    archivos en disco, nunca reusando el objeto en memoria que
 *    `crearPage`/`crearDatabase`/`crearRow` acaban de devolver.
 * 2. Archivo borrado externamente (`node:fs` `unlink` directo, no vía la
 *    API): qué reporta el CRUD/índice — el caso nuevo de este ticket,
 *    ninguna capa anterior lo cubre explícitamente.
 *
 * Lo que este archivo NO reimplementa (ver `docs/gate-round-trip.md`):
 * CAS bajo escritura concurrente real (dos escritores en paralelo sobre el
 * mismo archivo) ya está cubierto por
 * `almacenamiento-escritura.test.ts` ("CAS bajo concurrencia real...") — se
 * referencia, no se duplica.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConflictoDeEscritura } from "../src/almacenamiento/escritura.ts";
import { esErrorDeLectura, NodoNoEncontrado } from "../src/almacenamiento/lectura.ts";
import { actualizarDatabase, crearDatabase, leerDatabase } from "../src/crud/database.ts";
import { DatabaseNoIndexada } from "../src/crud/errores.ts";
import { actualizarPage, crearPage, leerPage } from "../src/crud/page.ts";
import { actualizarRow, crearRow, leerRow } from "../src/crud/row.ts";
import { agregarVista, resolverVistaDeDatabase } from "../src/crud/vistas.ts";
import { construirIndice } from "../src/indice/construccion.ts";
import { esErrorDeConsulta } from "../src/indice/vistas.ts";
import type { Property, PropertyValue, Row, View } from "../src/types.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-gate-round-trip-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Contenido adversarial reusable
// ---------------------------------------------------------------------------

/** Unicode multi-byte, emoji con modificador de tono + ZWJ, comillas dobles/simples, backslashes, tabs, saltos de línea — todo lo que un valor de texto libre (cuerpo de Page, PropertyValue de tipo texto) puede legítimamente contener. */
const TEXTO_ADVERSARIAL =
  '日本語のテスト — "comillas" y \'simples\', backslash \\ doble \\\\, tab\ty salto\nde línea, emoji 👍🏽 familia 👨‍👩‍👧‍👦, café con ñandú, ¡órale! Ω≈ç√∫˜µ≤≥÷';

/** Igual que arriba pero sin salto de línea, porque `titulo` de una Page (ADR-002 sección 2) es de una sola línea por asunción de dominio — este es contenido adversarial que sí es válido para ese campo. */
const TITULO_ADVERSARIAL = '日本語 "título" con \'comillas\' y \\backslash\\ 👍🏽 y emoji compuesto 👨‍👩‍👧‍👦 — ñandú, Ω≈ç√∫';

function generarOpcionesMultiSelect(cantidad: number) {
  return Array.from({ length: cantidad }, (_, i) => ({ id: `opt-${String(i).padStart(3, "0")}`, nombre: `Opción ${i}` }));
}

const CANTIDAD_OPCIONES_MULTI_SELECT = 60;
const OPCIONES_MULTI_SELECT = generarOpcionesMultiSelect(CANTIDAD_OPCIONES_MULTI_SELECT);

function propiedadesAdversariales(): Property[] {
  return [
    { id: "p-texto", nombre: "Texto", tipo: "texto", requerida: false },
    { id: "p-numero", nombre: "Numero", tipo: "numero", requerida: false },
    { id: "p-fecha", nombre: "Fecha", tipo: "fecha", requerida: false },
    { id: "p-checkbox", nombre: "Checkbox", tipo: "checkbox", requerida: false },
    { id: "p-agente", nombre: "Agente", tipo: "agente", requerida: false },
    {
      id: "p-select",
      nombre: "Select",
      tipo: "select",
      requerida: false,
      config: { opciones: [{ id: "s-a", nombre: "A" }, { id: "s-b", nombre: "B" }] },
    },
    {
      id: "p-multi",
      nombre: "MultiSelect",
      tipo: "multi_select",
      requerida: false,
      config: { opciones: OPCIONES_MULTI_SELECT },
    },
  ];
}

/**
 * Valores límite: enteros seguros máximo/mínimo, `Number.MAX_VALUE`,
 * `Number.EPSILON`, un negativo con decimales, cero positivo (nunca -0, que
 * ADR-002 rechaza explícitamente en validación); fechas límite de calendario
 * (año 1, año 9999, 29 de febrero de un año bisiesto); un subconjunto grande
 * y desordenado de las opciones de multi_select (para ejercitar "muchas
 * opciones" de punta a punta, con ids repetidos a propósito para confirmar
 * que la deduplicación del round-trip no pierde ninguna opción distinta).
 */
function valoresAdversariales(overrides: Partial<Record<string, unknown>> = {}): PropertyValue[] {
  const multiSelectDesordenadoConDuplicados = [
    OPCIONES_MULTI_SELECT[45]!.id,
    OPCIONES_MULTI_SELECT[3]!.id,
    OPCIONES_MULTI_SELECT[45]!.id, // duplicado deliberado
    OPCIONES_MULTI_SELECT[59]!.id,
    OPCIONES_MULTI_SELECT[0]!.id,
    OPCIONES_MULTI_SELECT[3]!.id, // duplicado deliberado
  ];

  const base: Record<string, unknown> = {
    "p-texto": TEXTO_ADVERSARIAL,
    "p-numero": overrides["p-numero"] ?? Number.MAX_SAFE_INTEGER,
    "p-fecha": overrides["p-fecha"] ?? "9999-12-31",
    "p-checkbox": true,
    "p-agente": "agente-de-prueba-👾",
    "p-select": "s-b",
    "p-multi": multiSelectDesordenadoConDuplicados,
    ...overrides,
  };

  return Object.entries(base).map(([propertyId, valor]) => ({ propertyId, valor: valor as PropertyValue["valor"] }));
}

/** El resultado canónico esperado tras el round-trip: multi_select ordenado lexicográficamente y deduplicado (ADR-002 sección 3) — mismo criterio ya probado en `formato-database-row.test.ts`, replicado acá solo como expectativa del round-trip completo, no como test de la regla en sí. */
function multiSelectCanonico(ids: string[]): string[] {
  return [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 1. Round-trip end-to-end de contenido adversarial, releído desde cero
// ---------------------------------------------------------------------------

describe("gate round-trip: Page con contenido adversarial, reconstruyendo el índice desde cero", () => {
  test("unicode, emoji, comillas y backslashes en título y cuerpo sobreviven crear -> construirIndice (proceso nuevo) sin pérdida", async () => {
    const cuerpoAdversarial = `# ${TEXTO_ADVERSARIAL}\n\n${TEXTO_ADVERSARIAL}\n\n\`\`\`js\nconst x = "\\"escaped\\"";\n\`\`\`\n\n- item 👍🏽\n- item 日本語\n`;

    const creada = await crearPage(raiz, {
      titulo: TITULO_ADVERSARIAL,
      cuerpo: cuerpoAdversarial,
      parentId: null,
    });

    // Simula un proceso nuevo: construye el índice desde cero a partir de
    // los archivos en disco, sin reusar `creada` para nada más que el id.
    const indice = await construirIndice(raiz);

    const indexado = indice.paginas.get(creada.valor.id);
    expect(indexado).toBeDefined();
    expect(indexado!.valor).toEqual(creada.valor);
    expect(indexado!.valor.titulo).toBe(TITULO_ADVERSARIAL);
    expect(indexado!.valor.cuerpo).toBe(cuerpoAdversarial);
    expect(indice.diagnosticos).toEqual([]);

    // También por la vía de lectura puntual de CRUD (T-0019), releyendo
    // como si fuera la primera vez que este proceso ve el archivo.
    const releida = await leerPage(raiz, creada.valor.id);
    if (esErrorDeLectura(releida)) throw new Error("no debería fallar");
    expect(releida.valor).toEqual(creada.valor);
  });
});

describe("gate round-trip: Database + Row con contenido adversarial, reconstruyendo el índice desde cero", () => {
  test("valores límite de numero/fecha, unicode/emoji en texto, y multi_select con muchas opciones sobreviven crear -> construirIndice sin pérdida", async () => {
    const dbCreada = await crearDatabase(raiz, {
      titulo: TITULO_ADVERSARIAL,
      parentId: null,
      propiedades: propiedadesAdversariales(),
    });

    const filaCreada = await crearRow(raiz, dbCreada.valor, {
      titulo: TITULO_ADVERSARIAL,
      valores: valoresAdversariales(),
    });
    expect(filaCreada.advertencias).toEqual([]);

    // "Proceso nuevo": índice construido desde cero, no el objeto en memoria.
    const indice = await construirIndice(raiz);
    expect(indice.diagnosticos).toEqual([]);

    const dbIndexada = indice.databases.get(dbCreada.valor.id);
    expect(dbIndexada).toBeDefined();
    expect(dbIndexada!.valor).toEqual(dbCreada.valor);

    const filaIndexada = indice.filas.get(filaCreada.valor.id);
    expect(filaIndexada).toBeDefined();
    const valores = filaIndexada!.valor.valores;
    const porId = new Map(valores.map((v) => [v.propertyId, v.valor]));

    expect(porId.get("p-texto")).toBe(TEXTO_ADVERSARIAL);
    expect(porId.get("p-numero")).toBe(Number.MAX_SAFE_INTEGER);
    expect(porId.get("p-fecha")).toBe("9999-12-31");
    expect(porId.get("p-checkbox")).toBe(true);
    expect(porId.get("p-agente")).toBe("agente-de-prueba-👾");
    expect(porId.get("p-select")).toBe("s-b");

    // multi_select: las opciones distintas sobreviven todas, deduplicadas y
    // ordenadas — ninguna se pierde a pesar de los duplicados deliberados.
    const multiSelectEsperado = multiSelectCanonico([
      OPCIONES_MULTI_SELECT[45]!.id,
      OPCIONES_MULTI_SELECT[3]!.id,
      OPCIONES_MULTI_SELECT[59]!.id,
      OPCIONES_MULTI_SELECT[0]!.id,
    ]);
    expect(porId.get("p-multi")).toEqual(multiSelectEsperado);

    // Y por la vía de lectura puntual de CRUD, releyendo desde cero.
    const dbReleida = await leerDatabase(raiz, dbCreada.valor.id);
    if (esErrorDeLectura(dbReleida)) throw new Error("no debería fallar");
    const filaReleida = await leerRow(raiz, dbReleida.valor, filaCreada.valor.id);
    if (esErrorDeLectura(filaReleida)) throw new Error("no debería fallar");
    expect(filaReleida.valor).toEqual(filaIndexada!.valor);
  });

  test("valores límite adicionales de numero (MAX_VALUE, EPSILON, negativo decimal, cero) y fecha (año 1, bisiesto) sobreviven el round-trip", async () => {
    const casos: { numero: number; fecha: string }[] = [
      { numero: Number.MAX_VALUE, fecha: "0001-01-01" },
      { numero: Number.EPSILON, fecha: "2024-02-29" }, // 29 de febrero de un año bisiesto real
      { numero: -123456.789, fecha: "2000-02-29" },
      { numero: 0, fecha: "1999-12-31" }, // cero positivo explícito, nunca -0
      { numero: Number.MIN_SAFE_INTEGER, fecha: "2026-01-01" },
    ];

    const dbCreada = await crearDatabase(raiz, {
      titulo: "límites",
      parentId: null,
      propiedades: propiedadesAdversariales(),
    });

    const filasCreadas: Row[] = [];
    for (const [i, caso] of casos.entries()) {
      const fila = await crearRow(raiz, dbCreada.valor, {
        titulo: `caso ${i}`,
        valores: [
          { propertyId: "p-numero", valor: caso.numero },
          { propertyId: "p-fecha", valor: caso.fecha },
        ],
      });
      filasCreadas.push(fila.valor);
    }

    // Proceso nuevo, sin reusar `filasCreadas` como fuente de verdad — se
    // usa solo para saber qué ids buscar en el índice reconstruido.
    const indice = await construirIndice(raiz);
    expect(indice.diagnosticos).toEqual([]);

    for (const [i, caso] of casos.entries()) {
      const idBuscado = filasCreadas[i]!.id;
      const indexada = indice.filas.get(idBuscado);
      expect(indexada).toBeDefined();
      const porId = new Map(indexada!.valor.valores.map((v) => [v.propertyId, v.valor]));
      expect(porId.get("p-numero")).toBe(caso.numero);
      expect(porId.get("p-fecha")).toBe(caso.fecha);
    }
  });

  test("una View con filtros/orden sobre las properties adversariales resuelve, tras reconstruir el índice desde cero, exactamente la Row esperada", async () => {
    const dbCreada = await crearDatabase(raiz, {
      titulo: "vista adversarial",
      parentId: null,
      propiedades: propiedadesAdversariales(),
    });

    const filaCoincide = await crearRow(raiz, dbCreada.valor, {
      titulo: TITULO_ADVERSARIAL,
      valores: valoresAdversariales({ "p-numero": 42 }),
    });
    await crearRow(raiz, dbCreada.valor, {
      titulo: "no coincide",
      valores: valoresAdversariales({ "p-numero": 1, "p-select": "s-a" }),
    });

    const view: View = {
      id: "v-1",
      nombre: "select es B",
      databaseId: dbCreada.valor.id,
      filtros: {
        combinador: "y",
        condiciones: [{ campo: { tipo: "propiedad", propertyId: "p-select" }, operador: "igual", valor: "s-b" }],
      },
      orden: [{ campo: { tipo: "propiedad", propertyId: "p-numero" }, direccion: "desc" }],
    };
    await agregarVista(raiz, dbCreada.valor, dbCreada.hash, view);

    // resolverVistaDeDatabase construye su propio índice fresco internamente
    // — es, por construcción, la vía "proceso nuevo" para resolver una View.
    const resultado = await resolverVistaDeDatabase(raiz, dbCreada.valor.id, view.id);
    if (esErrorDeConsulta(resultado)) throw new Error("la View no debería fallar a validar");
    expect(resultado.filas.map((f) => f.id)).toEqual([filaCoincide.valor.id]);
    expect(resultado.filas[0]!.titulo).toBe(TITULO_ADVERSARIAL);
  });
});

// ---------------------------------------------------------------------------
// 2. Archivo borrado externamente (node:fs unlink directo, no vía la API)
// ---------------------------------------------------------------------------

describe("gate: archivo borrado externamente — falla de forma clara, nunca en silencio ni con un stack críptico", () => {
  test("leer una Row cuyo archivo fue borrado con unlink() directo lanza NodoNoEncontrado (CRUD, T-0019)", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [] });
    const fila = await crearRow(raiz, db.valor, { titulo: "a borrar", valores: [] });

    await unlink(join(raiz, `${fila.valor.id}.json`));

    await expect(leerRow(raiz, db.valor, fila.valor.id)).rejects.toBeInstanceOf(NodoNoEncontrado);
  });

  test("leer una Page cuyo archivo fue borrado con unlink() directo lanza NodoNoEncontrado (CRUD, T-0019)", async () => {
    const page = await crearPage(raiz, { titulo: "a borrar", cuerpo: "x", parentId: null });

    await unlink(join(raiz, `${page.valor.id}.md`));

    await expect(leerPage(raiz, page.valor.id)).rejects.toBeInstanceOf(NodoNoEncontrado);
  });

  test("construirIndice desde cero tras borrar una Row externamente: el índice se construye limpio, sin la Row borrada y sin diagnósticos espurios", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [] });
    const filaQueQueda = await crearRow(raiz, db.valor, { titulo: "sobrevive", valores: [] });
    const filaABorrar = await crearRow(raiz, db.valor, { titulo: "a borrar", valores: [] });

    await unlink(join(raiz, `${filaABorrar.valor.id}.json`));

    const indice = await construirIndice(raiz);

    // No cuelga, no lanza, no hay un diagnóstico espurio sobre un archivo
    // que ya no existe: el índice queda simplemente sin ese nodo, tal como
    // si nunca hubiera sido candidato en este escaneo (ADR-002 sección 5,
    // punto 9: "carrera benigna", no un archivo roto).
    expect(indice.filas.has(filaABorrar.valor.id)).toBe(false);
    expect(indice.filas.has(filaQueQueda.valor.id)).toBe(true);
    expect(indice.diagnosticos).toEqual([]);
  });

  test("actualizar una Row con un hash capturado antes de que su archivo fuera borrado externamente reporta ConflictoDeEscritura, nunca un error interno críptico ni un colgado", async () => {
    const db = await crearDatabase(raiz, { titulo: "db", parentId: null, propiedades: [] });
    const fila = await crearRow(raiz, db.valor, { titulo: "original", valores: [] });

    await unlink(join(raiz, `${fila.valor.id}.json`));

    await expect(
      actualizarRow(raiz, db.valor, fila.valor, fila.hash, { titulo: "no debería aplicarse" }),
    ).rejects.toBeInstanceOf(ConflictoDeEscritura);
  });

  test("actualizar una Page con un hash capturado antes de que su archivo fuera borrado externamente reporta ConflictoDeEscritura", async () => {
    const page = await crearPage(raiz, { titulo: "original", cuerpo: "x", parentId: null });

    await unlink(join(raiz, `${page.valor.id}.md`));

    await expect(
      actualizarPage(raiz, page.valor, page.hash, { titulo: "no debería aplicarse" }),
    ).rejects.toBeInstanceOf(ConflictoDeEscritura);
  });

  test("actualizar una Database con un hash capturado antes de que su archivo fuera borrado externamente reporta ConflictoDeEscritura", async () => {
    const db = await crearDatabase(raiz, { titulo: "original", parentId: null });

    await unlink(join(raiz, `${db.valor.id}.json`));

    await expect(
      actualizarDatabase(raiz, db.valor, db.hash, { titulo: "no debería aplicarse" }),
    ).rejects.toBeInstanceOf(ConflictoDeEscritura);
  });

  test("borrar la Database externamente deja a sus Rows huérfanas: construirIndice las excluye y reporta PARENT_ID_INVALIDO, no las hace desaparecer en silencio", async () => {
    const db = await crearDatabase(raiz, { titulo: "db a borrar", parentId: null, propiedades: [] });
    const fila = await crearRow(raiz, db.valor, { titulo: "huérfana tras el borrado", valores: [] });

    await unlink(join(raiz, `${db.valor.id}.json`));

    const indice = await construirIndice(raiz);

    expect(indice.databases.has(db.valor.id)).toBe(false);
    expect(indice.filas.has(fila.valor.id)).toBe(false);
    expect(indice.diagnosticos.some((d) => d.error.codigo === "PARENT_ID_INVALIDO" && d.error.nodoId === fila.valor.id)).toBe(
      true,
    );
  });

  test("resolver una View sobre una Database borrada externamente reporta DatabaseNoIndexada, no cuelga ni lanza un error interno de bun:sqlite/fs sin contexto", async () => {
    const db = await crearDatabase(raiz, { titulo: "a borrar", parentId: null });
    const view: View = {
      id: "v-1",
      nombre: "cualquiera",
      databaseId: db.valor.id,
      filtros: null,
      orden: [],
    };
    await agregarVista(raiz, db.valor, db.hash, view);

    await unlink(join(raiz, `${db.valor.id}.json`));

    await expect(resolverVistaDeDatabase(raiz, db.valor.id, view.id)).rejects.toBeInstanceOf(DatabaseNoIndexada);
  });
});
