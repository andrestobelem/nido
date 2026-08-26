/**
 * Resolución de una View (o de una query ad-hoc con la misma forma) contra
 * el índice derivado — T-0018, punto 4 del alcance, ADR-004 completo.
 *
 * ## Validación y traducción son dos pasadas separadas
 *
 * `validarFiltros`/`validarOrden` corren primero, sobre el `Grupo`/
 * `OrdenCampo[]` tratado como `unknown` (nunca se confía en que el árbol de
 * filtros de una View ya tenga la forma exacta que dice su tipo TypeScript:
 * `../formato/database-row.ts` es explícito en que **no** valida el
 * contenido interno de `vistas` al parsear el archivo de una Database — "no
 * se valida la forma interna de cada... View... solo se verifica que sean
 * arrays". Así que, para este módulo, el `filtros`/`orden` de una View recién
 * leída del disco es tan "entrada no confiable" como cualquier otro campo
 * que menciona ADR-002 sección 5 — un `Grupo` de profundidad 3, un operador
 * que no existe para la familia de su campo, o un `campo` que referencia un
 * `property_id` que ya no está en el esquema son exactamente los casos que
 * ADR-004 sección 4 anticipa ("una View individual mal formada... no
 * invalida el archivo de la Database entero", que es responsabilidad de
 * quien llame a `resolverVista` para cada View — este módulo solo garantiza
 * que una View rota nunca produce SQL, nunca hace de cuenta que parseó algo
 * que no validó).
 *
 * Solo después de que la validación pasa sin errores se traduce a SQL
 * (`traducirGrupo`/`traducirOrden`) — el traductor asume que la forma ya es
 * correcta y no vuelve a chequearla.
 *
 * ## Por qué SQL decide membership+orden, y la hidratación es solo un lookup
 *
 * La consulta real (`SELECT n.id FROM nodos n ... WHERE ... ORDER BY ...`)
 * es la única que decide qué Rows matchean y en qué orden — exactamente lo
 * que exige ADR-001 ("toda resolución de una View pasa por este índice vía
 * WHERE/ORDER BY; ninguna View se resuelve leyendo y filtrando en JS"). Lo
 * que sigue después (mapear cada `id` devuelto al objeto `Row` ya parseado
 * en `Indice.filas`) es una traducción id→objeto en memoria, O(1) por fila,
 * no una segunda pasada de filtrado ni de reordenamiento: el orden final de
 * `resultado.filas` es exactamente el orden en que SQLite devolvió los ids.
 * Se eligió esto (en vez de reconstruir el `Row` completo desde las tablas
 * EAV) porque el índice nunca es la fuente de verdad (ADR-001) — el `Row`
 * en memoria, ya parseado y validado por `./construccion.ts`, es estrictamente
 * más confiable que cualquier reconstrucción desde `valores_escalares`/
 * `valores_multi`, y no hay ninguna razón para pagar el costo de esa
 * reconstrucción cuando el objeto original ya está a mano.
 *
 * ## EXISTS/NOT EXISTS en vez de LEFT JOIN + "valor IS NULL OR NOT(...)"
 *
 * ADR-004 sección 2 ilustra el manejo de operadores negativos con un `LEFT
 * JOIN` más `(valor IS NULL OR NOT (...))` explícito, para que una Row sin
 * la Property cuente como que satisface la condición negativa. Este módulo
 * llega al mismo resultado por un camino distinto: cada condición sobre una
 * Property (positiva o negativa) se traduce como `EXISTS (SELECT 1 FROM
 * <tabla> WHERE row_id = n.id AND property_id = ? AND <condición>)`, y un
 * operador negativo es literalmente `NOT` de ese mismo `EXISTS`. Es
 * equivalente en resultado (una Row sin valor para la Property nunca hace
 * que el `EXISTS` sea verdadero, así que su negación —`NOT EXISTS`— es
 * verdadera para esa Row, igual que pide el ADR) pero evita el problema de
 * fondo por construcción en vez de neutralizarlo con una cláusula
 * explícita: `EXISTS`/`NOT EXISTS` en SQLite **siempre** evalúan a
 * verdadero o falso, nunca a `NULL` — no hay lógica de tres valores que
 * gestionar porque la comparación problemática (`valor = ?` sobre un
 * `valor` que podría no existir) queda encerrada dentro de una subquery
 * correlacionada que la aísla del `WHERE` externo. Se documenta la
 * diferencia explícitamente porque el ADR prescribe una forma concreta de
 * SQL — este módulo no la reabre en espíritu (el resultado que exige,
 * "ausencia satisface la condición negativa", se cumple igual), pero sí
 * elige un mecanismo distinto al ilustrado, y eso merece quedar registrado,
 * no pasar desapercibido.
 *
 * ## `empieza_con`/`termina_con` con `SUBSTR`/`LENGTH`, no `LIKE`
 *
 * Mismo espíritu que la elección de `INSTR` para `contiene` (ADR-004
 * sección 2: evitar `LIKE` porque un valor de búsqueda arbitrario tendría
 * que escapar `%`/`_`). `SUBSTR(columna, 1, LENGTH(?)) = ?` (prefijo) y
 * `SUBSTR(columna, -LENGTH(?)) = ?` (sufijo) no son funciones de matching de
 * patrones — son extracción posicional más comparación exacta — así que no
 * tienen ningún metacarácter que interpretar ni que escapar, cerrando la
 * misma clase de problema por el mismo motivo, aunque el ADR solo menciona
 * `INSTR` explícitamente para `contiene`/`no_contiene`.
 */

import type { ErrorValidacion } from "../invariantes.ts";
import type {
  CampoBase,
  CondicionHoja,
  Database,
  Grupo,
  GrupoAnidado,
  Operador,
  OrdenCampo,
  Property,
  Row,
  TipoProperty,
  View,
} from "../types.ts";
import type { Indice } from "./tipos.ts";

// ---------------------------------------------------------------------------
// Familias de operadores (ADR-004 sección 1)
// ---------------------------------------------------------------------------

const OPERADORES_ESCALAR_COMPARABLE = new Set<Operador>([
  "igual",
  "distinto",
  "mayor_que",
  "mayor_o_igual",
  "menor_que",
  "menor_o_igual",
  "vacio",
  "no_vacio",
]);
const OPERADORES_TEXTO = new Set<Operador>([
  "igual",
  "distinto",
  "contiene",
  "no_contiene",
  "empieza_con",
  "termina_con",
  "vacio",
  "no_vacio",
]);
const OPERADORES_CHECKBOX = new Set<Operador>(["igual", "vacio", "no_vacio"]);
const OPERADORES_SELECT = new Set<Operador>(["igual", "distinto", "es_alguno_de", "no_es_ninguno_de", "vacio", "no_vacio"]);
const OPERADORES_MULTI_SELECT = new Set<Operador>([
  "contiene",
  "no_contiene",
  "contiene_alguno_de",
  "contiene_todos_de",
  "vacio",
  "no_vacio",
]);

/** `id` es más angosto que la familia `texto` completa: sin `contiene`/`vacio`/etc. (ADR-004 sección 1: "no tiene un caso de uso real"). */
const OPERADORES_ID = new Set<Operador>(["igual", "distinto"]);
/** `creado_en`/`actualizado_en` como campo_base: comparaciones de la familia `escalar_comparable` pero SIN `vacio`/`no_vacio` — a diferencia de `numero`/`fecha` como Property, estos campos nunca pueden faltar ni ser "vacíos" (ADR-004 sección 1, "Campos base sin familia de Property"). */
const OPERADORES_FECHA_BASE = new Set<Operador>(["igual", "distinto", "mayor_que", "mayor_o_igual", "menor_que", "menor_o_igual"]);

const CAMPOS_BASE_VALIDOS: ReadonlySet<string> = new Set(["titulo", "id", "creado_en", "actualizado_en"]);
const OPERADORES_DE_ARRAY = new Set(["es_alguno_de", "no_es_ninguno_de", "contiene_alguno_de", "contiene_todos_de"]);

// ---------------------------------------------------------------------------
// Guardas de forma en runtime (entrada no confiable — ver comentario de cabecera)
// ---------------------------------------------------------------------------

function esRegistro(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function esFormaDeGrupo(x: unknown): x is { combinador: unknown; condiciones: unknown[] } {
  return esRegistro(x) && "combinador" in x && "condiciones" in x && Array.isArray(x.condiciones);
}

function esFormaDeCondicionHoja(x: unknown): x is { campo: unknown; operador: unknown; valor?: unknown } {
  return esRegistro(x) && "campo" in x && "operador" in x;
}

function esFormaDeRefCampo(x: unknown): x is { tipo: "campo_base"; campo: string } | { tipo: "propiedad"; propertyId: string } {
  if (!esRegistro(x)) return false;
  if (x.tipo === "campo_base") return typeof x.campo === "string";
  if (x.tipo === "propiedad") return typeof x.propertyId === "string";
  return false;
}

function esFormaDeOrdenCampo(x: unknown): x is { campo: unknown; direccion: unknown } {
  return esRegistro(x) && "campo" in x && "direccion" in x;
}

// ---------------------------------------------------------------------------
// Validación de `filtros` (ADR-004 secciones 1 y 2)
// ---------------------------------------------------------------------------

function errorFiltro(mensaje: string): ErrorValidacion {
  return { codigo: "ESTRUCTURA_INVALIDA", mensaje: `filtro inválido: ${mensaje}`, severidad: "error" };
}

type TipoEsperado = "string" | "number" | "boolean" | "string[]";

function tipoEsperadoParaOperador(operador: string, tipoUnico: TipoEsperado): TipoEsperado {
  return OPERADORES_DE_ARRAY.has(operador) ? "string[]" : tipoUnico;
}

function validarOperadorYValor(
  operador: string,
  valor: unknown,
  permitidos: ReadonlySet<Operador>,
  tipoEsperado: TipoEsperado,
  contexto: string,
): ErrorValidacion[] {
  if (!permitidos.has(operador as Operador)) {
    return [errorFiltro(`el operador "${operador}" no es válido para ${contexto} — válidos: ${[...permitidos].join(", ")}`)];
  }
  const esUnario = operador === "vacio" || operador === "no_vacio";
  if (esUnario) {
    return valor !== undefined ? [errorFiltro(`el operador "${operador}" no admite "valor" (${contexto})`)] : [];
  }
  if (valor === undefined) return [errorFiltro(`el operador "${operador}" requiere "valor" (${contexto})`)];

  switch (tipoEsperado) {
    case "string":
      return typeof valor === "string"
        ? []
        : [errorFiltro(`"valor" debe ser un string para "${operador}" (${contexto}), recibió ${JSON.stringify(valor)}`)];
    case "number":
      return typeof valor === "number" && Number.isFinite(valor)
        ? []
        : [errorFiltro(`"valor" debe ser un número finito para "${operador}" (${contexto}), recibió ${JSON.stringify(valor)}`)];
    case "boolean":
      return typeof valor === "boolean"
        ? []
        : [errorFiltro(`"valor" debe ser un boolean para "${operador}" (${contexto}), recibió ${JSON.stringify(valor)}`)];
    case "string[]":
      return Array.isArray(valor) && valor.every((elemento) => typeof elemento === "string")
        ? []
        : [errorFiltro(`"valor" debe ser un array de strings para "${operador}" (${contexto}), recibió ${JSON.stringify(valor)}`)];
  }
}

function validarCondicionCampoBase(hoja: { operador: string; valor?: unknown }, campo: string): ErrorValidacion[] {
  if (campo === "parent_id") {
    return [errorFiltro('"parent_id" no es filtrable: una View ya está fijada a una sola Database (ADR-004 sección 1)')];
  }
  if (!CAMPOS_BASE_VALIDOS.has(campo)) {
    return [errorFiltro(`"${campo}" no es un campo base reconocido`)];
  }
  switch (campo) {
    case "titulo":
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_TEXTO, "string", 'el campo base "titulo"');
    case "id":
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_ID, "string", 'el campo base "id"');
    default: // "creado_en" | "actualizado_en"
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_FECHA_BASE, "string", `el campo base "${campo}"`);
  }
}

function validarCondicionProperty(hoja: { operador: string; valor?: unknown }, propiedad: Property): ErrorValidacion[] {
  const contexto = `la property "${propiedad.nombre}" (${propiedad.tipo})`;
  switch (propiedad.tipo) {
    case "numero":
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_ESCALAR_COMPARABLE, "number", contexto);
    case "fecha":
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_ESCALAR_COMPARABLE, "string", contexto);
    case "texto":
    case "agente":
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_TEXTO, "string", contexto);
    case "checkbox":
      return validarOperadorYValor(hoja.operador, hoja.valor, OPERADORES_CHECKBOX, "boolean", contexto);
    case "select":
      return validarOperadorYValor(
        hoja.operador,
        hoja.valor,
        OPERADORES_SELECT,
        tipoEsperadoParaOperador(hoja.operador, "string"),
        contexto,
      );
    case "multi_select":
      return validarOperadorYValor(
        hoja.operador,
        hoja.valor,
        OPERADORES_MULTI_SELECT,
        tipoEsperadoParaOperador(hoja.operador, "string"),
        contexto,
      );
  }
}

function validarCondicionHoja(hojaBruta: unknown, database: Database): ErrorValidacion[] {
  if (!esFormaDeCondicionHoja(hojaBruta)) {
    return [errorFiltro(`no es una condición hoja válida: ${JSON.stringify(hojaBruta)}`)];
  }
  const operador = hojaBruta.operador;
  if (typeof operador !== "string") {
    return [errorFiltro(`"operador" debe ser un string, se encontró ${JSON.stringify(operador)}`)];
  }
  const campoBruto = hojaBruta.campo;
  if (!esFormaDeRefCampo(campoBruto)) {
    return [errorFiltro(`"campo" no tiene una forma válida de RefCampo: ${JSON.stringify(campoBruto)}`)];
  }
  const campo = campoBruto;

  if (campo.tipo === "campo_base") {
    return validarCondicionCampoBase({ operador, valor: hojaBruta.valor }, campo.campo);
  }
  const propiedad = database.propiedades.find((p) => p.id === campo.propertyId);
  if (!propiedad) {
    return [errorFiltro(`referencia la property "${campo.propertyId}", que no existe en el esquema de la Database "${database.id}"`)];
  }
  return validarCondicionProperty({ operador, valor: hojaBruta.valor }, propiedad);
}

function validarArbolFiltros(nodo: unknown, database: Database, profundidad: number): ErrorValidacion[] {
  if (!esFormaDeGrupo(nodo)) {
    return [errorFiltro(`no es un Grupo válido en profundidad ${profundidad}: ${JSON.stringify(nodo)}`)];
  }
  if (nodo.combinador !== "y" && nodo.combinador !== "o") {
    return [errorFiltro(`"combinador" debe ser "y" u "o", se encontró ${JSON.stringify(nodo.combinador)}`)];
  }
  if (nodo.condiciones.length === 0) {
    return [
      errorFiltro(
        'un Grupo no puede tener "condiciones" vacío (ADR-004 sección 2: ni "siempre verdadero" ni "siempre falso", es un error de validación explícito)',
      ),
    ];
  }

  const errores: ErrorValidacion[] = [];
  for (const hijo of nodo.condiciones) {
    if (esFormaDeGrupo(hijo)) {
      if (profundidad >= 2) {
        errores.push(errorFiltro("profundidad de anidamiento excede el máximo permitido (2, ADR-004 sección 2)"));
        continue;
      }
      errores.push(...validarArbolFiltros(hijo, database, profundidad + 1));
    } else {
      errores.push(...validarCondicionHoja(hijo, database));
    }
  }
  return errores;
}

/** `filtros` tratado como `unknown` (ver comentario de cabecera). `null`/`undefined` es válido — "sin filtro, todas las filas" (ADR-004 sección 2) — y nunca llega a `validarArbolFiltros`. */
export function validarFiltros(filtros: unknown, database: Database): ErrorValidacion[] {
  if (filtros === null || filtros === undefined) return [];
  return validarArbolFiltros(filtros, database, 1);
}

/** `orden` tratado como `unknown`, mismo motivo que `validarFiltros`. */
export function validarOrden(orden: unknown, database: Database): ErrorValidacion[] {
  if (!Array.isArray(orden)) return [errorFiltro('"orden" debe ser un array')];

  const errores: ErrorValidacion[] = [];
  orden.forEach((entrada, indice) => {
    if (!esFormaDeOrdenCampo(entrada)) {
      errores.push(errorFiltro(`la entrada ${indice} de "orden" no tiene la forma { campo, direccion }`));
      return;
    }
    if (entrada.direccion !== "asc" && entrada.direccion !== "desc") {
      errores.push(errorFiltro(`la entrada ${indice} de "orden" tiene "direccion" inválida: ${JSON.stringify(entrada.direccion)}`));
    }
    const campoBruto = entrada.campo;
    if (!esFormaDeRefCampo(campoBruto)) {
      errores.push(errorFiltro(`la entrada ${indice} de "orden" tiene "campo" inválido`));
      return;
    }
    const campo = campoBruto;
    if (campo.tipo === "campo_base") {
      if (campo.campo === "parent_id" || !CAMPOS_BASE_VALIDOS.has(campo.campo)) {
        errores.push(errorFiltro(`la entrada ${indice} de "orden" referencia un campo base inválido: "${campo.campo}"`));
      }
      return;
    }
    const propiedad = database.propiedades.find((p) => p.id === campo.propertyId);
    if (!propiedad) {
      errores.push(errorFiltro(`la entrada ${indice} de "orden" referencia la property "${campo.propertyId}", que no existe en el esquema`));
      return;
    }
    if (propiedad.tipo === "multi_select") {
      errores.push(
        errorFiltro(
          `la entrada ${indice} de "orden" referencia la property "${propiedad.nombre}" (multi_select), que no es un campo válido de orden (ADR-004 sección 2)`,
        ),
      );
    }
  });
  return errores;
}

// ---------------------------------------------------------------------------
// Traducción de `filtros` a SQL (WHERE) — asume entrada ya validada
// ---------------------------------------------------------------------------

type Sql = { sql: string; params: (string | number)[] };

function existeEnEscalares(propertyId: string, condicionExtra: string, params: (string | number)[]): Sql {
  return {
    sql: `EXISTS (SELECT 1 FROM valores_escalares ve WHERE ve.row_id = n.id AND ve.property_id = ?${condicionExtra ? ` AND ${condicionExtra}` : ""})`,
    params: [propertyId, ...params],
  };
}
function noExisteEnEscalares(propertyId: string, condicionExtra: string, params: (string | number)[]): Sql {
  const positivo = existeEnEscalares(propertyId, condicionExtra, params);
  return { sql: `NOT ${positivo.sql}`, params: positivo.params };
}
function existeEnMulti(propertyId: string, condicionExtra: string, params: (string | number)[]): Sql {
  return {
    sql: `EXISTS (SELECT 1 FROM valores_multi vm WHERE vm.row_id = n.id AND vm.property_id = ?${condicionExtra ? ` AND ${condicionExtra}` : ""})`,
    params: [propertyId, ...params],
  };
}
function noExisteEnMulti(propertyId: string, condicionExtra: string, params: (string | number)[]): Sql {
  const positivo = existeEnMulti(propertyId, condicionExtra, params);
  return { sql: `NOT ${positivo.sql}`, params: positivo.params };
}

function traducirCondicionCampoBase(hoja: CondicionHoja, campo: CampoBase): Sql {
  const columna = `n.${campo}`;
  const valor = hoja.valor;
  switch (hoja.operador) {
    case "igual":
      return { sql: `${columna} = ?`, params: [valor as string] };
    case "distinto":
      return { sql: `${columna} <> ?`, params: [valor as string] };
    case "mayor_que":
      return { sql: `${columna} > ?`, params: [valor as string] };
    case "mayor_o_igual":
      return { sql: `${columna} >= ?`, params: [valor as string] };
    case "menor_que":
      return { sql: `${columna} < ?`, params: [valor as string] };
    case "menor_o_igual":
      return { sql: `${columna} <= ?`, params: [valor as string] };
    case "contiene":
      return { sql: `INSTR(${columna}, ?) > 0`, params: [valor as string] };
    case "no_contiene":
      return { sql: `INSTR(${columna}, ?) = 0`, params: [valor as string] };
    case "empieza_con":
      return { sql: `SUBSTR(${columna}, 1, LENGTH(?)) = ?`, params: [valor as string, valor as string] };
    case "termina_con":
      return { sql: `SUBSTR(${columna}, -LENGTH(?)) = ?`, params: [valor as string, valor as string] };
    case "vacio":
      return { sql: `${columna} = ''`, params: [] };
    case "no_vacio":
      return { sql: `${columna} <> ''`, params: [] };
    default:
      // No debería llegar acá: `validarFiltros` ya rechazó cualquier operador no permitido para este campo_base antes de traducir.
      throw new Error(`operador "${hoja.operador}" no soportado para campo_base "${campo}" (debería haber sido rechazado por validarFiltros)`);
  }
}

function traducirEscalar(hoja: CondicionHoja, propertyId: string, columna: "valor_numero" | "valor_texto"): Sql {
  const valor = hoja.valor;
  switch (hoja.operador) {
    case "igual":
      return existeEnEscalares(propertyId, `ve.${columna} = ?`, [valor as string | number]);
    case "distinto":
      return noExisteEnEscalares(propertyId, `ve.${columna} = ?`, [valor as string | number]);
    case "mayor_que":
      return existeEnEscalares(propertyId, `ve.${columna} > ?`, [valor as string | number]);
    case "mayor_o_igual":
      return existeEnEscalares(propertyId, `ve.${columna} >= ?`, [valor as string | number]);
    case "menor_que":
      return existeEnEscalares(propertyId, `ve.${columna} < ?`, [valor as string | number]);
    case "menor_o_igual":
      return existeEnEscalares(propertyId, `ve.${columna} <= ?`, [valor as string | number]);
    case "vacio":
      return noExisteEnEscalares(propertyId, "", []);
    case "no_vacio":
      return existeEnEscalares(propertyId, "", []);
    default:
      throw new Error(`operador "${hoja.operador}" no soportado para escalar_comparable (property "${propertyId}")`);
  }
}

function traducirTexto(hoja: CondicionHoja, propertyId: string): Sql {
  const valor = hoja.valor as string;
  switch (hoja.operador) {
    case "igual":
      return existeEnEscalares(propertyId, "ve.valor_texto = ?", [valor]);
    case "distinto":
      return noExisteEnEscalares(propertyId, "ve.valor_texto = ?", [valor]);
    case "contiene":
      return existeEnEscalares(propertyId, "INSTR(ve.valor_texto, ?) > 0", [valor]);
    case "no_contiene":
      return noExisteEnEscalares(propertyId, "INSTR(ve.valor_texto, ?) > 0", [valor]);
    case "empieza_con":
      return existeEnEscalares(propertyId, "SUBSTR(ve.valor_texto, 1, LENGTH(?)) = ?", [valor, valor]);
    case "termina_con":
      return existeEnEscalares(propertyId, "SUBSTR(ve.valor_texto, -LENGTH(?)) = ?", [valor, valor]);
    case "vacio":
      return noExisteEnEscalares(propertyId, "ve.valor_texto <> ''", []);
    case "no_vacio":
      return existeEnEscalares(propertyId, "ve.valor_texto <> ''", []);
    default:
      throw new Error(`operador "${hoja.operador}" no soportado para texto (property "${propertyId}")`);
  }
}

function traducirCheckbox(hoja: CondicionHoja, propertyId: string): Sql {
  switch (hoja.operador) {
    case "igual":
      return existeEnEscalares(propertyId, "ve.valor_bool = ?", [(hoja.valor as boolean) ? 1 : 0]);
    case "vacio":
      return noExisteEnEscalares(propertyId, "", []);
    case "no_vacio":
      return existeEnEscalares(propertyId, "", []);
    default:
      throw new Error(`operador "${hoja.operador}" no soportado para checkbox (property "${propertyId}")`);
  }
}

function avisoOpcionInexistente(propiedad: Property, propertyId: string, opcionId: string, diagnosticos: ErrorValidacion[]): void {
  if (propiedad.tipo !== "select" && propiedad.tipo !== "multi_select") return;
  const existe = propiedad.config.opciones.some((opcion) => opcion.id === opcionId);
  if (existe) return;
  diagnosticos.push({
    codigo: "FILTRO_OPCION_INEXISTENTE",
    severidad: "advertencia",
    mensaje: `el filtro sobre la property "${propiedad.nombre}" (${propertyId}) referencia la opción "${opcionId}", que ya no existe en config.opciones — esa condición no puede matchear ninguna fila por esa opción`,
    propertyId,
  });
}

function traducirSelect(hoja: CondicionHoja, propiedad: Property & { tipo: "select" }, diagnosticos: ErrorValidacion[]): Sql {
  const propertyId = propiedad.id;
  switch (hoja.operador) {
    case "igual": {
      const valor = hoja.valor as string;
      avisoOpcionInexistente(propiedad, propertyId, valor, diagnosticos);
      return existeEnEscalares(propertyId, "ve.valor_texto = ?", [valor]);
    }
    case "distinto": {
      const valor = hoja.valor as string;
      avisoOpcionInexistente(propiedad, propertyId, valor, diagnosticos);
      return noExisteEnEscalares(propertyId, "ve.valor_texto = ?", [valor]);
    }
    case "es_alguno_de": {
      const valores = hoja.valor as string[];
      valores.forEach((v) => avisoOpcionInexistente(propiedad, propertyId, v, diagnosticos));
      if (valores.length === 0) return { sql: "0", params: [] }; // ninguna opción puede matchear un conjunto vacío
      return existeEnEscalares(propertyId, `ve.valor_texto IN (${valores.map(() => "?").join(", ")})`, valores);
    }
    case "no_es_ninguno_de": {
      const valores = hoja.valor as string[];
      valores.forEach((v) => avisoOpcionInexistente(propiedad, propertyId, v, diagnosticos));
      if (valores.length === 0) return { sql: "1", params: [] }; // "distinto de todos los de un conjunto vacío" es vacuamente verdadero
      return noExisteEnEscalares(propertyId, `ve.valor_texto IN (${valores.map(() => "?").join(", ")})`, valores);
    }
    case "vacio":
      return noExisteEnEscalares(propertyId, "", []);
    case "no_vacio":
      return existeEnEscalares(propertyId, "", []);
    default:
      throw new Error(`operador "${hoja.operador}" no soportado para select (property "${propertyId}")`);
  }
}

function traducirMultiSelect(hoja: CondicionHoja, propiedad: Property & { tipo: "multi_select" }, diagnosticos: ErrorValidacion[]): Sql {
  const propertyId = propiedad.id;
  switch (hoja.operador) {
    case "contiene": {
      const valor = hoja.valor as string;
      avisoOpcionInexistente(propiedad, propertyId, valor, diagnosticos);
      return existeEnMulti(propertyId, "vm.opcion_id = ?", [valor]);
    }
    case "no_contiene": {
      const valor = hoja.valor as string;
      avisoOpcionInexistente(propiedad, propertyId, valor, diagnosticos);
      return noExisteEnMulti(propertyId, "vm.opcion_id = ?", [valor]);
    }
    case "contiene_alguno_de": {
      const valores = hoja.valor as string[];
      valores.forEach((v) => avisoOpcionInexistente(propiedad, propertyId, v, diagnosticos));
      if (valores.length === 0) return { sql: "0", params: [] };
      return existeEnMulti(propertyId, `vm.opcion_id IN (${valores.map(() => "?").join(", ")})`, valores);
    }
    case "contiene_todos_de": {
      const valores = hoja.valor as string[];
      valores.forEach((v) => avisoOpcionInexistente(propiedad, propertyId, v, diagnosticos));
      if (valores.length === 0) return { sql: "1", params: [] }; // "contiene todos los de un conjunto vacío" no exige nada
      // AND de un EXISTS por cada opción requerida: "contiene TODAS" es la
      // conjunción de "contiene esta" para cada una — más simple de
      // construir con el mismo helper que el resto de este módulo que un
      // GROUP BY/HAVING con conteo.
      const partes = valores.map((v) => existeEnMulti(propertyId, "vm.opcion_id = ?", [v]));
      return { sql: partes.map((p) => `(${p.sql})`).join(" AND "), params: partes.flatMap((p) => p.params) };
    }
    case "vacio":
      return noExisteEnMulti(propertyId, "", []);
    case "no_vacio":
      return existeEnMulti(propertyId, "", []);
    default:
      throw new Error(`operador "${hoja.operador}" no soportado para multi_select (property "${propertyId}")`);
  }
}

function traducirCondicionProperty(hoja: CondicionHoja, propiedad: Property, diagnosticos: ErrorValidacion[]): Sql {
  switch (propiedad.tipo) {
    case "numero":
      return traducirEscalar(hoja, propiedad.id, "valor_numero");
    case "fecha":
      return traducirEscalar(hoja, propiedad.id, "valor_texto");
    case "texto":
    case "agente":
      return traducirTexto(hoja, propiedad.id);
    case "checkbox":
      return traducirCheckbox(hoja, propiedad.id);
    case "select":
      return traducirSelect(hoja, propiedad, diagnosticos);
    case "multi_select":
      return traducirMultiSelect(hoja, propiedad, diagnosticos);
  }
}

function traducirCondicionHoja(hoja: CondicionHoja, database: Database, diagnosticos: ErrorValidacion[]): Sql {
  const campo = hoja.campo;
  if (campo.tipo === "campo_base") {
    return traducirCondicionCampoBase(hoja, campo.campo);
  }
  // Se extrae `propertyId` a una variable local ANTES del closure de `.find`:
  // TypeScript no preserva el narrowing de un discriminated union sobre un
  // *property access* (`hoja.campo.propertyId`) dentro de una función anidada
  // — solo lo preserva sobre una variable `const` ya narrowed en el scope
  // externo. `campo.propertyId` narrowed arriba, capturado como `string`
  // plano, evita el problema en la raíz en vez de repetir el chequeo.
  const propertyId = campo.propertyId;
  const propiedad = database.propiedades.find((p) => p.id === propertyId)!; // validado antes de traducir
  return traducirCondicionProperty(hoja, propiedad, diagnosticos);
}

function traducirGrupo(grupo: Grupo | GrupoAnidado, database: Database, diagnosticos: ErrorValidacion[]): Sql {
  const partes: string[] = [];
  const params: (string | number)[] = [];

  for (const condicion of grupo.condiciones) {
    const esGrupo = esFormaDeGrupo(condicion);
    const traducido = esGrupo
      ? traducirGrupo(condicion as GrupoAnidado, database, diagnosticos)
      : traducirCondicionHoja(condicion as CondicionHoja, database, diagnosticos);
    partes.push(esGrupo ? `(${traducido.sql})` : traducido.sql);
    params.push(...traducido.params);
  }

  const conector = grupo.combinador === "y" ? " AND " : " OR ";
  return { sql: partes.join(conector), params };
}

// ---------------------------------------------------------------------------
// Traducción de `orden` a SQL (ORDER BY + LEFT JOIN) — asume entrada ya validada
// ---------------------------------------------------------------------------

function columnaEscalarParaOrden(tipoProperty: TipoProperty): "valor_texto" | "valor_numero" | "valor_bool" {
  switch (tipoProperty) {
    case "numero":
      return "valor_numero";
    case "checkbox":
      return "valor_bool";
    case "fecha":
    case "texto":
    case "agente":
    case "select":
      return "valor_texto";
    case "multi_select":
      // No debería llegar acá: `validarOrden` rechaza multi_select antes de traducir.
      throw new Error("multi_select no es un campo válido de orden (debería haber sido rechazado por validarOrden)");
  }
}

function traducirOrden(orden: OrdenCampo[], database: Database): { sqlOrden: string[]; joinsSql: string[]; joinParams: (string | number)[] } {
  const sqlOrden: string[] = [];
  const joinsSql: string[] = [];
  const joinParams: (string | number)[] = [];

  orden.forEach((ordenCampo, indice) => {
    const direccionSql = ordenCampo.direccion === "asc" ? "ASC" : "DESC";
    const campo = ordenCampo.campo;
    if (campo.tipo === "campo_base") {
      sqlOrden.push(`n.${campo.campo} ${direccionSql} NULLS LAST`);
      return;
    }
    // Mismo motivo que en `traducirCondicionHoja`: extraer `propertyId` a una
    // variable local antes del closure de `.find` evita perder el narrowing.
    const propertyId = campo.propertyId;
    const propiedad = database.propiedades.find((p) => p.id === propertyId)!; // validado antes de traducir
    const alias = `oj${indice}`;
    const columna = columnaEscalarParaOrden(propiedad.tipo);
    joinsSql.push(`LEFT JOIN valores_escalares ${alias} ON ${alias}.row_id = n.id AND ${alias}.property_id = ?`);
    joinParams.push(propiedad.id);
    sqlOrden.push(`${alias}.${columna} ${direccionSql} NULLS LAST`);
  });

  return { sqlOrden, joinsSql, joinParams };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** El subconjunto de `View` que necesita el traductor — la misma forma sirve para una View persistida o para una query ad-hoc (ADR-004 sección 3: "un solo validador/traductor... no hay una gramática para View guardada y otra distinta para query de una vez"). */
export interface ConsultaVista {
  filtros: Grupo | null;
  orden: OrdenCampo[];
}

export interface ResultadoConsulta {
  filas: Row[];
  /** Diagnósticos no fatales (hoy, únicamente `FILTRO_OPCION_INEXISTENTE` — ADR-004 sección 2). La consulta igual se resolvió y devolvió filas. */
  diagnosticos: ErrorValidacion[];
}

/** Azúcar para distinguir el resultado sin repetir `Array.isArray` en cada llamador — mismo patrón que `esErrorDeLectura`/`esErrorDeParseo`. */
export function esErrorDeConsulta(resultado: ResultadoConsulta | ErrorValidacion[]): resultado is ErrorValidacion[] {
  return Array.isArray(resultado);
}

/**
 * Resuelve `consulta` (filtros + orden) contra las Rows de `database`
 * indexadas en `indice`. Devuelve la lista (no vacía) de `ErrorValidacion`
 * si `consulta.filtros`/`consulta.orden` no son válidos para el esquema de
 * `database` — nunca traduce ni ejecuta nada en ese caso. Si son válidos,
 * devuelve las `Row` resultantes en el orden que decidió SQL, más los
 * diagnósticos no fatales que surgieron al traducir (opciones de select/
 * multi_select inexistentes).
 */
export function resolverConsulta(indice: Indice, database: Database, consulta: ConsultaVista): ResultadoConsulta | ErrorValidacion[] {
  const erroresFiltros = validarFiltros(consulta.filtros, database);
  if (erroresFiltros.length > 0) return erroresFiltros;
  const erroresOrden = validarOrden(consulta.orden, database);
  if (erroresOrden.length > 0) return erroresOrden;

  const diagnosticos: ErrorValidacion[] = [];
  const traduccionFiltros: Sql =
    consulta.filtros === null ? { sql: "1=1", params: [] } : traducirGrupo(consulta.filtros, database, diagnosticos);

  const { sqlOrden, joinsSql, joinParams } = traducirOrden(consulta.orden, database);

  const sql = [
    "SELECT n.id AS id",
    "FROM nodos n",
    ...joinsSql,
    `WHERE n.tipo = 'fila' AND n.parent_id = ? AND (${traduccionFiltros.sql})`,
    `ORDER BY ${sqlOrden.length > 0 ? sqlOrden.join(", ") : "n.id ASC"}`,
  ].join(" ");

  const params: (string | number)[] = [...joinParams, database.id, ...traduccionFiltros.params];
  const filasIdOrdenadas = indice.sqlite.prepare<{ id: string }, (string | number)[]>(sql).all(...params);

  const filas: Row[] = [];
  for (const { id } of filasIdOrdenadas) {
    const nodo = indice.filas.get(id);
    if (nodo) filas.push(nodo.valor);
  }
  return { filas, diagnosticos };
}

/** Extrae `{ filtros, orden }` de `view` y delega en `resolverConsulta` — ver `ConsultaVista`. */
export function resolverVista(indice: Indice, database: Database, view: View): ResultadoConsulta | ErrorValidacion[] {
  return resolverConsulta(indice, database, { filtros: view.filtros, orden: view.orden });
}
