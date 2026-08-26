/**
 * Tipos compartidos del índice derivado (T-0018, ADR-001/ADR-002/ADR-004).
 * Solo tipos — sin I/O, sin bun:sqlite real (el tipo `Database` de
 * `bun:sqlite` se importa acá solo como *tipo*, no se instancia).
 */

import type { Database as BaseSqlite } from "bun:sqlite";
import type { ErrorValidacion } from "../invariantes.ts";
import type { Database, Page, Row } from "../types.ts";

/**
 * Un nodo ya leído/parseado/validado, junto con el path (relativo a la raíz
 * del workspace) del archivo del que vino. No se guarda el hash de CAS
 * (ADR-002 sección 4): ese valor solo tiene sentido durante el ciclo de una
 * escritura puntual (T-0017), y este módulo es exclusivamente de lectura
 * ("NADA de escritura", alcance de T-0018) — guardarlo acá sería estado que
 * nadie consume, no una guarda defensiva razonable.
 */
export interface NodoIndexado<T> {
  valor: T;
  /** Relativo a la raíz del workspace — el mismo valor que recibirían `leerPage`/`leerDatabase`/`resolverPathConfinado`. */
  path: string;
}

/**
 * Un hallazgo de la construcción del índice, con los archivos involucrados.
 * Se separa del `ErrorValidacion` desnudo (que no tiene ningún campo de
 * path) porque, a diferencia de T-0017 (que valida un archivo a la vez y ya
 * sabe cuál es sin necesitar guardarlo), acá el diagnóstico se junta en una
 * lista para reportar al final de escanear *todo* el árbol — sin el path,
 * "el id 'x' aparece 2 veces" no le dice a nadie qué dos archivos mirar.
 */
export interface Diagnostico {
  error: ErrorValidacion;
  /**
   * Los archivos involucrados en este diagnóstico, relativos a la raíz. Casi
   * siempre uno; puede ser más de uno (el caso canónico: `ID_DUPLICADO`,
   * donde el conflicto es justamente que dos o más archivos declaran el
   * mismo id). Puede estar vacío para el caso, hoy no ejercitado por este
   * módulo, de un diagnóstico que no deriva de ningún archivo puntual.
   */
  paths: string[];
}

/**
 * El índice completo de un workspace: los tres mapas id→nodo (uno por tipo)
 * que ya pasaron el checklist de ADR-002 sección 5 (puntos 5/6/7/9, los que
 * corresponden a T-0018 — 1/2/3/4/8 ya los aplicó T-0017 archivo por
 * archivo) más la base `bun:sqlite` en memoria que los vuelve consultable
 * por `../indice/vistas.ts`, más la lista de diagnósticos de todo lo que se
 * excluyó y por qué.
 *
 * Deliberadamente NO incluye un mapa id→path unificado (Page ∪ Database ∪
 * Row): cada nodo ya sabe su propio path (`NodoIndexado.path`), y los tres
 * mapas están particionados por tipo — exactamente lo que hace falta para
 * las dos preguntas reales que este índice tiene que responder ("¿qué
 * Database es esta Row?", "¿qué View se resuelve contra esta Database?").
 * Un cuarto mapa "global" solo duplicaría eso sin agregar nada.
 */
export interface Indice {
  raiz: string;
  sqlite: BaseSqlite;
  paginas: Map<string, NodoIndexado<Page>>;
  databases: Map<string, NodoIndexado<Database>>;
  filas: Map<string, NodoIndexado<Row>>;
  diagnosticos: Diagnostico[];
}
