export type Estado =
  | "pendiente"
  | "en_progreso"
  | "bloqueado"
  | "en_revision"
  | "hecho";

export const ESTADOS: readonly Estado[] = [
  "pendiente",
  "en_progreso",
  "bloqueado",
  "en_revision",
  "hecho",
];

export function esEstado(valor: string): valor is Estado {
  return (ESTADOS as readonly string[]).includes(valor);
}

const PATRON_ID = /^T-\d{4,}$/;

export function esIdValido(valor: string): boolean {
  return PATRON_ID.test(valor);
}

export interface Comentario {
  autor: string;
  texto: string;
  fecha: string;
}

export interface Ticket {
  id: string;
  titulo: string;
  descripcion: string;
  estado: Estado;
  asignadoA: string | null;
  dependeDe: string[];
  comentarios: Comentario[];
  creadoEn: string;
  actualizadoEn: string;
}
