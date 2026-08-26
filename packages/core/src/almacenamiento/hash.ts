/**
 * Qué se hashea para el CAS de ADR-001, y dónde vive (T-0017, ADR-002
 * sección 4): "se hashea el contenido completo del archivo tal cual está en
 * disco — los bytes crudos, no una re-serialización canónica del objeto
 * parseado" vía `Bun.hash()` sobre el `ArrayBuffer` que devuelve
 * `Bun.file(path).arrayBuffer()`. El valor nunca se persiste (ni en el
 * archivo, ni en un índice): vive solo en memoria, durante el ciclo de una
 * operación — este módulo no guarda nada, solo calcula.
 *
 * Módulo chico y compartido a propósito: tanto `lectura.ts` (que captura el
 * hash al leer, para que quien actualice lo pueda pasar después) como
 * `escritura.ts` (que lo recalcula justo antes del `rename` para compararlo)
 * necesitan exactamente esta misma noción de "hash de los bytes crudos de
 * este path ahora mismo, o `null` si el path no existe ahora mismo" — vive
 * en un solo lugar en vez de duplicarse en los dos.
 */

export type HashDeContenido = ReturnType<typeof Bun.hash> | null;

function esArchivoInexistente(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

/**
 * Bytes crudos de `pathAbsoluto` en este momento, o `null` si el archivo no
 * existe. `null` es un resultado válido, no una excepción: un path que
 * todavía no existe es el caso normal de "voy a crear este nodo".
 */
async function bytesCrudosOAusente(pathAbsoluto: string): Promise<ArrayBuffer | null> {
  try {
    return await Bun.file(pathAbsoluto).arrayBuffer();
  } catch (error) {
    if (esArchivoInexistente(error)) return null;
    throw error;
  }
}

/**
 * Hash de los bytes crudos de `pathAbsoluto`, o `null` si el archivo no
 * existe en este momento. `null` es un tercer estado deliberado (no un
 * hash cualquiera, no una excepción): así, "crear un nodo nuevo" es para el
 * CAS un caso particular de "el hash esperado es `null`" — el mismo
 * mecanismo de comparación cubre creación y actualización sin dos code
 * paths distintos.
 */
export async function hashDeArchivo(pathAbsoluto: string): Promise<HashDeContenido> {
  const bytes = await bytesCrudosOAusente(pathAbsoluto);
  return bytes === null ? null : Bun.hash(bytes);
}

/**
 * Lee los bytes crudos de `pathAbsoluto` y su hash en la misma lectura (una
 * sola llamada a `arrayBuffer()`), para que quien necesite ambos (`lectura.ts`,
 * que hashea y a la vez decodifica el texto a parsear) no tenga una ventana
 * entre "leer para hashear" y "leer para parsear" donde el archivo pudiera
 * cambiar y dejar el hash capturado desincronizado del contenido realmente
 * parseado. `null` si el archivo no existe.
 */
export async function leerBytesCrudosConHash(
  pathAbsoluto: string,
): Promise<{ bytes: ArrayBuffer; hash: HashDeContenido } | null> {
  const bytes = await bytesCrudosOAusente(pathAbsoluto);
  if (bytes === null) return null;
  return { bytes, hash: Bun.hash(bytes) };
}

/** Comparación explícita en vez de `===` disperso por el código que la usa — un solo lugar que documenta qué significa "coinciden". */
export function hashesIguales(a: HashDeContenido, b: HashDeContenido): boolean {
  return a === b;
}
