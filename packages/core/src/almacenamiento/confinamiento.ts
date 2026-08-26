/**
 * Confinamiento de path (T-0017), checklist de ADR-002 sección 5, punto 1:
 * "antes de abrir cualquier archivo, resolver su path absoluto y verificar
 * que es descendiente de la raíz del workspace configurada — rechazar `..`,
 * paths absolutos fuera de la raíz, y symlinks que resuelvan afuera. El
 * nombre de archivo debe matchear `^<charset-de-id>+\.(md|json)$`".
 *
 * Alcance estricto: resolución y validación de UN path, dado la raíz del
 * workspace. No abre el archivo (más allá de lo que hace falta para resolver
 * symlinks vía `realpath`), no decide si "no existe" es un error o no —eso
 * es responsabilidad de quien lee o escribe (`lectura.ts`/`escritura.ts`),
 * porque un path que no existe todavía es perfectamente válido para una
 * escritura de creación.
 *
 * Charset de id: ADR-002 deja `<charset-de-id>` como un placeholder sin
 * fijar (ningún otro ticket lo fijó todavía — no es una decisión de
 * dominio, es una decisión de implementación de este ticket). Se fija acá,
 * deliberadamente conservador: alfanumérico, guion y guion bajo, al menos un
 * carácter. Nunca punto, barra, espacio ni comillas — esos son justamente
 * los caracteres que un ataque de path traversal o de inyección de path
 * necesitaría. Si un futuro ticket de generación de ids necesita un charset
 * más amplio, es una decisión explícita que hay que tomar reviendo este
 * archivo, no algo que este módulo debería anticipar ampliando el regex "por
 * si acaso".
 */

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve as resolverPathAbsoluto } from "node:path";

const PATRON_ID = "[A-Za-z0-9_-]+";
const PATRON_NOMBRE_ARCHIVO = new RegExp(`^(${PATRON_ID})\\.(?:md|json)$`);

export class NombreDeArchivoInvalido extends Error {
  constructor(nombreArchivo: string) {
    super(
      `el nombre de archivo "${nombreArchivo}" no matchea el formato exigido "<id>.md" o "<id>.json" (ADR-002 sección 5, punto 1)`,
    );
  }
}

export class PathFueraDelWorkspace extends Error {
  constructor(pathRelativo: string) {
    super(
      `el path "${pathRelativo}" resuelve fuera de la raíz del workspace configurada (ADR-002 sección 5, punto 1: path traversal o symlink que resuelve afuera)`,
    );
  }
}

export class RaizDeWorkspaceInvalida extends Error {
  constructor(raizWorkspace: string, causa: unknown) {
    super(
      `la raíz del workspace "${raizWorkspace}" no existe o no es accesible: ${String(causa)}`,
    );
  }
}

/**
 * El id que declara el nombre de archivo (sin extensión). Asume que
 * `nombreArchivo` ya matchea `PATRON_NOMBRE_ARCHIVO` — si no, lanza en vez
 * de adivinar, para no derivar un id de un nombre que ni siquiera tiene la
 * forma esperada.
 */
export function idDesdeNombreArchivo(nombreArchivo: string): string {
  const coincidencia = PATRON_NOMBRE_ARCHIVO.exec(nombreArchivo);
  if (!coincidencia) throw new NombreDeArchivoInvalido(nombreArchivo);
  return coincidencia[1]!;
}

function esRelativoDentroDe(raizAbsoluta: string, candidato: string): boolean {
  const rel = relative(raizAbsoluta, candidato);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function esRelativoDentroDeOIgual(raizAbsoluta: string, candidato: string): boolean {
  const rel = relative(raizAbsoluta, candidato);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function esArchivoInexistente(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/**
 * `realpath` tolerante a que el path final todavía no exista (una escritura
 * de creación es un caso legítimo): sube por los ancestros hasta encontrar
 * el primero que sí existe, y resuelve symlinks sobre ese. Cualquier
 * ancestro que exista y sea (o esté detrás de) un symlink hacia afuera de la
 * raíz queda atrapado por esto — los componentes que todavía no existen no
 * pueden ser symlinks, así que no hace falta resolverlos.
 */
async function realpathDelAncestroMasCercano(pathAbsoluto: string): Promise<string> {
  let actual = pathAbsoluto;
  for (;;) {
    try {
      return await realpath(actual);
    } catch (error) {
      if (!esArchivoInexistente(error)) throw error;
      const padre = dirname(actual);
      if (padre === actual) throw error; // llegamos a la raíz del filesystem sin encontrar nada existente
      actual = padre;
    }
  }
}

/**
 * Resuelve `pathRelativo` (relativo a `raizWorkspace`, o ya absoluto —
 * ambos casos terminan en el mismo chequeo de descendencia) a un path
 * absoluto, y lo rechaza si no es un descendiente confinado de la raíz:
 *
 * 1. El nombre base tiene que matchear `<id>.md`/`<id>.json`
 *    (`NombreDeArchivoInvalido` si no).
 * 2. El path resuelto (`path.resolve(raiz, pathRelativo)`, que descarta
 *    `raiz` si `pathRelativo` ya es absoluto — así un path absoluto fuera de
 *    la raíz cae en el mismo chequeo que un `..`) tiene que ser descendiente
 *    textual de la raíz (`PathFueraDelWorkspace` si no).
 * 3. Ningún symlink real —ni el del archivo mismo si ya existe, ni el de
 *    ningún ancestro que exista— puede resolver fuera de la raíz real
 *    (`PathFueraDelWorkspace` si no).
 *
 * No abre el archivo final. Lanza `RaizDeWorkspaceInvalida` si la raíz
 * misma no existe — sin una raíz real no hay nada contra lo que confinar.
 */
export async function resolverPathConfinado(raizWorkspace: string, pathRelativo: string): Promise<string> {
  const nombreArchivo = basename(pathRelativo);
  if (!PATRON_NOMBRE_ARCHIVO.test(nombreArchivo)) {
    throw new NombreDeArchivoInvalido(nombreArchivo);
  }

  const raizAbsoluta = resolverPathAbsoluto(raizWorkspace);
  const candidato = resolverPathAbsoluto(raizAbsoluta, pathRelativo);
  if (!esRelativoDentroDe(raizAbsoluta, candidato)) {
    throw new PathFueraDelWorkspace(pathRelativo);
  }

  let raizReal: string;
  try {
    raizReal = await realpath(raizAbsoluta);
  } catch (error) {
    throw new RaizDeWorkspaceInvalida(raizWorkspace, error);
  }

  const ancestroRealMasCercano = await realpathDelAncestroMasCercano(candidato);
  if (!esRelativoDentroDeOIgual(raizReal, ancestroRealMasCercano)) {
    throw new PathFueraDelWorkspace(pathRelativo);
  }

  return candidato;
}
