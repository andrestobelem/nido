/**
 * Generación de id y convención de path para un nodo nuevo de nido (T-0019).
 *
 * ## Esquema de id: UUID v4 (`crypto.randomUUID()`), un solo espacio de ids
 * compartido entre Page/Database/Row
 *
 * A diferencia de `packages/tickets/src/id.ts` (contador secuencial
 * `T-0001`, `T-0002`, ... que necesita escanear el directorio para calcular
 * "el próximo número", y reintentar si dos creaciones concurrentes calculan
 * el mismo candidato porque ambas leyeron el directorio antes de que
 * cualquiera creara su archivo), nido no tiene ningún requisito de dominio
 * que le dé significado al orden de creación vía el id:
 * `docs/01-modelo-dominio.md` es explícito en que el `id` de una
 * Page/Database/Row "es estable, no depende de la posición ni del título" —
 * nada lee ni ordena por id como si fuera un contador. Sin esa necesidad, no
 * hace falta coordinar un contador global compartido entre los tres tipos de
 * nodo (que sí sería necesario si se quisiera, por ejemplo, "el próximo id
 * disponible" como hace tickets).
 *
 * En cambio, se usa `crypto.randomUUID()` (UUIDv4, 122 bits de entropía
 * aleatoria real). La probabilidad de colisión entre dos ids generados al
 * azar es despreciable para cualquier tamaño de workspace realista (el
 * límite de cumpleaños da algo como 2^-61 de chance de una sola colisión
 * incluso con mil millones de ids ya generados) — muy distinto del esquema
 * de tickets, donde DOS creaciones concurrentes SIEMPRE pueden calcular el
 * mismo candidato y el reintento ante `EEXIST` es lo único que hace que ese
 * esquema converja. Acá el reintento (`crearConIdReintentando`, más abajo)
 * es una red de seguridad defensiva contra un evento cosmológicamente
 * improbable, no el mecanismo que hace correcto al esquema.
 *
 * La atomicidad real de "crear" ya la da T-0017: `escribirPage`/
 * `escribirDatabase`/`escribirRow` con `hashEsperado: null` commitean vía
 * `link()`, que falla atómicamente con `EEXIST` a nivel de kernel si el
 * destino ya existe (`ConflictoDeEscritura` en ese caso) — exactamente la
 * garantía que ADR-001 punto 1 pide ("reserva de id por creación exclusiva
 * de archivo... con reintento ante EEXIST"), solo que vía `link()` en vez
 * del `open(path, "wx")` que usa `packages/tickets/src/id.ts`. Por eso este
 * módulo no necesita un paso separado de "reservar" el id antes de escribir
 * el contenido real (como sí hace `reservarProximoId` de tickets, que crea
 * un archivo vacío primero y recién después el llamador escribe el
 * contenido de verdad): generar el id y escribir el objeto completo de una
 * sola vez ya es, acá, atómico por construcción.
 *
 * Un solo espacio de ids para los tres tipos de nodo — no un prefijo por
 * tipo como "pag-"/"db-"/"row-": `docs/01-modelo-dominio.md` (invariante 7)
 * trata el id como una propiedad estable de cualquier nodo sin distinguir
 * tipo, y `validarIdsUnicos`/`ID_DUPLICADO` en `../indice/construccion.ts`
 * ya compara ids a través de los tres tipos sin distinción. Un prefijo por
 * tipo sería una garantía redundante que nadie pidió, encima de la que ya da
 * un espacio de 122 bits al azar.
 *
 * ### Nota honesta sobre el alcance real de "atómico por construcción"
 *
 * La atomicidad de creación vía `link()`/`EEXIST` que describe el párrafo
 * anterior es, en rigor, atómica *por extensión de archivo*, no por id
 * puro: `pathDePage` escribe a `<id>.md`, mientras que `pathDeDatabase` y
 * `pathDeRow` comparten `<id>.json`. Si dos creaciones concurrentes de
 * *tipos distintos* generan por azar el mismo id (por ejemplo, una Page y
 * una Database), cada una hace `link()` a un path distinto
 * (`<id>.md` vs. `<id>.json`) — ninguna ve `EEXIST`, así que **ambas
 * escrituras tienen éxito** y el choque no lo detecta este módulo, sino
 * `construirIndice` después, vía `ID_DUPLICADO` (`../indice/construccion.ts`),
 * que en ese caso excluye a los dos nodos colisionados del índice hasta que
 * se resuelva a mano. Dentro del mismo tipo (Database↔Row, mismo `.json`) sí
 * hay atomicidad real de kernel, porque ahí sí comparten path candidato.
 * No es una brecha que valga la pena cerrar con código: con UUIDv4 real la
 * probabilidad de este choque es la misma que cualquier colisión de UUID
 * (≈2^-61 incluso con mil millones de ids ya generados) — muy por debajo de
 * cualquier riesgo operativo real. Se documenta para que quede explícito qué
 * garantiza esto y qué no, no porque haga falta un fix.
 *
 * ## Convención de path: layout plano en la raíz del workspace
 *
 * Ningún ADR fija todavía un layout de directorios para los archivos de
 * nido (ADR-001 solo fija dónde cae la raíz del workspace dentro del repo,
 * no la disposición interna de archivos) — es una decisión de
 * implementación que le toca a este ticket, porque las funciones de
 * creación necesitan un `pathRelativo` concreto para pasarle a
 * `escribirPage`/`escribirDatabase`/`escribirRow`. Se elige el layout más
 * simple posible: cada nodo vive directo en la raíz del workspace, como
 * `<id>.md` (Page) o `<id>.json` (Database, Row) — sin ninguna carpeta que
 * imite el árbol de `parentId`.
 *
 * Por qué es una decisión segura de tomar acá, sin comprometer a T-0012
 * (motor de sync) más adelante: `../almacenamiento/confinamiento.ts` solo le
 * importa el nombre base del archivo (`<id>.md`/`<id>.json`), y
 * `../indice/escaneo.ts` ya recorre subdirectorios arbitrarios sin asumir
 * ninguna estructura particular — nada en T-0017/T-0018 depende de que los
 * archivos estén en un layout plano en vez de anidado. Si T-0012 decide más
 * adelante materializar un layout más "legible para humanos" (por ejemplo,
 * un directorio por Database conteniendo sus Rows), es un cambio aislado a
 * cómo se calcula `pathRelativo` en el momento de escribir — no a este
 * motor, que ya es agnóstico a la disposición interna de directorios.
 */

import { ConflictoDeEscritura } from "../almacenamiento/escritura.ts";

export function generarId(): string {
  return crypto.randomUUID();
}

export function pathDePage(id: string): string {
  return `${id}.md`;
}

export function pathDeDatabase(id: string): string {
  return `${id}.json`;
}

export function pathDeRow(id: string): string {
  return `${id}.json`;
}

/**
 * Cuántas veces reintentar una creación si `intentar` lanza
 * `ConflictoDeEscritura` (colisión de id contra un archivo que ya existe).
 * Ver comentario de cabecera: con UUIDv4 esto es una red de seguridad, no el
 * mecanismo que hace correcto al esquema — un valor chico alcanza.
 */
const INTENTOS_MAXIMOS_CREACION = 5;

/**
 * Genera un id nuevo y lo pasa a `intentar` (que lo usa para construir y
 * escribir, vía `hashEsperado: null`, el objeto nuevo). Si `intentar` lanza
 * `ConflictoDeEscritura` — el id generado ya estaba en uso — reintenta con
 * un id distinto, hasta `INTENTOS_MAXIMOS_CREACION` veces. Cualquier otro
 * error de `intentar` (por ejemplo, una validación de dominio que rechaza el
 * objeto antes de escribir) se propaga de inmediato, sin reintentar: no
 * tiene sentido reintentar con un id distinto un error que no depende del
 * id.
 */
export async function crearConIdReintentando<T>(intentar: (id: string) => Promise<T>): Promise<T> {
  for (let intento = 1; intento <= INTENTOS_MAXIMOS_CREACION; intento++) {
    const id = generarId();
    try {
      return await intentar(id);
    } catch (error) {
      const esUltimoIntento = intento === INTENTOS_MAXIMOS_CREACION;
      if (error instanceof ConflictoDeEscritura && !esUltimoIntento) continue;
      throw error;
    }
  }
  // Inalcanzable: cada iteración del for devuelve o lanza.
  throw new Error("crearConIdReintentando: estado inalcanzable");
}
