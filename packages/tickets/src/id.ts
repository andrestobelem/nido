import { open, readdir } from "node:fs/promises";

const PREFIJO = "T-";
const DIGITOS = 4;
const INTENTOS_MAXIMOS = 50;

function formatearId(numero: number): string {
  return `${PREFIJO}${String(numero).padStart(DIGITOS, "0")}`;
}

async function proximoNumeroCandidato(dir: string): Promise<number> {
  let entradas: string[];
  try {
    entradas = await readdir(dir);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return 1;
    throw error;
  }
  let maximo = 0;
  const patron = new RegExp(`^${PREFIJO}(\\d+)\\.json$`);
  for (const nombre of entradas) {
    const coincidencia = patron.exec(nombre);
    if (!coincidencia) continue;
    const numero = Number(coincidencia[1]);
    // un nombre de archivo corrupto o manipulado a mano podría desbordar
    // Number (Infinity); se ignora en vez de propagar un id inválido.
    if (Number.isFinite(numero)) maximo = Math.max(maximo, numero);
  }
  return maximo + 1;
}

/**
 * Reserva el próximo id disponible creando su archivo de forma exclusiva
 * (`wx`). Si dos llamadas concurrentes compiten por el mismo número, la que
 * pierde recibe EEXIST y vuelve a calcular el candidato desde el listado
 * actual del directorio, hasta encontrar uno libre.
 */
export async function reservarProximoId(
  dir: string,
): Promise<{ id: string; path: string }> {
  for (let intento = 0; intento < INTENTOS_MAXIMOS; intento++) {
    const numero = await proximoNumeroCandidato(dir);
    const id = formatearId(numero);
    const path = `${dir}/${id}.json`;
    try {
      const handle = await open(path, "wx");
      await handle.close();
      return { id, path };
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(
    `no se pudo reservar un id de ticket tras ${INTENTOS_MAXIMOS} intentos`,
  );
}
