/**
 * Recorrido recursivo del árbol de archivos de un workspace (T-0018, punto 1
 * del alcance). Alcance estricto: identifica candidatos por nombre de
 * archivo — no abre, no parsea, no valida ningún contenido. Eso es
 * responsabilidad de `./construccion.ts`, que reusa el motor de T-0017
 * (`../almacenamiento/lectura.ts`) para cada archivo individual.
 *
 * Reusa `idDesdeNombreArchivo` de `../almacenamiento/confinamiento.ts` (el
 * mismo charset de id y el mismo patrón `<id>.md`/`<id>.json` que ya fija
 * ADR-002 sección 5 punto 1) en vez de reimplementar el regex acá — este
 * módulo no decide el charset, solo lo usa para filtrar qué archivos son
 * candidatos.
 *
 * Decisiones de alcance de este recorrido, explícitas:
 *
 * - **Se ignoran en silencio (sin diagnóstico) los archivos/directorios
 *   cuyo nombre empieza con "."**: cierra ".git" (y cualquier otro
 *   directorio de control de versiones o de editor) y, más específicamente,
 *   los archivos de lock/temporal que `../almacenamiento/escritura.ts` deja
 *   junto a cada nodo mientras escribe (`.{id}.json.lock`,
 *   `.{id}.json.tmp-<uuid>`) — que de todos modos nunca matchearían
 *   `idDesdeNombreArchivo` (empiezan con ".", fuera del charset de id), así
 *   que ignorarlos por nombre antes de intentar ni siquiera es estrictamente
 *   necesario, pero evita el trabajo de bajar a inspeccionarlos.
 * - **Se ignoran en silencio (sin diagnóstico) los archivos cuyo nombre no
 *   matchea `<id>.md`/`<id>.json`**: no son parte del árbol de nodos de
 *   nido — un README puesto a mano en el workspace, por ejemplo. No
 *   reclaman ser un nodo, así que no hay nada que rechazar; tratarlos como
 *   un diagnóstico sería ruido, no una señal real de un archivo roto.
 * - **No se sigue ningún symlink**, ni de archivo ni de directorio. Un
 *   symlink que resuelva fuera de la raíz del workspace ya lo rechaza
 *   `resolverPathConfinado` en el momento en que `./construccion.ts` intente
 *   leer ese path — pero evitar seguirlo acá, durante el recorrido mismo,
 *   además cierra por completo la posibilidad de un ciclo de directorios
 *   infinito (un symlink de directorio que se referencia a sí mismo o a un
 *   ancestro), sin depender de detección de ciclos en el recorrido de
 *   archivos en sí.
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { idDesdeNombreArchivo, NombreDeArchivoInvalido } from "../almacenamiento/confinamiento.ts";

export interface CandidatoArchivo {
  /** El id derivado del nombre de archivo (sin validar todavía contra el contenido — eso es el punto 4 del checklist, ya cubierto por `leerPage`/`leerDatabase`, o replicado a mano para Row en `./construccion.ts`). */
  id: string;
  extension: "md" | "json";
  /** Relativo a la raíz del workspace — listo para pasarle a `leerPage`/`leerDatabase`/`resolverPathConfinado` tal cual. */
  pathRelativo: string;
}

/**
 * Recorre `raizWorkspace` recursivamente y devuelve todos los archivos
 * candidatos a ser un nodo de nido (Page/Database/Row), en el orden en que
 * `readdir` los devuelve (no determinístico entre sistemas de archivos —
 * quien consuma esta lista no debe asumir ningún orden particular).
 */
export async function listarCandidatos(raizWorkspace: string): Promise<CandidatoArchivo[]> {
  const candidatos: CandidatoArchivo[] = [];
  await recorrer(raizWorkspace, raizWorkspace, candidatos);
  return candidatos;
}

async function recorrer(raizWorkspace: string, dirActual: string, acumulador: CandidatoArchivo[]): Promise<void> {
  const entradas = await readdir(dirActual, { withFileTypes: true });

  for (const entrada of entradas) {
    if (entrada.name.startsWith(".")) continue;
    if (entrada.isSymbolicLink()) continue;

    const pathAbsoluto = join(dirActual, entrada.name);

    if (entrada.isDirectory()) {
      await recorrer(raizWorkspace, pathAbsoluto, acumulador);
      continue;
    }
    if (!entrada.isFile()) continue; // sockets, fifos, device files, etc.: nunca son nodos de nido

    let id: string;
    try {
      id = idDesdeNombreArchivo(entrada.name);
    } catch (error) {
      if (error instanceof NombreDeArchivoInvalido) continue; // no es un archivo de nodo — se ignora sin diagnóstico, ver comentario de cabecera
      throw error;
    }

    acumulador.push({
      id,
      extension: entrada.name.endsWith(".md") ? "md" : "json",
      pathRelativo: relative(raizWorkspace, pathAbsoluto),
    });
  }
}
