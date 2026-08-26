/**
 * Reporte de alto nivel de sincronización (T-0012). Único código de dominio
 * nuevo que la auditoría de Sprint 7 encontró genuinamente necesario: un
 * wrapper delgado de agregación/presentación sobre `construirIndice`
 * (`../indice/construccion.ts`, T-0018) — **cero I/O propio, cero validación
 * nueva**. `construirIndice` ya aplica el checklist completo de ADR-002
 * sección 5 y ya devuelve `Indice { paginas, databases, filas, diagnosticos }`
 * con todo lo necesario; lo único que faltaba era que alguien ensamblara ese
 * resultado en un resumen legible, en vez de que cada consumidor (CLI T-0013,
 * futuro MCP T-0014) lo hiciera a mano por su cuenta — exactamente lo que
 * `docs/00-entendimiento.md` pide evitar ("CLI y MCP son dos superficies del
 * mismo core: ninguna reimplementa la lógica de la otra").
 *
 * Por qué esto es "sincronizar" y no una operación separada de
 * import/export: `docs/adr/001-persistencia.md` ya resuelve que los archivos
 * son la única fuente de verdad y que el índice se reconstruye siempre desde
 * cero — no hay un estado previo cacheado con el que "diffear". Por lo tanto,
 * "sincronizar" en v1 es, en los hechos, "leer el árbol completo tal como
 * está ahora y reportar su estado de salud" — ni más ni menos que invocar
 * `construirIndice` y presentar el resultado. Este módulo no reintroduce una
 * noción de "última vez que nido miró el árbol": cada llamada es una lectura
 * fresca completa, igual que `construirIndice`.
 */

import type { Diagnostico, Indice } from "../indice/tipos.ts";
import { construirIndice } from "../indice/construccion.ts";

/**
 * Resumen de salud de un workspace, derivado enteramente de un `Indice`
 * recién construido. Cada campo es una re-agrupación de datos que `Indice`
 * ya tiene — ningún campo acá representa información nueva.
 */
export interface ReporteSincronizacion {
  /** Igual a `Indice.raiz` — la raíz de workspace que se sincronizó. */
  raiz: string;

  /** Cantidad de nodos que sobrevivieron el checklist de ADR-002 sección 5 y ya están en el índice, por tipo. */
  nodosValidos: {
    paginas: number;
    databases: number;
    filas: number;
  };

  /**
   * `Indice.diagnosticos`, agrupados por severidad. Cada diagnóstico
   * aparece en un solo grupo (`severidad` es exactamente `"error"` o
   * `"advertencia"`, nunca ambas) — no hay overlap entre `errores` y
   * `advertencias`.
   */
  diagnosticos: {
    errores: Diagnostico[];
    advertencias: Diagnostico[];
  };

  /**
   * Subconjunto de `diagnosticos.errores` cuyo código es
   * `PARENT_ID_INVALIDO` — nodos huérfanos (un `parent_id` colgante, o hacia
   * un nodo que a su vez se excluyó por duplicado/ciclo/orfandad en
   * cascada). Es la categoría de error más común y más directamente
   * accionable de un árbol tocado externamente (I2 extendida, caso 4 de
   * `docs/adr/002-formato-de-archivos-y-sync.md`: rebase/merge/cherry-pick/
   * checkout fuera del motor de sync puede dejar exactamente este estado),
   * así que se expone aparte para que un consumidor pueda mostrarla sin
   * tener que filtrar `errores` él mismo.
   *
   * Deliberadamente **no** excluyente de `diagnosticos.errores`: `huerfanos`
   * es un subconjunto derivado, no una tercera categoría separada. Filtrar
   * `PARENT_ID_INVALIDO` fuera de `errores` arriesgaría que alguien que solo
   * mira `diagnosticos.errores` (sin saber de este campo) pierda de vista
   * justo esos hallazgos — el mismo espíritu de "fail closed, nunca
   * silencioso" que exige ADR-002 sección 5 punto 9.
   */
  huerfanos: Diagnostico[];

  /** `true` si `diagnosticos.errores` está vacío — atajo para "el árbol está sano" sin inspeccionar conteos a mano. Ignora advertencias a propósito: una advertencia (por ejemplo `PROPERTY_VALUE_HUERFANO`) no invalida nada por diseño (ADR-006). */
  sano: boolean;
}

function agruparPorSeveridad(diagnosticos: Diagnostico[]): { errores: Diagnostico[]; advertencias: Diagnostico[] } {
  const errores: Diagnostico[] = [];
  const advertencias: Diagnostico[] = [];
  for (const diagnostico of diagnosticos) {
    if (diagnostico.error.severidad === "error") errores.push(diagnostico);
    else advertencias.push(diagnostico);
  }
  return { errores, advertencias };
}

function construirReporte(indice: Indice): ReporteSincronizacion {
  const { errores, advertencias } = agruparPorSeveridad(indice.diagnosticos);
  const huerfanos = errores.filter((diagnostico) => diagnostico.error.codigo === "PARENT_ID_INVALIDO");

  return {
    raiz: indice.raiz,
    nodosValidos: {
      paginas: indice.paginas.size,
      databases: indice.databases.size,
      filas: indice.filas.size,
    },
    diagnosticos: { errores, advertencias },
    huerfanos,
    sano: errores.length === 0,
  };
}

/**
 * Reconstruye el índice completo de `raizWorkspace` (`construirIndice`,
 * lectura fresca, nunca cacheada — ADR-001) y devuelve un
 * `ReporteSincronizacion` con el resumen agregado. Esta es la función de
 * alto nivel "sincronizar" que CLI (T-0013) y un futuro MCP (T-0014) deberían
 * llamar en vez de ensamblar su propio resumen sobre `indice.diagnosticos` a
 * mano.
 */
export async function sincronizarWorkspace(raizWorkspace: string): Promise<ReporteSincronizacion> {
  const indice = await construirIndice(raizWorkspace);
  return construirReporte(indice);
}
