/**
 * Tests de `../src/crud/page.ts` (T-0019). Directorio temporal real
 * (`mkdtemp`), sin mocks de filesystem.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConflictoDeEscritura } from "../src/almacenamiento/escritura.ts";
import { esErrorDeLectura } from "../src/almacenamiento/lectura.ts";
import { actualizarPage, crearPage, leerPage } from "../src/crud/page.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-crud-page-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("crud/page: crear + leer", () => {
  test("crear una Page y volver a leerla da el mismo objeto", async () => {
    const creada = await crearPage(raiz, { titulo: "Hola", cuerpo: "mundo", parentId: null });
    expect(creada.valor.titulo).toBe("Hola");
    expect(creada.valor.cuerpo).toBe("mundo");
    expect(creada.valor.parentId).toBeNull();
    expect(creada.valor.creadoEn).toBe(creada.valor.actualizadoEn);

    const leida = await leerPage(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor).toEqual(creada.valor);
    expect(leida.hash).toBe(creada.hash);
  });

  test("dos Page creadas seguidas obtienen ids distintos", async () => {
    const a = await crearPage(raiz, { titulo: "A", cuerpo: "", parentId: null });
    const b = await crearPage(raiz, { titulo: "B", cuerpo: "", parentId: null });
    expect(a.valor.id).not.toBe(b.valor.id);
  });

  test("una Page hija referencia a su padre por parentId", async () => {
    const padre = await crearPage(raiz, { titulo: "Padre", cuerpo: "", parentId: null });
    const hija = await crearPage(raiz, { titulo: "Hija", cuerpo: "", parentId: padre.valor.id });
    expect(hija.valor.parentId).toBe(padre.valor.id);
  });
});

describe("crud/page: actualizar respeta CAS", () => {
  test("actualizar con el hash correcto tiene éxito y persiste el cambio", async () => {
    const creada = await crearPage(raiz, { titulo: "Original", cuerpo: "x", parentId: null });
    const actualizada = await actualizarPage(raiz, creada.valor, creada.hash, { titulo: "Nuevo título" });
    expect(actualizada.valor.titulo).toBe("Nuevo título");
    expect(actualizada.valor.cuerpo).toBe("x");

    const leida = await leerPage(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("Nuevo título");
    expect(leida.hash).toBe(actualizada.hash);
  });

  test("un conflicto real se reporta, nunca se sobrescribe en silencio", async () => {
    const creada = await crearPage(raiz, { titulo: "Original", cuerpo: "x", parentId: null });

    // Otro agente actualiza primero, usando el hash real capturado en la creación.
    await actualizarPage(raiz, creada.valor, creada.hash, { titulo: "Escrito por otro agente" });

    // Mi intento, todavía con el hash viejo (de antes de esa escritura), tiene que abortar.
    await expect(
      actualizarPage(raiz, creada.valor, creada.hash, { titulo: "Mi cambio, no debería aplicarse" }),
    ).rejects.toBeInstanceOf(ConflictoDeEscritura);

    // El archivo final refleja solo la escritura que ganó.
    const leida = await leerPage(raiz, creada.valor.id);
    if (esErrorDeLectura(leida)) throw new Error("no debería fallar");
    expect(leida.valor.titulo).toBe("Escrito por otro agente");
  });
});
