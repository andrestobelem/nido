/**
 * Tipos de dominio de nido (T-0009). Solo tipos: sin I/O, sin bun:sqlite,
 * sin nada que dependa del filesystem — eso es de packages/core/src/store.ts
 * (T-0010) y del motor de sync (T-0012).
 *
 * Convención de nombres: identificadores de código en camelCase, con las
 * palabras de dominio en español (mismo estilo que packages/tickets/src/types.ts,
 * ej. `creadoEn`). Los *valores* string que ya tienen vocabulario fijado por
 * los ADRs (`"multi_select"`, `"creado_en"`, `"es_alguno_de"`, etc.) se dejan
 * tal cual el ADR los nombra, snake_case incluido: son datos, no identificadores
 * de código.
 */

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/** docs/01-modelo-dominio.md: raíz única del contenido. No es una Page. */
export interface Workspace {
  id: string;
  nombre: string;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * Nodo de contenido genérico (docs/01-modelo-dominio.md). `cuerpo` es texto
 * Markdown plano — v1 no modela bloques ricos.
 *
 * Nota deliberada: el modelo de dominio también describe un campo `sync`
 * (path, hash, última sincronización) para Page. ADR-002 sección 2 resuelve
 * que ese campo es bookkeeping del motor de sync — no se serializa dentro
 * del nodo y puede vivir en el índice derivado — así que no es parte de este
 * tipo de dominio en memoria. Modelarlo acá anticiparía una decisión de
 * T-0012 que este ticket no toca.
 */
export interface Page {
  id: string;
  tipo: "pagina";
  parentId: string | null;
  titulo: string;
  cuerpo: string;
  creadoEn: string;
  actualizadoEn: string;
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/** Subconjunto v1 cerrado (docs/adr/003-tipos-de-property.md). */
export type TipoProperty =
  | "texto"
  | "numero"
  | "select"
  | "multi_select"
  | "fecha"
  | "checkbox"
  | "agente";

/**
 * Opción de un `select`/`multi_select`. `id` es estable (una PropertyValue
 * referencia la opción por `id`, nunca por `nombre` — docs/01-modelo-dominio.md).
 */
export interface OpcionProperty {
  id: string;
  nombre: string;
}

export interface ConfigOpciones {
  opciones: OpcionProperty[];
}

interface PropertyBase {
  id: string;
  nombre: string;
  requerida: boolean;
}

/**
 * Definición de una columna del esquema de una Database. Unión discriminada
 * por `tipo`: solo `select`/`multi_select` llevan `config` — para los otros
 * cinco tipos el campo está ausente (ADR-002: "campo ausente = no aplica a
 * este objeto", no `null`).
 */
export type Property =
  | (PropertyBase & { tipo: "texto" })
  | (PropertyBase & { tipo: "numero" })
  | (PropertyBase & { tipo: "select"; config: ConfigOpciones })
  | (PropertyBase & { tipo: "multi_select"; config: ConfigOpciones })
  | (PropertyBase & { tipo: "fecha" })
  | (PropertyBase & { tipo: "checkbox" })
  | (PropertyBase & { tipo: "agente" });

// ---------------------------------------------------------------------------
// Database (Page especial con esquema y Views)
// ---------------------------------------------------------------------------

/**
 * Una Database es una Page especial que define un esquema y contiene filas
 * (docs/01-modelo-dominio.md). `propiedades` es una lista ordenada — el
 * orden es dato de dominio (ADR-002), quien construye/actualiza la lista es
 * responsable de mantenerlo.
 *
 * `cuerpo` es **opcional**, a diferencia de `Page` (donde es requerido):
 * ADR-002 sección 3 usa explícitamente "`cuerpo` en una Database que nunca lo
 * usó" como el ejemplo de manual de un campo que debe estar *ausente* (la
 * clave no existe), no `""` ni `null` — "campo ausente = no aplica a este
 * objeto". Cuando una Database sí tiene `cuerpo`, se serializa como string
 * JSON normal (ADR-002, mismo lugar).
 */
export interface Database extends Omit<Page, "cuerpo"> {
  cuerpo?: string;
  propiedades: Property[];
  vistas: View[];
}

// ---------------------------------------------------------------------------
// PropertyValue / Row
// ---------------------------------------------------------------------------

/**
 * Forma en runtime de un valor, según el tipo de su Property:
 * texto/agente → string; numero → number; fecha → string "YYYY-MM-DD"
 * opaco; checkbox → boolean; select → string (id de opción);
 * multi_select → string[] (ids de opción).
 *
 * No se declara un campo `tipo` redundante en `PropertyValue`: el tipo real
 * ya lo declara la `Property` correspondiente en el esquema de la Database,
 * y duplicarlo acá abriría la puerta a que ambos se desincronicen. La
 * validación (`validarRow`) es la que cruza este valor contra el tipo
 * declarado de su Property.
 */
export type ValorPropertyValue = string | number | boolean | string[];

/** Valor concreto de una Property en una Row (docs/01-modelo-dominio.md). */
export interface PropertyValue {
  propertyId: string;
  valor: ValorPropertyValue;
}

/**
 * Una Row es una Page cuyo `parentId` es una Database. Sin campo `cuerpo`
 * (ADR-002, decisión explícita: una Row no tiene prosa). `parentId` nunca es
 * `null` — una Row siempre pertenece a una Database (invariante 1).
 */
export interface Row extends Omit<Page, "tipo" | "cuerpo" | "parentId"> {
  tipo: "fila";
  parentId: string;
  valores: PropertyValue[];
}

// ---------------------------------------------------------------------------
// View — árbol de filtros (docs/adr/004-expresividad-de-views.md)
// ---------------------------------------------------------------------------

/** Campos base filtrables/ordenables que no son una Property del esquema. */
export type CampoBase = "titulo" | "id" | "creado_en" | "actualizado_en";

/** A qué campo referencia una `CondicionHoja`: una Property o un campo base. */
export type RefCampo =
  | { tipo: "propiedad"; propertyId: string }
  | { tipo: "campo_base"; campo: CampoBase };

/**
 * Operadores de filtro, unión de todas las familias de tipo (ADR-004
 * sección 1). Qué operadores son válidos para qué familia/campo es una
 * regla de validación, no algo que el tipo por sí solo restrinja acá.
 */
export type Operador =
  | "igual"
  | "distinto"
  | "mayor_que"
  | "mayor_o_igual"
  | "menor_que"
  | "menor_o_igual"
  | "contiene"
  | "no_contiene"
  | "empieza_con"
  | "termina_con"
  | "es_alguno_de"
  | "no_es_ninguno_de"
  | "contiene_alguno_de"
  | "contiene_todos_de"
  | "vacio"
  | "no_vacio";

export type Combinador = "y" | "o";

/** Condición hoja del árbol de filtros. `valor` está ausente para los operadores unarios. */
export interface CondicionHoja {
  campo: RefCampo;
  operador: Operador;
  valor?: string | number | boolean | string[];
}

/**
 * Grupo anidado: solo puede contener condiciones hoja, nunca otro Grupo.
 * Es lo que impone, a nivel de tipo, el tope de profundidad 2 de ADR-004.
 */
export interface GrupoAnidado {
  combinador: Combinador;
  condiciones: CondicionHoja[];
}

/**
 * Grupo raíz de `filtros`: puede contener condiciones hoja o, como mucho,
 * un nivel de `GrupoAnidado` — nunca un `Grupo` dentro de otro `Grupo` sin
 * límite (ADR-004: profundidad máxima 2).
 */
export interface Grupo {
  combinador: Combinador;
  condiciones: (CondicionHoja | GrupoAnidado)[];
}

export type Direccion = "asc" | "desc";

/**
 * Un campo del orden multi-campo de una View. Igual que `CondicionHoja`,
 * referencia una Property o un campo base vía `RefCampo` — ADR-004 sección 2
 * es explícito en que `orden` sobre `creado_en`/`actualizado_en` (campos
 * base, no Properties del esquema) ordena correctamente por comparación de
 * string plana, igual que `fecha`. `multi_select` no es un campo válido de
 * `orden` (rechazado en validación, no algo que este tipo por sí solo
 * restrinja acá — mismo patrón que los operadores de `CondicionHoja`).
 */
export interface OrdenCampo {
  campo: RefCampo;
  direccion: Direccion;
}

/**
 * Consulta guardada sobre una Database (docs/01-modelo-dominio.md).
 * `filtros: null` significa "todas las filas" — nunca un `Grupo` vacío
 * (`condiciones: []`), que ADR-004 trata como error de validación aparte.
 */
export interface View {
  id: string;
  nombre: string;
  databaseId: string;
  filtros: Grupo | null;
  orden: OrdenCampo[];
  /** Subconjunto de `property_id` a mostrar. Ausente = todas las columnas. */
  columnasVisibles?: string[];
}
