/**
 * T-0012 — sincronización bidireccional: caso "árbol tocado por git fuera
 * del motor de sync" (I2 extendida, caso 4 de
 * `docs/adr/002-formato-de-archivos-y-sync.md`; predicho por
 * `docs/adr/001-persistencia.md`), verificado con **git real** (`Bun.$`, tal
 * como prefiere `CLAUDE.md` sobre un shell-out manual) — no solo con
 * contenido malformado escrito a mano.
 *
 * Este archivo no agrega ninguna validación nueva: `indice-construccion.test.ts`,
 * `formato-page.test.ts` y `formato-database-row.test.ts` ya prueban que un
 * encabezado de Page roto o un JSON roto se rechazan con
 * `ENCABEZADO_INVALIDO`/`ESTRUCTURA_INVALIDA` sin tirar abajo el resto del
 * árbol — contenido sintético, escrito directo con `Bun.write`. Lo que
 * faltaba (auditoría de Sprint 7) era confirmar que un `git merge` con
 * conflicto real produce exactamente esa misma entrada — nadie lo había
 * ejercitado con git de punta a punta. La mecánica es: dos branches editan,
 * cada una con una operación legítima de la API de nido
 * (`actualizarPage`/`actualizarDatabase`), el mismo campo del mismo archivo
 * de forma incompatible; el merge deja marcadores `<<<<<<<`/`=======`/
 * `>>>>>>>` en el archivo final en disco — el estado real que "un árbol
 * tocado por git fuera del motor de sync" deja atrás, con o sin commit del
 * resultado del merge (los marcadores ya están en el working tree apenas el
 * merge falla, que es exactamente cuando un agente podría invocar `nido` sin
 * haber notado el conflicto).
 */

import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { esErrorDeLectura } from "../src/almacenamiento/lectura.ts";
import { actualizarDatabase, crearDatabase, leerDatabase } from "../src/crud/database.ts";
import { actualizarPage, crearPage, leerPage } from "../src/crud/page.ts";
import { construirIndice } from "../src/indice/construccion.ts";

// ---------------------------------------------------------------------------
// Helpers de git real (Bun.$, ADR-001/CLAUDE.md) — sin tocar ninguna config
// global del entorno: autoría vía variables de entorno, nunca `git config`.
// ---------------------------------------------------------------------------

const ENV_GIT = {
  ...process.env,
  GIT_AUTHOR_NAME: "nido-test",
  GIT_AUTHOR_EMAIL: "nido-test@example.com",
  GIT_COMMITTER_NAME: "nido-test",
  GIT_COMMITTER_EMAIL: "nido-test@example.com",
};

function git(cwd: string, args: string[]) {
  return $`git ${args}`.cwd(cwd).env(ENV_GIT).quiet();
}

async function gitInit(raiz: string): Promise<void> {
  await git(raiz, ["init", "-q", "-b", "main"]);
}

async function gitCommitTodo(raiz: string, mensaje: string): Promise<void> {
  await git(raiz, ["add", "-A"]);
  await git(raiz, ["commit", "-q", "-m", mensaje]);
}

/** Devuelve el `exitCode` del merge (nunca lanza) — se espera conflicto (!= 0). */
async function gitMergeSinLanzar(raiz: string, rama: string): Promise<number> {
  const resultado = await git(raiz, ["merge", "--no-edit", rama]).nothrow();
  return resultado.exitCode;
}

let raiz: string;

async function nuevoWorkspaceGit(prefijo: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefijo));
  await gitInit(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Caso 1: Page (.md) — el conflicto cae en el encabezado -> ENCABEZADO_INVALIDO
// ---------------------------------------------------------------------------

describe("gate T-0012: merge de git con conflicto real sobre una Page — ADR-002 I2 extendida, caso 4", () => {
  test("dos branches que actualizan el mismo campo del encabezado de forma incompatible, mergeadas con conflicto real, dejan un archivo excluido con ENCABEZADO_INVALIDO — sin crashear y sin afectar el resto del árbol", async () => {
    raiz = await nuevoWorkspaceGit("nido-core-sync-git-page-");
    try {
      // Un nodo testigo, nunca tocado por ninguna rama: confirma que el resto
      // del árbol se sigue indexando igual.
      const testigo = await crearPage(raiz, { titulo: "no tocada por el merge", cuerpo: "queda igual", parentId: null });
      const enConflicto = await crearPage(raiz, { titulo: "original", cuerpo: "cuerpo original\nlínea 2\n", parentId: null });

      await gitCommitTodo(raiz, "estado base");

      await git(raiz, ["checkout", "-q", "-b", "rama-a"]);
      await actualizarPage(raiz, enConflicto.valor, enConflicto.hash, { titulo: "titulo de rama A" });
      await gitCommitTodo(raiz, "rama a: cambia titulo");

      await git(raiz, ["checkout", "-q", "main"]);
      await git(raiz, ["checkout", "-q", "-b", "rama-b"]);
      // Mismo hash de partida que rama-a: en `main` el archivo todavía está
      // en el estado base, porque el checkout a `rama-a` no afectó a `main`.
      await actualizarPage(raiz, enConflicto.valor, enConflicto.hash, { titulo: "titulo de rama B" });
      await gitCommitTodo(raiz, "rama b: cambia titulo distinto");

      await git(raiz, ["checkout", "-q", "main"]);
      const exitMergeA = (await git(raiz, ["merge", "--no-edit", "rama-a"]).nothrow()).exitCode;
      expect(exitMergeA).toBe(0); // fast-forward limpio: main no había avanzado

      const exitMergeB = await gitMergeSinLanzar(raiz, "rama-b");
      expect(exitMergeB).not.toBe(0); // conflicto real: mismo campo, dos valores distintos

      const pathConflicto = join(raiz, `${enConflicto.valor.id}.md`);
      const contenidoTrasMerge = await Bun.file(pathConflicto).text();
      expect(contenidoTrasMerge).toContain("<<<<<<<");
      expect(contenidoTrasMerge).toContain("=======");
      expect(contenidoTrasMerge).toContain(">>>>>>>");

      // No cuelga, no lanza: reconstruye el índice sobre el árbol tal como
      // quedó tras el merge conflictuado, sin ningún paso de resolución.
      const indice = await construirIndice(raiz);

      expect(indice.paginas.has(enConflicto.valor.id)).toBe(false);
      const diagnosticoDelConflicto = indice.diagnosticos.find((d) => d.paths.includes(`${enConflicto.valor.id}.md`));
      expect(diagnosticoDelConflicto).toBeDefined();
      expect(diagnosticoDelConflicto!.error.codigo).toBe("ENCABEZADO_INVALIDO");

      // El resto del árbol se indexa igual, sin ningún diagnóstico espurio.
      const indexadoTestigo = indice.paginas.get(testigo.valor.id);
      expect(indexadoTestigo).toBeDefined();
      expect(indexadoTestigo!.valor).toEqual(testigo.valor);
      expect(indice.diagnosticos.some((d) => d.paths.includes(`${testigo.valor.id}.md`))).toBe(false);

      // Y por la vía de lectura puntual (CRUD, T-0019): mismo resultado.
      const releida = await leerPage(raiz, enConflicto.valor.id);
      expect(esErrorDeLectura(releida)).toBe(true);
      if (esErrorDeLectura(releida)) {
        expect(releida.some((error) => error.codigo === "ENCABEZADO_INVALIDO")).toBe(true);
      }
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Caso 2: Database (.json) — el conflicto rompe el JSON -> ESTRUCTURA_INVALIDA
// ---------------------------------------------------------------------------

describe("gate T-0012: merge de git con conflicto real sobre una Database — ADR-002 I2 extendida, caso 4", () => {
  test("dos branches que actualizan el mismo campo del JSON de forma incompatible, mergeadas con conflicto real, dejan un archivo excluido con ESTRUCTURA_INVALIDA — sin crashear y sin afectar el resto del árbol", async () => {
    raiz = await nuevoWorkspaceGit("nido-core-sync-git-db-");
    try {
      const testigo = await crearDatabase(raiz, { titulo: "no tocada por el merge", parentId: null, propiedades: [] });
      const enConflicto = await crearDatabase(raiz, { titulo: "original", parentId: null, propiedades: [] });

      await gitCommitTodo(raiz, "estado base");

      await git(raiz, ["checkout", "-q", "-b", "rama-a"]);
      await actualizarDatabase(raiz, enConflicto.valor, enConflicto.hash, { titulo: "rama A" });
      await gitCommitTodo(raiz, "rama a: cambia titulo");

      await git(raiz, ["checkout", "-q", "main"]);
      await git(raiz, ["checkout", "-q", "-b", "rama-b"]);
      await actualizarDatabase(raiz, enConflicto.valor, enConflicto.hash, { titulo: "rama B" });
      await gitCommitTodo(raiz, "rama b: cambia titulo distinto");

      await git(raiz, ["checkout", "-q", "main"]);
      const exitMergeA = (await git(raiz, ["merge", "--no-edit", "rama-a"]).nothrow()).exitCode;
      expect(exitMergeA).toBe(0);

      const exitMergeB = await gitMergeSinLanzar(raiz, "rama-b");
      expect(exitMergeB).not.toBe(0);

      const pathConflicto = join(raiz, `${enConflicto.valor.id}.json`);
      const contenidoTrasMerge = await Bun.file(pathConflicto).text();
      expect(contenidoTrasMerge).toContain("<<<<<<<");

      const indice = await construirIndice(raiz);

      expect(indice.databases.has(enConflicto.valor.id)).toBe(false);
      const diagnosticoDelConflicto = indice.diagnosticos.find((d) => d.paths.includes(`${enConflicto.valor.id}.json`));
      expect(diagnosticoDelConflicto).toBeDefined();
      expect(diagnosticoDelConflicto!.error.codigo).toBe("ESTRUCTURA_INVALIDA");

      const indexadoTestigo = indice.databases.get(testigo.valor.id);
      expect(indexadoTestigo).toBeDefined();
      expect(indexadoTestigo!.valor).toEqual(testigo.valor);
      expect(indice.diagnosticos.some((d) => d.paths.includes(`${testigo.valor.id}.json`))).toBe(false);

      const releida = await leerDatabase(raiz, enConflicto.valor.id);
      expect(esErrorDeLectura(releida)).toBe(true);
      if (esErrorDeLectura(releida)) {
        expect(releida.some((error) => error.codigo === "ESTRUCTURA_INVALIDA")).toBe(true);
      }
    } finally {
      await rm(raiz, { recursive: true, force: true });
    }
  });
});
