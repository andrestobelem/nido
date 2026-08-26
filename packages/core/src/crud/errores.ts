/**
 * Errores tipados del CRUD de alto nivel (T-0019). Mismo criterio que
 * `../almacenamiento/escritura.ts`/`../almacenamiento/lectura.ts`: cada
 * condición que impide completar una operación es una clase de error propia
 * con el contexto necesario para diagnosticar sin volver a consultar nada —
 * nunca un `Error` genérico con un string suelto.
 *
 * `ConflictoDeEscritura` (CAS, ADR-001 punto 2) y `NodoNoEncontrado`
 * (archivo inexistente) NO se redefinen acá: las funciones de este
 * directorio los dejan propagar tal cual desde
 * `../almacenamiento/escritura.ts`/`../almacenamiento/lectura.ts` — son
 * exactamente el mismo error en el CRUD que en el motor de bajo nivel,
 * redefinirlos sería duplicar sin necesidad.
 */

import type { ErrorValidacion } from "../invariantes.ts";

/** ADR-006 sección 1: agregar una Property `requerida: true` a una Database que ya tiene al menos una Row se rechaza sin agregar nada. */
export class PropertyRequeridaRechazada extends Error {
  constructor(databaseId: string, propertyNombre: string, cantidadRows: number) {
    super(
      `no se puede agregar la property "${propertyNombre}" como requerida: la Database "${databaseId}" ya tiene ${cantidadRows} Row(s). Agregala primero como no-requerida y usá promoverPropertyARequerida después de poblar cada Row con su valor real (ADR-006 sección 1).`,
    );
  }
}

/** Cuántas Rows faltantes reporta como máximo `PromocionFallida` — ADR-006 sección 2: "acotado... para que el error siga siendo legible en una Database grande". */
export const LIMITE_ROWS_FALTANTES_REPORTADAS = 50;

export interface RowFaltante {
  id: string;
  /** Relativo a la raíz del workspace — el mismo valor que `NodoIndexado.path`. */
  path: string;
}

/** ADR-006 sección 2: `promoverPropertyARequerida` falla sin tocar el esquema si alguna Row no tiene valor para la Property. */
export class PromocionFallida extends Error {
  readonly rowsFaltantes: RowFaltante[];
  readonly totalFaltantes: number;

  constructor(databaseId: string, propertyId: string, rowsFaltantes: RowFaltante[], totalFaltantes: number) {
    super(
      `no se puede promover la property "${propertyId}" a requerida en la Database "${databaseId}": ${totalFaltantes} Row(s) no tienen valor para esa property (mostrando ${rowsFaltantes.length} de ${totalFaltantes}). El esquema no se modificó.`,
    );
    this.rowsFaltantes = rowsFaltantes;
    this.totalFaltantes = totalFaltantes;
  }
}

/**
 * `actualizarDatabase`: `cambios` trae `propiedades`/`vistas` — campos de
 * esquema que esa función nunca debe tocar (existen `agregarProperty`/
 * `promoverPropertyARequerida`/`quitarProperty`/`agregarVista`/
 * `actualizarVista`/`quitarVista` exactamente para eso, cada una con su
 * propia validación de ADR-006/ADR-004). `CambiosDatabase` ya excluye esas
 * claves a nivel de TIPO, pero eso no protege en runtime a un llamador que
 * castee (`as any`) o construya `cambios` a partir de JSON externo — de ahí
 * este chequeo explícito, sin el cual `actualizarDatabase` persistiría
 * cualquier esquema sin ninguna de esas validaciones.
 */
export class CambiosDatabaseInvalidos extends Error {
  constructor(databaseId: string, clavesProhibidas: string[]) {
    super(
      `actualizarDatabase no acepta cambios de esquema: "${clavesProhibidas.join('", "')}" en la Database "${databaseId}". Usá agregarProperty/promoverPropertyARequerida/quitarProperty para propiedades, o agregarVista/actualizarVista/quitarVista para vistas.`,
    );
  }
}

/**
 * `agregarVista`/`actualizarVista`: la View declara un `databaseId` distinto
 * de la Database en la que se está agregando/actualizando. Sin este chequeo,
 * la View se persistiría con un campo de dominio (`docs/01-modelo-dominio.md`:
 * "View... `database_id`") factualmente falso — apuntando a una Database que
 * no es la que realmente la contiene.
 */
export class VistaDatabaseIdIncorrecto extends Error {
  constructor(databaseId: string, viewId: string, databaseIdDeclarado: string) {
    super(
      `la View "${viewId}" declara databaseId "${databaseIdDeclarado}", pero se está agregando/actualizando en la Database "${databaseId}"`,
    );
  }
}

export class PropertyNoEncontrada extends Error {
  constructor(databaseId: string, propertyId: string) {
    super(`la Database "${databaseId}" no tiene ninguna property con id "${propertyId}" en su esquema actual`);
  }
}

export class PropertyIdDuplicado extends Error {
  constructor(databaseId: string, propertyId: string) {
    super(`la Database "${databaseId}" ya tiene una property con id "${propertyId}" en su esquema`);
  }
}

/**
 * `crearDatabase`: `propiedades` no tiene una forma válida de `Property[]`
 * — ver `validarFormaDePropiedades` en `../invariantes.ts`. Mismo motivo que
 * `ValoresInvalidos`: se lanza antes de reservar un id o escribir cualquier
 * archivo, para una entrada que ni siquiera tiene la forma de esquema que
 * el resto del CRUD (`agregarProperty`/`promoverPropertyARequerida`/
 * `quitarProperty`) asume.
 */
export class PropiedadesInvalidas extends Error {
  readonly errores: ErrorValidacion[];
  constructor(errores: ErrorValidacion[]) {
    super(`"propiedades" no tiene una forma válida: ${errores.map((error) => error.mensaje).join("; ")}`);
    this.errores = errores;
  }
}

/** `crearRow`/`actualizarRow`: la Row resultante tiene al menos un error fatal contra el esquema de su Database (invariantes 2/3) — no se escribe nada. */
export class RowInvalida extends Error {
  readonly errores: ErrorValidacion[];
  constructor(rowId: string, errores: ErrorValidacion[]) {
    super(`la Row "${rowId}" no es válida contra el esquema de su Database: ${errores.map((error) => error.mensaje).join("; ")}`);
    this.errores = errores;
  }
}

/**
 * `crearRow`/`actualizarRow`: `valores` no tiene una forma válida de
 * `PropertyValue[]` — ver `validarFormaDeValores` en `../invariantes.ts`.
 * Se lanza ANTES de intentar cualquier validación de esquema (`RowInvalida`)
 * o de reservar un id/escribir un archivo: a diferencia de `RowInvalida`
 * (que asume una Row ya bien formada y la rechaza por su CONTENIDO contra
 * el esquema), esta clase cubre el caso previo — la entrada ni siquiera
 * tiene la FORMA de un `PropertyValue[]` (falta `propertyId`, `valor` de un
 * tipo no soportado, un array/objeto donde no corresponde, etc.) —
 * exactamente lo que puede llegar de un flag de CLI/una llamada de MCP con
 * JSON sintácticamente válido pero de forma incorrecta.
 */
export class ValoresInvalidos extends Error {
  readonly errores: ErrorValidacion[];
  constructor(errores: ErrorValidacion[]) {
    super(`"valores" no tiene una forma válida: ${errores.map((error) => error.mensaje).join("; ")}`);
    this.errores = errores;
  }
}

export class VistaNoEncontrada extends Error {
  constructor(databaseId: string, viewId: string) {
    super(`la Database "${databaseId}" no tiene ninguna View con id "${viewId}"`);
  }
}

export class VistaIdDuplicada extends Error {
  constructor(databaseId: string, viewId: string) {
    super(`la Database "${databaseId}" ya tiene una View con id "${viewId}"`);
  }
}

/** `agregarVista`/`actualizarVista`: `filtros`/`orden` no son válidos contra el esquema actual (ver `../indice/vistas.ts`) — no se escribe nada. */
export class VistaInvalida extends Error {
  readonly errores: ErrorValidacion[];
  constructor(viewId: string, errores: ErrorValidacion[]) {
    super(`la View "${viewId}" no es válida contra el esquema de su Database: ${errores.map((error) => error.mensaje).join("; ")}`);
    this.errores = errores;
  }
}

/**
 * `resolverVistaDeDatabase`: el `databaseId` pedido no aparece en el índice
 * recién construido — porque el archivo no existe, o porque se excluyó del
 * índice por alguna violación de ADR-002 sección 5 (id duplicado, ciclo,
 * parent_id colgante, etc. — ver `indice.diagnosticos`).
 */
export class DatabaseNoIndexada extends Error {
  constructor(databaseId: string) {
    super(
      `la Database "${databaseId}" no está en el índice del workspace — no existe, o fue excluida por un error de validación (ver los diagnósticos del índice)`,
    );
  }
}
