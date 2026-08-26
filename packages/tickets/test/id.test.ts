import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reservarProximoId } from "../src/id.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nido-tickets-id-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("reserva T-0001 en un directorio vacío", async () => {
  const { id } = await reservarProximoId(dir);
  expect(id).toBe("T-0001");
});

test("reserva ids consecutivos en llamadas secuenciales", async () => {
  const a = await reservarProximoId(dir);
  const b = await reservarProximoId(dir);
  expect(a.id).toBe("T-0001");
  expect(b.id).toBe("T-0002");
});

test("reservas concurrentes obtienen ids distintos", async () => {
  const resultados = await Promise.all(
    Array.from({ length: 8 }, () => reservarProximoId(dir)),
  );
  const ids = resultados.map((r) => r.id);
  expect(new Set(ids).size).toBe(8);
});
