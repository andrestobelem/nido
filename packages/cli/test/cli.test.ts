/**
 * Tests de `../src/cli.ts` (T-0013), mismo patrón que
 * `packages/tickets/test/cli.test.ts`: `Bun.spawn` del binario real (no se
 * llama a `main()` in-process) contra un `NIDO_WORKSPACE_DIR` temporal por
 * test, para ejercitar el criterio de éxito de punta a punta — argv real,
 * proceso real, exit code real.
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nido-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function nido(args: string[]) {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, NIDO_WORKSPACE_DIR: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function nidoJson(args: string[]) {
  const { stdout, exitCode } = await nido([...args, "--json"]);
  return { salida: JSON.parse(stdout), exitCode };
}

// ---------------------------------------------------------------------------
// Criterio de éxito de punta a punta: Page, Database (3+ tipos de Property,
// select con opciones), 3+ Rows con valores variados, y una View ad-hoc con
// filtro real + orden multi-campo.
// ---------------------------------------------------------------------------

test("page create + page get: la Page sobrevive el ciclo completo", async () => {
  const creada = await nidoJson(["page", "create", "--titulo", "Notas", "--cuerpo", "primer párrafo"]);
  expect(creada.exitCode).toBe(0);
  expect(creada.salida.ok).toBe(true);
  expect(creada.salida.datos.titulo).toBe("Notas");
  expect(creada.salida.datos.cuerpo).toBe("primer párrafo");
  expect(creada.salida.datos.parentId).toBeNull();
  expect(typeof creada.salida.datos.hash).toBe("string");

  const leida = await nidoJson(["page", "get", creada.salida.datos.id]);
  expect(leida.exitCode).toBe(0);
  expect(leida.salida.datos).toEqual(creada.salida.datos);
});

test("page create con --parent anida bajo otra Page", async () => {
  const padre = await nidoJson(["page", "create", "--titulo", "Padre"]);
  const hija = await nidoJson(["page", "create", "--titulo", "Hija", "--parent", padre.salida.datos.id]);
  expect(hija.salida.datos.parentId).toBe(padre.salida.datos.id);
});

const PROPIEDADES = [
  { id: "p_nota", nombre: "nota", tipo: "texto", requerida: false },
  { id: "p_prioridad", nombre: "prioridad", tipo: "numero", requerida: false },
  {
    id: "p_estado",
    nombre: "estado",
    tipo: "select",
    requerida: false,
    config: { opciones: [{ id: "o_todo", nombre: "todo" }, { id: "o_done", nombre: "done" }] },
  },
  { id: "p_urgente", nombre: "urgente", tipo: "checkbox", requerida: false },
];

async function crearDatabaseDeTareas() {
  return await nidoJson(["db", "create", "--titulo", "Tareas", "--propiedades", JSON.stringify(PROPIEDADES)]);
}

test("db create con 4 tipos de Property (incluyendo select con opciones) + db get", async () => {
  const creada = await crearDatabaseDeTareas();
  expect(creada.exitCode).toBe(0);
  expect(creada.salida.datos.propiedades).toHaveLength(4);
  const select = creada.salida.datos.propiedades.find((p: { tipo: string }) => p.tipo === "select");
  expect(select.config.opciones).toEqual([
    { id: "o_todo", nombre: "todo" },
    { id: "o_done", nombre: "done" },
  ]);

  const leida = await nidoJson(["db", "get", creada.salida.datos.id]);
  expect(leida.exitCode).toBe(0);
  expect(leida.salida.datos).toEqual(creada.salida.datos);
});

interface FilaCreada {
  id: string;
  titulo: string;
  valores: { propertyId: string; valor: unknown }[];
}

async function crearFilasDeTareas(databaseId: string): Promise<Record<"alpha" | "bravo" | "delta", FilaCreada>> {
  const valoresAlpha = JSON.stringify([
    { propertyId: "p_nota", valor: "nota alpha" },
    { propertyId: "p_prioridad", valor: 2 },
    { propertyId: "p_estado", valor: "o_todo" },
    { propertyId: "p_urgente", valor: false },
  ]);
  const valoresBravo = JSON.stringify([
    { propertyId: "p_nota", valor: "nota bravo" },
    { propertyId: "p_prioridad", valor: 2 },
    { propertyId: "p_estado", valor: "o_todo" },
    { propertyId: "p_urgente", valor: true },
  ]);
  const valoresDelta = JSON.stringify([
    { propertyId: "p_nota", valor: "nota delta" },
    { propertyId: "p_prioridad", valor: 9 },
    { propertyId: "p_estado", valor: "o_done" },
    { propertyId: "p_urgente", valor: false },
  ]);

  const alpha = await nidoJson(["row", "create", "--db", databaseId, "--titulo", "Alpha", "--valores", valoresAlpha]);
  const bravo = await nidoJson(["row", "create", "--db", databaseId, "--titulo", "Bravo", "--valores", valoresBravo]);
  const delta = await nidoJson(["row", "create", "--db", databaseId, "--titulo", "Delta", "--valores", valoresDelta]);

  for (const fila of [alpha, bravo, delta]) {
    expect(fila.exitCode).toBe(0);
    expect(fila.salida.ok).toBe(true);
    expect(fila.salida.datos.advertencias).toEqual([]);
  }

  return { alpha: alpha.salida.datos, bravo: bravo.salida.datos, delta: delta.salida.datos };
}

test("row create x3 con valores variados + row get devuelve la Row completa", async () => {
  const db = await crearDatabaseDeTareas();
  const filas = await crearFilasDeTareas(db.salida.datos.id);

  expect(filas.alpha.titulo).toBe("Alpha");
  expect(filas.delta.valores).toEqual(
    expect.arrayContaining([{ propertyId: "p_prioridad", valor: 9 }]),
  );

  const leida = await nidoJson(["row", "get", filas.bravo.id]);
  expect(leida.exitCode).toBe(0);
  expect(leida.salida.datos.id).toBe(filas.bravo.id);
  expect(leida.salida.datos.titulo).toBe("Bravo");
  expect(leida.salida.datos.valores).toEqual(
    expect.arrayContaining([{ propertyId: "p_urgente", valor: true }]),
  );
});

test("view query: filtro real (select) + orden multi-campo (numero, luego titulo) da el resultado exacto esperado", async () => {
  const db = await crearDatabaseDeTareas();
  const filas = await crearFilasDeTareas(db.salida.datos.id);

  const filtros = JSON.stringify({
    combinador: "y",
    condiciones: [{ campo: { tipo: "propiedad", propertyId: "p_estado" }, operador: "igual", valor: "o_todo" }],
  });
  // alpha y bravo tienen la MISMA prioridad (2) — el segundo campo de orden
  // (titulo, alfabético) es el que de verdad decide el resultado, así el
  // test ejercita "multi-campo" de verdad y no solo un orden de un campo.
  const orden = JSON.stringify([
    { campo: { tipo: "propiedad", propertyId: "p_prioridad" }, direccion: "asc" },
    { campo: { tipo: "campo_base", campo: "titulo" }, direccion: "asc" },
  ]);

  const resultado = await nidoJson(["view", "query", "--db", db.salida.datos.id, "--filtros", filtros, "--orden", orden]);
  expect(resultado.exitCode).toBe(0);
  expect(resultado.salida.datos.diagnosticos).toEqual([]);
  expect(resultado.salida.datos.filas.map((f: { id: string }) => f.id)).toEqual([filas.alpha.id, filas.bravo.id]);
  // delta queda excluida por el filtro (estado = done)
  expect(resultado.salida.datos.filas.map((f: { titulo: string }) => f.titulo)).toEqual(["Alpha", "Bravo"]);
});

test("view query --vista resuelve una View persistida (mutuamente excluyente con --filtros/--orden)", async () => {
  const db = await crearDatabaseDeTareas();
  await crearFilasDeTareas(db.salida.datos.id);

  const combinado = await nido([
    "view",
    "query",
    "--db",
    db.salida.datos.id,
    "--vista",
    "v1",
    "--filtros",
    "{}",
    "--json",
  ]);
  expect(combinado.exitCode).toBe(2); // error de uso: mutuamente excluyentes (ADR-004 sección 3)
  expect(JSON.parse(combinado.stdout).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Errores de uso: comando desconocido, flag faltante, flag desconocido
// ---------------------------------------------------------------------------

test("comando desconocido devuelve código de uso 2", async () => {
  const { exitCode, stdout } = await nido(["nope", "sub", "--json"]);
  expect(exitCode).toBe(2);
  expect(JSON.parse(stdout).ok).toBe(false);
});

test("falta un flag requerido devuelve código de uso 2, no un error de dominio", async () => {
  const sinTitulo = await nidoJson(["page", "create"]);
  expect(sinTitulo.exitCode).toBe(2);
  expect(sinTitulo.salida.ok).toBe(false);

  const sinPropiedades = await nidoJson(["db", "create", "--titulo", "x"]);
  expect(sinPropiedades.exitCode).toBe(2);
});

test("un flag desconocido es un error de uso, no un no-op silencioso", async () => {
  const { exitCode, stdout } = await nido(["page", "create", "--titulo", "x", "--typo", "y", "--json"]);
  expect(exitCode).toBe(2);
  expect(JSON.parse(stdout).ok).toBe(false);
});

test("un flag string SIEMPRE consume el siguiente token, aunque empiece con --", async () => {
  const { stdout, exitCode } = await nido(["page", "create", "--titulo", "--json", "--json"]);
  expect(exitCode).toBe(0);
  const salida = JSON.parse(stdout);
  expect(salida.datos.titulo).toBe("--json");
});

test("acepta la sintaxis --flag=valor", async () => {
  const { stdout, exitCode } = await nido(["page", "create", "--titulo=con-igual", "--json"]);
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout).datos.titulo).toBe("con-igual");
});

test("--propiedades con JSON sintácticamente inválido es error de uso (2), no de dominio", async () => {
  const { exitCode, stdout } = await nido(["db", "create", "--titulo", "x", "--propiedades", "{no-es-json", "--json"]);
  expect(exitCode).toBe(2);
  expect(JSON.parse(stdout).ok).toBe(false);
});

test("page get de un id inexistente es un error de dominio (código 1), no de uso", async () => {
  const { exitCode, stdout } = await nido(["page", "get", "no-existe-este-id", "--json"]);
  expect(exitCode).toBe(1);
  expect(JSON.parse(stdout).ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Regresión de hallazgo de revisión: JSON sintácticamente válido pero de
// FORMA incorrecta en --propiedades/--valores. Antes del fix, esto o
// corrompía el workspace en silencio (éxito falso, exit 0) o crasheaba con
// un error nativo críptico — nunca un error de dominio legible.
// ---------------------------------------------------------------------------

test("--propiedades con forma incorrecta (sin id/nombre/tipo/requerida) es error de dominio (1), nunca un éxito silencioso", async () => {
  const { exitCode, stdout } = await nido(["db", "create", "--titulo", "x", "--propiedades", '[{"foo":"bar"}]', "--json"]);
  const salida = JSON.parse(stdout);
  expect(exitCode).toBe(1);
  expect(salida.ok).toBe(false);
});

test("--propiedades con un select sin config.opciones es error de dominio (1), no un esquema corrupto persistido", async () => {
  const propiedadesRotas = JSON.stringify([{ id: "p1", nombre: "estado", tipo: "select", requerida: false }]);
  const { exitCode, stdout } = await nido(["db", "create", "--titulo", "x", "--propiedades", propiedadesRotas, "--json"]);
  const salida = JSON.parse(stdout);
  expect(exitCode).toBe(1);
  expect(salida.ok).toBe(false);
});

test("--valores como objeto en vez de array es error de dominio (1), no un crash nativo", async () => {
  const db = await crearDatabaseDeTareas();
  const { exitCode, stdout } = await nido([
    "row",
    "create",
    "--db",
    db.salida.datos.id,
    "--valores",
    '{"a":1}',
    "--json",
  ]);
  const salida = JSON.parse(stdout);
  expect(exitCode).toBe(1);
  expect(salida.ok).toBe(false);
});

test("--valores con un elemento sin propertyId es error de dominio (1), nunca un huérfano silencioso persistido", async () => {
  const db = await crearDatabaseDeTareas();
  const { exitCode, stdout } = await nido([
    "row",
    "create",
    "--db",
    db.salida.datos.id,
    "--valores",
    '[{"foo":"bar"}]',
    "--json",
  ]);
  const salida = JSON.parse(stdout);
  expect(exitCode).toBe(1);
  expect(salida.ok).toBe(false);
});

// ---------------------------------------------------------------------------
// Regresión de hallazgo de revisión: `row get` descartaba siempre las
// advertencias reales de la Row (`advertencias: []` hardcodeado), aunque
// `row create` sobre esa misma Row sí las devuelve — mismo dato en disco,
// dos respuestas distintas. El fix filtra `indice.diagnosticos` por
// `error.rowId === id`, la misma fuente que ya usa `view query`.
// ---------------------------------------------------------------------------

test("row get expone las mismas advertencias (PROPERTY_VALUE_HUERFANO) que ya devolvió row create, no advertencias: [] hardcodeado", async () => {
  const db = await crearDatabaseDeTareas();
  const valoresConHuerfano = JSON.stringify([
    { propertyId: "p_nota", valor: "nota" },
    { propertyId: "no_existe_en_el_esquema", valor: "huérfano" },
  ]);

  const creada = await nidoJson([
    "row",
    "create",
    "--db",
    db.salida.datos.id,
    "--titulo",
    "Con huérfano",
    "--valores",
    valoresConHuerfano,
  ]);
  expect(creada.exitCode).toBe(0);
  expect(creada.salida.datos.advertencias).toHaveLength(1);
  expect(creada.salida.datos.advertencias[0].codigo).toBe("PROPERTY_VALUE_HUERFANO");

  const leida = await nidoJson(["row", "get", creada.salida.datos.id]);
  expect(leida.exitCode).toBe(0);
  expect(leida.salida.datos.advertencias).toHaveLength(1);
  expect(leida.salida.datos.advertencias[0].codigo).toBe("PROPERTY_VALUE_HUERFANO");
  expect(leida.salida.datos.advertencias[0].rowId).toBe(creada.salida.datos.id);

  // también en formato humano, no solo --json
  const humano = await nido(["row", "get", creada.salida.datos.id]);
  expect(humano.exitCode).toBe(0);
  expect(humano.stdout).toContain("advertencias:");
  expect(humano.stdout).toContain("no_existe_en_el_esquema");
});

// ---------------------------------------------------------------------------
// ConflictoDeEscritura real: dos procesos CLI reales escribiendo la misma
// Page a partir del mismo hash.
// ---------------------------------------------------------------------------

test("dos procesos CLI reales actualizando la misma Page con el mismo hash: exactamente uno gana, el otro recibe un ConflictoDeEscritura legible", async () => {
  const creada = await nidoJson(["page", "create", "--titulo", "Original"]);
  const { id, hash } = creada.salida.datos;

  // Bun.spawn es sincrónico al arrancar el proceso — no hay ningún `await`
  // entre estas dos llamadas, así que los dos procesos parten del mismo
  // hash y corren en paralelo de verdad, no en secuencia.
  const carreraA = nidoJson(["page", "update", id, "--hash", hash, "--titulo", "Gana A"]);
  const carreraB = nidoJson(["page", "update", id, "--hash", hash, "--titulo", "Gana B"]);
  const [resultadoA, resultadoB] = await Promise.all([carreraA, carreraB]);

  const resultados = [resultadoA, resultadoB];
  const exitosos = resultados.filter((r) => r.exitCode === 0);
  const fallidos = resultados.filter((r) => r.exitCode === 1);

  expect(exitosos).toHaveLength(1);
  expect(fallidos).toHaveLength(1);
  expect(fallidos[0]!.salida.ok).toBe(false);
  expect(fallidos[0]!.salida.error).toContain("conflicto de escritura");
  expect(fallidos[0]!.salida.error).toContain(id);

  // el estado final en disco es exactamente el del que ganó, sin mezclar nada
  const final = await nidoJson(["page", "get", id]);
  expect(final.salida.datos.titulo).toBe(exitosos[0]!.salida.datos.titulo);
});

test("page update con un hash desactualizado (sin carrera real) también se rechaza con ConflictoDeEscritura", async () => {
  const creada = await nidoJson(["page", "create", "--titulo", "V1"]);
  const { id, hash } = creada.salida.datos;

  const primeraActualizacion = await nidoJson(["page", "update", id, "--hash", hash, "--titulo", "V2"]);
  expect(primeraActualizacion.exitCode).toBe(0);

  // reusar el hash viejo (ya no vigente) es un conflicto real, no simulado
  const segundaActualizacion = await nidoJson(["page", "update", id, "--hash", hash, "--titulo", "V3"]);
  expect(segundaActualizacion.exitCode).toBe(1);
  expect(segundaActualizacion.salida.error).toContain("conflicto de escritura");
});
