import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  idDesdeNombreArchivo,
  NombreDeArchivoInvalido,
  PathFueraDelWorkspace,
  RaizDeWorkspaceInvalida,
  resolverPathConfinado,
} from "../src/almacenamiento/confinamiento.ts";

let raiz: string;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "nido-core-confinamiento-"));
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("idDesdeNombreArchivo", () => {
  test("extrae el id de un nombre de archivo .md", () => {
    expect(idDesdeNombreArchivo("pagina-1.md")).toBe("pagina-1");
  });

  test("extrae el id de un nombre de archivo .json", () => {
    expect(idDesdeNombreArchivo("db_1.json")).toBe("db_1");
  });

  test("lanza NombreDeArchivoInvalido si no matchea <id>.md/<id>.json", () => {
    expect(() => idDesdeNombreArchivo("sin-extension")).toThrow(NombreDeArchivoInvalido);
    expect(() => idDesdeNombreArchivo("archivo.txt")).toThrow(NombreDeArchivoInvalido);
    expect(() => idDesdeNombreArchivo(".md")).toThrow(NombreDeArchivoInvalido);
    expect(() => idDesdeNombreArchivo("con espacio.md")).toThrow(NombreDeArchivoInvalido);
    expect(() => idDesdeNombreArchivo('con"comillas".json')).toThrow(NombreDeArchivoInvalido);
  });
});

describe("resolverPathConfinado: casos válidos", () => {
  test("resuelve un nombre de archivo simple dentro de la raíz", async () => {
    const resultado = await resolverPathConfinado(raiz, "pagina-1.md");
    expect(resultado).toBe(join(raiz, "pagina-1.md"));
  });

  test("resuelve un path relativo con subdirectorio existente dentro de la raíz", async () => {
    await mkdir(join(raiz, "sub"), { recursive: true });
    const resultado = await resolverPathConfinado(raiz, "sub/pagina-1.md");
    expect(resultado).toBe(join(raiz, "sub", "pagina-1.md"));
  });

  test("acepta un path absoluto que cae dentro de la raíz", async () => {
    const absoluto = join(raiz, "pagina-1.md");
    const resultado = await resolverPathConfinado(raiz, absoluto);
    expect(resultado).toBe(absoluto);
  });

  test("no exige que el archivo exista (caso de escritura de creación)", async () => {
    const resultado = await resolverPathConfinado(raiz, "todavia-no-existe.json");
    expect(resultado).toBe(join(raiz, "todavia-no-existe.json"));
  });
});

describe("resolverPathConfinado: rechaza el nombre de archivo con forma inválida", () => {
  test("sin extensión .md/.json", async () => {
    await expect(resolverPathConfinado(raiz, "archivo.txt")).rejects.toBeInstanceOf(NombreDeArchivoInvalido);
  });

  test("con caracteres fuera del charset de id", async () => {
    await expect(resolverPathConfinado(raiz, 'raro?.md')).rejects.toBeInstanceOf(NombreDeArchivoInvalido);
  });
});

describe("resolverPathConfinado: rechaza path traversal", () => {
  test("un '..' que se sale de la raíz", async () => {
    await expect(resolverPathConfinado(raiz, "../fuera.md")).rejects.toBeInstanceOf(PathFueraDelWorkspace);
  });

  test("varios '..' encadenados a través de un subdirectorio", async () => {
    await expect(resolverPathConfinado(raiz, "sub/../../fuera.md")).rejects.toBeInstanceOf(PathFueraDelWorkspace);
  });

  test("un path absoluto fuera de la raíz", async () => {
    const fueraDeRaiz = await mkdtemp(join(tmpdir(), "nido-core-fuera-"));
    try {
      await expect(
        resolverPathConfinado(raiz, join(fueraDeRaiz, "secreto.json")),
      ).rejects.toBeInstanceOf(PathFueraDelWorkspace);
    } finally {
      await rm(fueraDeRaiz, { recursive: true, force: true });
    }
  });

  test("el path traversal se rechaza sin tocar el filesystem más de lo necesario (no explota con un ancestro inexistente)", async () => {
    await expect(resolverPathConfinado(raiz, "no-existe/../../../etc/passwd.json")).rejects.toBeInstanceOf(
      PathFueraDelWorkspace,
    );
  });
});

describe("resolverPathConfinado: rechaza symlinks que resuelven afuera", () => {
  test("un symlink al archivo mismo que apunta afuera de la raíz", async () => {
    const fueraDeRaiz = await mkdtemp(join(tmpdir(), "nido-core-fuera-"));
    try {
      const archivoFuera = join(fueraDeRaiz, "real.json");
      await Bun.write(archivoFuera, "{}");
      const enlace = join(raiz, "pagina-1.json");
      await symlink(archivoFuera, enlace);

      await expect(resolverPathConfinado(raiz, "pagina-1.json")).rejects.toBeInstanceOf(PathFueraDelWorkspace);
    } finally {
      await rm(fueraDeRaiz, { recursive: true, force: true });
    }
  });

  test("un directorio ancestro que es symlink hacia afuera, aunque el archivo final no exista todavía", async () => {
    const fueraDeRaiz = await mkdtemp(join(tmpdir(), "nido-core-fuera-"));
    try {
      const enlaceDir = join(raiz, "sub");
      await symlink(fueraDeRaiz, enlaceDir);

      await expect(resolverPathConfinado(raiz, "sub/nuevo.md")).rejects.toBeInstanceOf(PathFueraDelWorkspace);
    } finally {
      await rm(fueraDeRaiz, { recursive: true, force: true });
    }
  });

  test("un symlink que resuelve adentro de la raíz se acepta", async () => {
    const destino = join(raiz, "real.json");
    await Bun.write(destino, "{}");
    const enlace = join(raiz, "alias-1.json");
    await symlink(destino, enlace);

    const resultado = await resolverPathConfinado(raiz, "alias-1.json");
    expect(resultado).toBe(enlace);
  });
});

describe("resolverPathConfinado: raíz de workspace inválida", () => {
  test("lanza RaizDeWorkspaceInvalida si la raíz no existe", async () => {
    await expect(
      resolverPathConfinado(join(raiz, "no-existe"), "pagina-1.md"),
    ).rejects.toBeInstanceOf(RaizDeWorkspaceInvalida);
  });
});
