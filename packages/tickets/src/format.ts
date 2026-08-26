import type { Ticket } from "./types.ts";

export function formatearTicket(ticket: Ticket): string {
  const lineas = [
    `${ticket.id}  [${ticket.estado}]  ${ticket.titulo}`,
    `  asignado a: ${ticket.asignadoA ?? "(sin asignar)"}`,
  ];
  if (ticket.dependeDe.length > 0) {
    lineas.push(`  depende de: ${ticket.dependeDe.join(", ")}`);
  }
  if (ticket.descripcion) {
    lineas.push(`  descripción: ${ticket.descripcion}`);
  }
  if (ticket.comentarios.length > 0) {
    lineas.push("  comentarios:");
    for (const comentario of ticket.comentarios) {
      lineas.push(`    - [${comentario.fecha}] ${comentario.autor}: ${comentario.texto}`);
    }
  }
  return lineas.join("\n");
}

export function formatearLista(tickets: Ticket[]): string {
  if (tickets.length === 0) return "(sin tickets)";
  return tickets
    .map((t) => `${t.id}  [${t.estado}]  ${t.titulo}${t.asignadoA ? `  (${t.asignadoA})` : ""}`)
    .join("\n");
}
