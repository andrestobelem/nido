/**
 * Resolución de la raíz del workspace de nido (T-0013). El core
 * (`docs/adr/005-core-compartido-cli-mcp.md` sección 2) recibe la raíz como
 * parámetro explícito en cada llamada y nunca la resuelve por su cuenta —
 * "quién resuelve esa raíz a partir de NIDO_WORKSPACE_DIR, un flag de CLI, o
 * la configuración de arranque del servidor MCP es decisión de cada
 * superficie, no del core". Este módulo es esa decisión para la CLI, mismo
 * patrón que `dirTickets()` en `packages/tickets/src/cli.ts`
 * (`NIDO_TICKETS_DIR`, default `docs/tickets`).
 */

import { mkdir } from "node:fs/promises";

export function raizWorkspace(): string {
  return process.env.NIDO_WORKSPACE_DIR ?? "./nido-workspace";
}

/**
 * El core asume que la raíz ya existe (`resolverPathConfinado` lanza
 * `RaizDeWorkspaceInvalida` si no) — crearla no es una decisión de dominio
 * ("Workspace... v1 es singleton, no hay crear", ADR-005), es la misma
 * conveniencia de filesystem que ya hace `packages/tickets/src/store.ts`
 * (`crearStore`: `mkdir(dir, { recursive: true })`) antes de operar.
 */
export async function asegurarWorkspace(raiz: string): Promise<void> {
  await mkdir(raiz, { recursive: true });
}
