/**
 * Serializador/parser puro del archivo de una Page (T-0009 → este ticket),
 * según `docs/adr/002-formato-de-archivos-y-sync.md` sección 2.
 *
 * Alcance estricto: funciones string <-> objeto tipado. Nada de I/O — sin
 * `Bun.file`, sin `node:fs`, sin path. Eso es responsabilidad de T-0017/
 * T-0018 (el store/motor de sync), que van a llamar a estas funciones con
 * el contenido que ya leyeron o que están a punto de escribir.
 *
 * El encabezado de Page NO es YAML: es un formato propio, deliberadamente
 * chico, de seis claves fijas (`id`, `tipo`, `parent_id`, `titulo`,
 * `creado_en`, `actualizado_en`), delimitado por líneas `---` exactas. El
 * único escape reconocido en un valor string es `\"` y `\\`; cualquier otra
 * secuencia de backslash (`\n`, `\t`, etc.) no matchea el grammar y rechaza
 * el archivo completo — no hay ningún motor de lenguaje ni librería de
 * frontmatter involucrada (ADR-002 sección 2, la parte "no negociable" de
 * la decisión).
 */

import type { ErrorValidacion } from "../invariantes.ts";
import type { Page } from "../types.ts";

const DELIMITADOR = "---";

/** Orden fijo de escritura del encabezado — ADR-002 secciones 2 y 3. */
const CLAVES_EN_ORDEN = ["id", "tipo", "parent_id", "titulo", "creado_en", "actualizado_en"] as const;
type ClaveEncabezado = (typeof CLAVES_EN_ORDEN)[number];

function esClaveEncabezado(valor: string): valor is ClaveEncabezado {
  return (CLAVES_EN_ORDEN as readonly string[]).includes(valor);
}

// Un valor string entre comillas dobles donde el único escape reconocido es
// `\"` y `\\`. Cualquier otra secuencia de backslash (p. ej. `\n` literal
// de dos caracteres) no matchea este patrón — no es que se interprete como
// otra cosa, es que la línea entera queda mal formada y se rechaza.
const PATRON_STRING_ENTRE_COMILLAS = /^"((?:[^"\\]|\\[\\"])*)"$/;

// `Date.prototype.toISOString()`: ISO-8601 UTC completo con milisegundos.
// Valida rangos, no solo cantidad de dígitos — mismo criterio que
// `PATRON_FECHA` en `../invariantes.ts` (mes 01-12, día 01-31), extendido a
// hora 00-23, minuto/segundo 00-59. Sin esto, un valor como
// "9999-99-99T99:99:99.999Z" (mismo largo, mes/día/hora fuera de rango)
// matcheaba igual: la cantidad correcta de dígitos por posición no es lo
// mismo que cumplir el grammar ISO-8601 "al pie de la letra" (ADR-002
// sección 2). No se valida días-por-mes (p. ej. 31 de febrero) — mismo nivel
// de rigor que `PATRON_FECHA`, que tampoco lo hace.
const PATRON_ISO_8601_UTC =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;

/**
 * `titulo` no puede contener un salto de línea literal — asunción de
 * dominio explícita en ADR-002 sección 2 ("los títulos de Page son de una
 * sola línea"). Es un error de validación en escritura, no algo que el
 * formato intente codificar (por eso `serializarPage` lanza en vez de
 * devolver un `ErrorValidacion`: la firma pedida devuelve `string` a secas).
 */
export class TituloConSaltoDeLinea extends Error {
  constructor() {
    super('el titulo de una Page no puede contener un salto de línea ("\\n")');
  }
}

/**
 * `id`/`parent_id`/`creado_en`/`actualizado_en` tampoco pueden contener un
 * salto de línea literal — no es una asunción de dominio específica de esos
 * campos (a diferencia de `titulo`), sino una consecuencia directa del
 * formato: ADR-002 sección 2 emite cada clave del encabezado como una única
 * línea física (`clave: "valor"`), así que ningún valor de encabezado puede
 * representar un salto de línea real sin romper ese grammar — no solo
 * `titulo`. `tipo` no está en esta lista porque nunca es un valor variable:
 * `serializarPage` siempre emite el literal fijo `"pagina"`, nunca algo
 * derivado de `page`.
 *
 * Hallazgo de revisión de T-0015 (primera vuelta): `serializarPage`
 * chequeaba esto solo para `titulo` y podía emitir en silencio un
 * encabezado sintácticamente inválido para `id`/`parent_id` que
 * `parsearPage` después rechaza.
 *
 * Hallazgo de revisión de T-0015 (segunda vuelta): el fix de la primera
 * vuelta cubrió `id`/`parent_id` pero no `creado_en`/`actualizado_en`, pese
 * a que el mismo razonamiento de "una línea física por clave" aplica
 * igual — quedaba la misma vía de corrupción silenciosa para esos dos
 * campos.
 */
export class ValorDeEncabezadoConSaltoDeLinea extends Error {
  constructor(clave: "id" | "parent_id" | "creado_en" | "actualizado_en") {
    super(
      `el valor de "${clave}" en el encabezado de una Page no puede contener un salto de línea ("\\n"): cada clave del encabezado ocupa una sola línea física (ADR-002 sección 2)`,
    );
  }
}

function escaparString(valor: string): string {
  // Orden importa: escapar primero los backslashes originales a `\\`, y
  // solo después las comillas a `\"` — así no se escapa dos veces el
  // backslash que la primera pasada acaba de insertar.
  return valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function claveValorString(clave: ClaveEncabezado, valor: string): string {
  return `${clave}: "${escaparString(valor)}"`;
}

/**
 * Serializador canónico de Page (ADR-002 secciones 2 y 3): encabezado de
 * seis claves fijas, siempre en este orden exacto, delimitado por líneas
 * `---`, seguido del cuerpo Markdown tal cual (verbatim, sin normalizar
 * saltos de línea ni agregar/quitar un newline final).
 *
 * No valida que `creadoEn`/`actualizadoEn` ya vengan en formato ISO-8601 —
 * esa garantía es responsabilidad de quien construye el `Page` en memoria
 * (el store, T-0010), no de este serializador puro. Lo que sí valida este
 * serializador es lo que ADR-002 fija como regla de escritura del propio
 * formato: ningún valor emitido en el encabezado (`id`, `parent_id`,
 * `titulo`, `creadoEn`, `actualizadoEn` — los cinco campos de valor
 * variable; `tipo` queda afuera porque siempre es el literal fijo
 * `"pagina"`) puede contener un salto de línea literal, porque el grammar
 * de la sección 2 exige una línea física por clave — no es una restricción
 * exclusiva de `titulo`, aunque históricamente fue el único campo chequeado.
 *
 * @throws {TituloConSaltoDeLinea} si `page.titulo` contiene `"\n"`.
 * @throws {ValorDeEncabezadoConSaltoDeLinea} si `page.id`, `page.parentId`
 * (cuando no es `null`), `page.creadoEn` o `page.actualizadoEn` contienen
 * `"\n"`.
 */
export function serializarPage(page: Page): string {
  if (page.id.includes("\n")) throw new ValorDeEncabezadoConSaltoDeLinea("id");
  if (page.parentId !== null && page.parentId.includes("\n")) {
    throw new ValorDeEncabezadoConSaltoDeLinea("parent_id");
  }
  if (page.titulo.includes("\n")) throw new TituloConSaltoDeLinea();
  if (page.creadoEn.includes("\n")) throw new ValorDeEncabezadoConSaltoDeLinea("creado_en");
  if (page.actualizadoEn.includes("\n")) throw new ValorDeEncabezadoConSaltoDeLinea("actualizado_en");

  const lineasEncabezado = [
    DELIMITADOR,
    claveValorString("id", page.id),
    claveValorString("tipo", "pagina"),
    page.parentId === null ? "parent_id: null" : claveValorString("parent_id", page.parentId),
    claveValorString("titulo", page.titulo),
    claveValorString("creado_en", page.creadoEn),
    claveValorString("actualizado_en", page.actualizadoEn),
    DELIMITADOR,
  ];
  // El cuerpo va verbatim después del delimitador de cierre + su newline —
  // nunca se le agrega ni se le quita nada (ni siquiera un newline final).
  return `${lineasEncabezado.join("\n")}\n${page.cuerpo}`;
}

function errorEncabezado(mensaje: string): ErrorValidacion {
  return { codigo: "ENCABEZADO_INVALIDO", mensaje, severidad: "error" };
}

/** Desescapa `\"` → `"` y `\\` → `\`. Ningún otro backslash puede llegar hasta acá: `PATRON_STRING_ENTRE_COMILLAS` ya lo habría rechazado. */
function desescaparString(contenidoEntreComillas: string): string {
  return contenidoEntreComillas.replace(/\\(["\\])/g, "$1");
}

/** `null` si `raw` no matchea un string entre comillas dobles con el grammar del ADR; si no, el valor ya desescapado. */
function matchStringLiteral(raw: string): string | null {
  const coincidencia = PATRON_STRING_ENTRE_COMILLAS.exec(raw);
  if (!coincidencia) return null;
  // El grupo de captura siempre está presente cuando `coincidencia` no es
  // null: no lleva `?`, así que como mucho captura la cadena vacía.
  return desescaparString(coincidencia[1]!);
}

interface LineaLeida {
  texto: string;
  /** `false` solo en la última línea del archivo, cuando no termina en "\n". */
  terminaEnNewline: boolean;
  /** Posición desde donde seguir leyendo la próxima línea. */
  posSiguiente: number;
}

function leerLinea(contenido: string, desde: number): LineaLeida {
  const indice = contenido.indexOf("\n", desde);
  if (indice === -1) {
    return { texto: contenido.slice(desde), terminaEnNewline: false, posSiguiente: contenido.length };
  }
  return { texto: contenido.slice(desde, indice), terminaEnNewline: true, posSiguiente: indice + 1 };
}

/**
 * Parser total del archivo de una Page (ADR-002 secciones 2 y 5: "parseo
 * total, no tolerante"). Si el contenido no matchea el grammar exacto —
 * delimitadores, las seis claves ni una más ni una menos, cada valor con la
 * forma que le corresponde — se rechaza el archivo **completo**: nunca se
 * devuelve un objeto parcialmente construido con lo que sí se pudo leer.
 *
 * Devuelve el `Page` parseado, o la lista (no vacía) de `ErrorValidacion`
 * — todas con `severidad: "error"`, código `"ENCABEZADO_INVALIDO"` — que
 * explican por qué se rechazó. Puede haber más de una: se acumulan todos
 * los problemas encontrados en el encabezado en la misma pasada, mismo
 * estilo que `validarRow` en `../invariantes.ts`.
 */
export function parsearPage(contenido: string): Page | ErrorValidacion[] {
  const primeraLinea = leerLinea(contenido, 0);
  if (primeraLinea.texto !== DELIMITADOR) {
    return [errorEncabezado(`el archivo no abre con la línea delimitadora exacta "${DELIMITADOR}"`)];
  }
  if (!primeraLinea.terminaEnNewline) {
    return [errorEncabezado("el archivo termina inmediatamente después del delimitador de apertura, sin encabezado ni delimitador de cierre")];
  }

  // Recorre línea por línea buscando el delimitador de cierre. Ninguna línea
  // de encabezado válida (siempre de la forma `clave: valor`) puede ser
  // igual a "---" a secas, así que la primera línea que sí lo sea sin
  // ambigüedad es el cierre.
  const lineasEncabezado: string[] = [];
  let cuerpo: string | null = null;
  let posicion = primeraLinea.posSiguiente;

  while (cuerpo === null) {
    const linea = leerLinea(contenido, posicion);
    if (linea.texto === DELIMITADOR) {
      cuerpo = linea.terminaEnNewline ? contenido.slice(linea.posSiguiente) : "";
      break;
    }
    lineasEncabezado.push(linea.texto);
    if (!linea.terminaEnNewline) break; // EOF sin haber encontrado el cierre.
    posicion = linea.posSiguiente;
  }

  if (cuerpo === null) {
    return [errorEncabezado(`no se encontró la línea delimitadora de cierre exacta "${DELIMITADOR}" después del encabezado`)];
  }

  const errores: ErrorValidacion[] = [];
  const valoresPorClave = new Map<string, string>();
  const clavesVistas = new Set<string>();

  for (const linea of lineasEncabezado) {
    const separador = linea.indexOf(": ");
    if (separador === -1) {
      errores.push(errorEncabezado(`línea de encabezado mal formada, no matchea "clave: valor": "${linea}"`));
      continue;
    }
    const clave = linea.slice(0, separador);
    const restoDeLinea = linea.slice(separador + 2);

    if (clavesVistas.has(clave)) {
      errores.push(errorEncabezado(`la clave "${clave}" aparece más de una vez en el encabezado`));
      continue;
    }
    clavesVistas.add(clave);

    if (!esClaveEncabezado(clave)) {
      errores.push(errorEncabezado(`clave desconocida en el encabezado: "${clave}"`));
      continue;
    }
    valoresPorClave.set(clave, restoDeLinea);
  }

  let id: string | undefined;
  let parentId: string | null | undefined;
  let titulo: string | undefined;
  let creadoEn: string | undefined;
  let actualizadoEn: string | undefined;

  for (const clave of CLAVES_EN_ORDEN) {
    const raw = valoresPorClave.get(clave);
    if (raw === undefined) {
      errores.push(errorEncabezado(`falta la clave requerida "${clave}" en el encabezado`));
      continue;
    }

    switch (clave) {
      case "id": {
        const valor = matchStringLiteral(raw);
        if (valor === null) {
          errores.push(errorEncabezado(`"id" tiene que ser un string entre comillas dobles, se encontró: ${raw}`));
        } else {
          id = valor;
        }
        break;
      }
      case "tipo": {
        const valor = matchStringLiteral(raw);
        if (valor !== "pagina") {
          errores.push(errorEncabezado(`"tipo" tiene que ser exactamente "pagina", se encontró: ${raw}`));
        }
        break;
      }
      case "parent_id": {
        if (raw === "null") {
          parentId = null;
        } else {
          const valor = matchStringLiteral(raw);
          if (valor === null) {
            errores.push(
              errorEncabezado(
                `"parent_id" tiene que ser "null" (sin comillas) o un string entre comillas dobles, se encontró: ${raw}`,
              ),
            );
          } else {
            parentId = valor;
          }
        }
        break;
      }
      case "titulo": {
        const valor = matchStringLiteral(raw);
        if (valor === null) {
          errores.push(errorEncabezado(`"titulo" tiene que ser un string entre comillas dobles, se encontró: ${raw}`));
        } else {
          titulo = valor;
        }
        break;
      }
      case "creado_en":
      case "actualizado_en": {
        const valor = matchStringLiteral(raw);
        if (valor === null || !PATRON_ISO_8601_UTC.test(valor)) {
          errores.push(
            errorEncabezado(
              `"${clave}" tiene que ser un string ISO-8601 UTC completo entre comillas dobles, se encontró: ${raw}`,
            ),
          );
        } else if (clave === "creado_en") {
          creadoEn = valor;
        } else {
          actualizadoEn = valor;
        }
        break;
      }
    }
  }

  if (errores.length > 0) return errores;

  return {
    id: id!,
    tipo: "pagina",
    // `parentId` puede ser legítimamente `null` — no es un "no matcheó
    // nada" que un `!` de not-null tendría sentido pisar. Si llegamos acá
    // (errores.length === 0), el switch de arriba garantiza que quedó en
    // `string | null`, nunca en `undefined`.
    parentId: parentId as string | null,
    titulo: titulo!,
    cuerpo,
    creadoEn: creadoEn!,
    actualizadoEn: actualizadoEn!,
  };
}

/** Azúcar para distinguir el resultado de `parsearPage` sin repetir `Array.isArray` en cada llamador. */
export function esErrorDeParseo(resultado: Page | ErrorValidacion[]): resultado is ErrorValidacion[] {
  return Array.isArray(resultado);
}
