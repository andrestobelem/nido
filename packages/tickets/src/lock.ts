import { open, rm, stat, type FileHandle } from "node:fs/promises";

const ESPERA_MS = 15;
const INTENTOS_MAXIMOS = 400;
const LOCK_VIEJO_MS = 30_000;

export class LockNoDisponible extends Error {
  constructor(path: string) {
    super(`no se pudo adquirir el lock ${path} tras ${INTENTOS_MAXIMOS} intentos`);
  }
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function liberarSiEsViejo(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (Date.now() - info.mtimeMs > LOCK_VIEJO_MS) {
      await rm(path, { force: true });
    }
  } catch {
    // el lock pudo haberse liberado entre el intento fallido y este stat
  }
}

async function adquirir(path: string): Promise<FileHandle> {
  for (let intento = 0; intento < INTENTOS_MAXIMOS; intento++) {
    try {
      return await open(path, "wx");
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
      await liberarSiEsViejo(path);
      await esperar(ESPERA_MS);
    }
  }
  throw new LockNoDisponible(path);
}

/**
 * Exclusión mutua entre procesos vía un archivo de lock creado en modo
 * exclusivo. Si el lock queda huérfano más de LOCK_VIEJO_MS (un proceso que
 * murió sin liberarlo), el siguiente intento lo considera abandonado y lo
 * limpia antes de reintentar.
 */
export async function conLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const handle = await adquirir(path);
  try {
    return await fn();
  } finally {
    await handle.close();
    await rm(path, { force: true });
  }
}
