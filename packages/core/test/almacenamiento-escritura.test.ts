import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConflictoDeEscritura,
  escribirConCas,
  escribirDatabase,
  escribirPage,
  escribirRow,
  InconsistenciaIdArchivo,
} from "../src/almacenamiento/escritura.ts";
import { hashDeArchivo } from "../src/almacenamiento/hash.ts";
import { esErrorDeLectura, leerDatabase, leerPage, leerRow } from "../src/almacenamiento/lectura.ts";
import { serializarRow } from "../src/formato/database-row.ts";
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

function propTexto(id: string): Property {
  return { id, nombre: id, tipo: "texto", requerida: false };
}

/** Ningún archivo temporal (`.tmp-*`) suelto en el directorio — la escritura atómica nunca deja uno atrás, ni en éxito ni en conflicto. */
async function sinTemporalesSueltos(dir: string): Promise<string[]> {
  const entradas = await readdir(dir);
  return entradas.filter((nombre) => nombre.includes(".tmp-"));
}

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-escritura-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("escritura y lectura normal: éxito", () => {
  test("Page: escribir y volver a leer da el mismo objeto", async () => {
    const page = crearPage();
    const resultado = await escribirPage(raiz, "pagina-1.md", page, null);
    expect(resultado.path).toBe(join(raiz, "pagina-1.md"));

    const leido = await leerPage(raiz, "pagina-1.md");
    expect(esErrorDeLectura(leido)).toBe(false);
    if (esErrorDeLectura(leido)) throw new Error("no debería fallar");
    expect(leido.valor).toEqual(page);
    expect(leido.hash).toBe(resultado.hash);
  });

  test("Database: escribir y volver a leer da el mismo objeto", async () => {
    const db = crearDatabase({ propiedades: [propTexto("p1")] });
    await escribirDatabase(raiz, "db-1.json", db, null);

    const leido = await leerDatabase(raiz, "db-1.json");
    expect(esErrorDeLectura(leido)).toBe(false);
    if (esErrorDeLectura(leido)) throw new Error("no debería fallar");
    expect(leido.valor).toEqual(db);
  });

  test("Row: escribir y volver a leer da el mismo objeto", async () => {
    const db = crearDatabase({ propiedades: [propTexto("p1")] });
    const row = crearRow({ valores: [{ propertyId: "p1", valor: "hola" }] });
    await escribirRow(raiz, "row-1.json", row, null);

    const leido = await leerRow(raiz, "row-1.json", db);
    expect(esErrorDeLectura(leido)).toBe(false);
    if (esErrorDeLectura(leido)) throw new Error("no debería fallar");
    expect(leido.valor).toEqual(row);
  });
});

describe("consistencia id-vs-filename al escribir (guarda defensiva simétrica a la lectura)", () => {
  test("rechaza escribir un objeto cuyo id no coincide con el id del nombre de archivo destino", async () => {
    const page = crearPage({ id: "otro-id" });
    await expect(escribirPage(raiz, "pagina-1.md", page, null)).rejects.toBeInstanceOf(InconsistenciaIdArchivo);
    expect(await readdir(raiz)).toEqual([]);
  });
});

describe("CAS: detecta un conflicto real", () => {
  test("dos lecturas seguidas de dos escrituras: la segunda debe fallar porque el archivo cambió entre medio", async () => {
    const original = crearPage();
    await escribirPage(raiz, "pagina-1.md", original, null);

    const lectura1 = await leerPage(raiz, "pagina-1.md");
    const lectura2 = await leerPage(raiz, "pagina-1.md");
    if (esErrorDeLectura(lectura1) || esErrorDeLectura(lectura2)) throw new Error("no debería fallar el parseo");

    // La primera escritura, basada en el hash que capturó lectura1, tiene éxito...
    const modificadaPorA = { ...original, titulo: "Modificado por A", actualizadoEn: ACTUALIZADO };
    await escribirPage(raiz, "pagina-1.md", modificadaPorA, lectura1.hash);

    // ...y deja el hash en disco desincronizado del que capturó lectura2: la
    // segunda escritura, con el hash viejo, tiene que abortar.
    const modificadaPorB = { ...original, titulo: "Modificado por B", actualizadoEn: ACTUALIZADO };
    await expect(escribirPage(raiz, "pagina-1.md", modificadaPorB, lectura2.hash)).rejects.toBeInstanceOf(
      ConflictoDeEscritura,
    );

    // El archivo final refleja solo la escritura que ganó — nunca una fusión, nunca la perdedora.
    const final = await leerPage(raiz, "pagina-1.md");
    if (esErrorDeLectura(final)) throw new Error("no debería fallar el parseo");
    expect(final.valor.titulo).toBe("Modificado por A");
  });

  test("crear con hashEsperado null falla si otra operación ya creó el archivo (dos 'creaciones' concurrentes del mismo id)", async () => {
    const page = crearPage();
    await escribirPage(raiz, "pagina-1.md", page, null);

    // Un segundo intento de "creación" (hashEsperado null, como si no supiera
    // que el archivo ya existe) tiene que fallar igual que una actualización
    // con un hash viejo — es el mismo mecanismo de CAS.
    await expect(escribirPage(raiz, "pagina-1.md", { ...page, titulo: "otra" }, null)).rejects.toBeInstanceOf(
      ConflictoDeEscritura,
    );
  });

  test("escribirConCas de bajo nivel: hashEsperado incorrecto sobre un archivo existente aborta", async () => {
    const destino = join(raiz, "row-1.json");
    await Bun.write(destino, serializarRow(crearRow()));
    const hashViejo = await hashDeArchivo(destino);
    // cambia el archivo por fuera, simulando otra operación concurrente
    await Bun.write(destino, serializarRow(crearRow({ titulo: "cambiado por afuera" })));

    await expect(escribirConCas(destino, serializarRow(crearRow({ titulo: "mi intento" })), hashViejo)).rejects.toBeInstanceOf(
      ConflictoDeEscritura,
    );
  });
});

describe("CAS bajo concurrencia real (dos escrituras que corren en paralelo, no una tras otra)", () => {
  // A diferencia de "CAS: detecta un conflicto real" arriba (secuencial:
  // cada `await` completa antes de que arranque la siguiente línea), acá
  // las dos escrituras arrancan juntas y corren en paralelo desde el mismo
  // hash de partida — el caso real de dos agentes escribiendo el mismo
  // archivo *a la vez* que el CAS existe para cubrir. Se repite varias
  // veces porque una sola corrida podría no exponer una ventana de carrera
  // por buena suerte en el scheduling.
  const TRIALS = 25;

  test("dos actualizaciones concurrentes desde el mismo hash: exactamente una tiene éxito, la otra recibe ConflictoDeEscritura (nunca las dos)", async () => {
    for (let i = 0; i < TRIALS; i++) {
      const nombreArchivo = `concurrencia-update-${i}.md`;
      const original = crearPage({ id: `concurrencia-update-${i}` });
      await escribirPage(raiz, nombreArchivo, original, null);

      const lectura = await leerPage(raiz, nombreArchivo);
      if (esErrorDeLectura(lectura)) throw new Error("no debería fallar el parseo");

      // Ambas escrituras arrancan desde el mismo hash y corren en paralelo
      // (sin `await` entre medio) — ninguna sabe de la otra.
      const intentoA = escribirPage(raiz, nombreArchivo, { ...original, titulo: "A" }, lectura.hash);
      const intentoB = escribirPage(raiz, nombreArchivo, { ...original, titulo: "B" }, lectura.hash);
      const resultados = await Promise.allSettled([intentoA, intentoB]);

      const exitos = resultados.filter((r) => r.status === "fulfilled");
      const fallos = resultados.filter((r) => r.status === "rejected");
      expect(exitos.length).toBe(1);
      expect(fallos.length).toBe(1);
      expect((fallos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictoDeEscritura);

      expect(await sinTemporalesSueltos(raiz)).toEqual([]);
    }
  });

  test("dos 'creaciones' concurrentes del mismo id (hashEsperado null en ambas): exactamente una tiene éxito, la otra recibe ConflictoDeEscritura (nunca las dos)", async () => {
    for (let i = 0; i < TRIALS; i++) {
      const nombreArchivo = `concurrencia-create-${i}.md`;
      const pageA = crearPage({ id: `concurrencia-create-${i}`, titulo: "A" });
      const pageB = crearPage({ id: `concurrencia-create-${i}`, titulo: "B" });

      const intentoA = escribirPage(raiz, nombreArchivo, pageA, null);
      const intentoB = escribirPage(raiz, nombreArchivo, pageB, null);
      const resultados = await Promise.allSettled([intentoA, intentoB]);

      const exitos = resultados.filter((r) => r.status === "fulfilled");
      const fallos = resultados.filter((r) => r.status === "rejected");
      expect(exitos.length).toBe(1);
      expect(fallos.length).toBe(1);
      expect((fallos[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictoDeEscritura);

      expect(await sinTemporalesSueltos(raiz)).toEqual([]);
      expect((await readdir(raiz)).includes(nombreArchivo)).toBe(true);
    }
  });
});

describe("escritura atómica: nunca queda un archivo a medio escribir en el path final", () => {
  test("una escritura exitosa no deja ningún temporal atrás", async () => {
    await escribirRow(raiz, "row-1.json", crearRow(), null);

    expect(await sinTemporalesSueltos(raiz)).toEqual([]);
    expect((await readdir(raiz)).sort()).toEqual(["row-1.json"]);
  });

  test("una escritura que aborta por conflicto tampoco deja ningún temporal atrás, y el archivo final queda intacto", async () => {
    const db = crearDatabase({ propiedades: [propTexto("p1")] });
    const original = crearRow({ valores: [{ propertyId: "p1", valor: "original" }] });
    await escribirRow(raiz, "row-1.json", original, null);

    const lectura = await leerRow(raiz, "row-1.json", db);
    if (esErrorDeLectura(lectura)) throw new Error("no debería fallar el parseo");

    // otra operación concurrente pisa el archivo antes de que se confirme esta escritura
    const otraModificacion = { ...original, titulo: "cambiado por otro agente" };
    await Bun.write(join(raiz, "row-1.json"), serializarRow(otraModificacion));

    const miIntento = { ...original, titulo: "mi cambio, no debería aplicarse" };
    await expect(escribirRow(raiz, "row-1.json", miIntento, lectura.hash)).rejects.toBeInstanceOf(
      ConflictoDeEscritura,
    );

    // sin temporal suelto, y el único archivo presente es el de la modificación legítima
    expect(await sinTemporalesSueltos(raiz)).toEqual([]);
    expect((await readdir(raiz)).sort()).toEqual(["row-1.json"]);

    const final = await leerRow(raiz, "row-1.json", db);
    if (esErrorDeLectura(final)) throw new Error("no debería fallar el parseo");
    expect(final.valor.titulo).toBe("cambiado por otro agente");
  });

  test("el path final nunca se toca directamente: escribirConCas siempre escribe a un temporal en el mismo directorio antes del rename", async () => {
    const destino = join(raiz, "pagina-1.md");
    const resultado = await escribirConCas(destino, "contenido final", null);
    expect(resultado.path).toBe(destino);
    expect(await Bun.file(destino).text()).toBe("contenido final");
    expect(await sinTemporalesSueltos(raiz)).toEqual([]);
  });
});
