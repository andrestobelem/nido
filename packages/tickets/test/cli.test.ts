import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nido-tickets-cli-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function tickets(args: string[]) {
  const proc = Bun.spawn(["bun", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, NIDO_TICKETS_DIR: dir },
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

test("create devuelve el ticket creado en JSON", async () => {
  const { stdout, exitCode } = await tickets(["create", "--titulo", "primero", "--json"]);
  expect(exitCode).toBe(0);
  const salida = JSON.parse(stdout);
  expect(salida.ok).toBe(true);
  expect(salida.datos.id).toBe("T-0001");
  expect(salida.datos.titulo).toBe("primero");
});

test("list en modo humano muestra los tickets creados", async () => {
  await tickets(["create", "--titulo", "primero"]);
  const { stdout } = await tickets(["list"]);
  expect(stdout).toContain("T-0001");
  expect(stdout).toContain("primero");
});

test("list --json filtra por estado", async () => {
  await tickets(["create", "--titulo", "uno", "--json"]);
  const b = JSON.parse((await tickets(["create", "--titulo", "dos", "--json"])).stdout).datos;
  await tickets(["move", b.id, "en_progreso", "--json"]);
  const { stdout } = await tickets(["list", "--estado", "en_progreso", "--json"]);
  const salida = JSON.parse(stdout);
  expect(salida.datos).toHaveLength(1);
  expect(salida.datos[0].id).toBe(b.id);
});

test("comando desconocido devuelve código de error 2", async () => {
  const { exitCode, stdout } = await tickets(["nope", "--json"]);
  expect(exitCode).toBe(2);
  expect(JSON.parse(stdout).ok).toBe(false);
});

test("move a en_progreso falla si hay una dependencia sin terminar", async () => {
  const a = JSON.parse((await tickets(["create", "--titulo", "a", "--json"])).stdout).datos;
  const b = JSON.parse(
    (await tickets(["create", "--titulo", "b", "--depende-de", a.id, "--json"])).stdout,
  ).datos;
  const { exitCode, stdout } = await tickets(["move", b.id, "en_progreso", "--json"]);
  expect(exitCode).toBe(1);
  expect(JSON.parse(stdout).ok).toBe(false);
});

test("un valor de flag literal '--json' no se confunde con el flag global", async () => {
  const { stdout, exitCode } = await tickets(["create", "--titulo", "--json", "--json"]);
  expect(exitCode).toBe(0);
  const salida = JSON.parse(stdout);
  expect(salida.ok).toBe(true);
  expect(salida.datos.titulo).toBe("--json");
});

test("un flag desconocido es un error de uso, no un no-op silencioso", async () => {
  const { exitCode, stdout } = await tickets(["create", "--titulo", "x", "--typo", "y", "--json"]);
  expect(exitCode).toBe(2);
  expect(JSON.parse(stdout).ok).toBe(false);
});

test("acepta la sintaxis --flag=valor", async () => {
  const { stdout, exitCode } = await tickets(["create", "--titulo=con-igual", "--json"]);
  expect(exitCode).toBe(0);
  expect(JSON.parse(stdout).datos.titulo).toBe("con-igual");
});

test("comment agrega un comentario visible en show", async () => {
  const a = JSON.parse((await tickets(["create", "--titulo", "a", "--json"])).stdout).datos;
  await tickets(["comment", a.id, "--autor", "ada", "--texto", "avanzando", "--json"]);
  const { stdout } = await tickets(["show", a.id, "--json"]);
  const salida = JSON.parse(stdout);
  expect(salida.datos.comentarios).toHaveLength(1);
  expect(salida.datos.comentarios[0].autor).toBe("ada");
});
