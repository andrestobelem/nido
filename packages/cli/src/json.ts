/**
 * Utilidades de (de)serialización JSON específicas de esta superficie
 * (T-0013). `HashDeContenido` (`@nido/core/src/almacenamiento/hash.ts`) es
 * un `bigint` en memoria — `Bun.hash()` devuelve un entero de 64 bits sin
 * signo, fuera del rango seguro de `number` — y `JSON.stringify` no sabe
 * serializar `bigint` (lanza `TypeError` sin un `replacer`). Ninguno de los
 * dos problemas es del core: es enteramente cómo esta CLI expone ese valor
 * en su salida `--json` y cómo lo vuelve a leer desde un flag `--hash`.
 */

export function stringificarJson(valor: unknown): string {
  return JSON.stringify(valor, (_clave, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

export class HashInvalido extends Error {
  constructor(texto: string) {
    super(`"${texto}" no es un hash válido (se espera un entero, el mismo valor que devuelve "page get" en el campo "hash")`);
  }
}

/** Parsea el texto de `--hash` (decimal, tal cual lo imprime `stringificarJson` para un `bigint`) de vuelta a `bigint`. */
export function hashDesdeTexto(texto: string): bigint {
  try {
    return BigInt(texto);
  } catch {
    throw new HashInvalido(texto);
  }
}
