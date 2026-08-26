# Sprint 5 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- Dividir T-0010 en capas por dependencia real (formato → escritura →
  índice → CRUD) en vez de forzarlo como un ticket único permitió que cada
  capa tuviera su propio ciclo de revisión enfocado. Un ticket de "todo el
  core" habría diluido cada revisión entre demasiadas preocupaciones a la
  vez.
- La revisión insistió en reproducir con inputs concretos y correr los
  comandos de verificación ella misma en cada ronda, nunca confiar en el
  reporte de quien implementó. Eso es lo que encontró el bug crítico de
  concurrencia en T-0017 (que un test puramente secuencial no detectaba)
  y la cadena de tres hallazgos en T-0019.
- En el cierre de T-0019, el agente notó que su primer borrador de
  comentario incluía un número inventado ("hicieron falta 3 intentos") sin
  evidencia real, y se auto-corrigió con un comentario de retractación en
  vez de dejarlo pasar. Vale la pena que esta disciplina de "nunca
  reportar un dato que no se pudo verificar" se mantenga como estándar,
  no como excepción.

## Qué no funcionó / qué mejorar

- **Hallazgo de proceso real, no menor**: el ciclo implementar→revisar→corregir
  de T-0019 tenía un tope de 3 rondas de revisión. La tercera ronda
  encontró un hallazgo nuevo y bloqueante; se corrigió, pero el ciclo se
  agotó ahí — el ticket se cerró sin una cuarta revisión independiente que
  confirmara el fix. Quien orquestó el workflow (Claude) verificó el fix a
  mano antes de confiar en el cierre (leyó el diff, corrió tests/tsc), pero
  eso no debería depender de un paso manual fuera del propio workflow.
  **Cambio de proceso para sprint 6 en adelante**: cuando la última ronda
  permitida de revisión encuentra un hallazgo y se corrige, el workflow
  tiene que agregar una ronda de confirmación adicional (no contar esa
  como parte del tope), no cerrar el ticket directamente después de
  "corregir" sin una revisión que diga explícitamente "listo para hecho"
  sobre el estado final.
- El workflow de T-0015/T-0016 en paralelo tuvo un bug de orquestación (no
  de código de nido): faltó un `await` antes de lanzar las dos capas en
  paralelo, así que la primera corrida no ejecutó ningún agente real. Se
  detectó porque `agents_done: 0` no cuadraba con `agent_count: 2`, se
  corrigió el script y se relanzó. Ningún impacto en el código de nido,
  pero es la segunda vez en el proyecto que un defecto de la orquestación
  misma (no del equipo) retrasa un ciclo — la primera fue el workflow de
  T-0009 que no cerraba el ticket automáticamente (retro de sprint 4).

## Retro de la metodología misma

- **Qué ritual sobra**: ninguno.
- **Qué falta**: una plantilla de workflow de implementar→revisar→corregir
  que ya incluya, por default: (a) el paso de cierre de ticket vía CLI
  (lección de sprint 4), y (b) una ronda de confirmación después de la
  última corrección permitida, no un cierre automático tras agotar el
  tope (lección de este sprint). Repetir el mismo error de plantilla dos
  sprints seguidos, aunque en partes distintas del ciclo, es la señal de
  que hace falta fijarlo en un solo lugar reusable, no volver a escribirlo
  a mano cada vez.
- **Qué cambiar para el próximo sprint**: aplicar los dos ajustes de
  plantilla arriba antes de lanzar el workflow de T-0011.

## Estado del backlog al cierre

`hecho`: T-0001 a T-0010, T-0015 a T-0019 (15 de 19 tickets totales, si se
cuenta T-0010 junto con sus 5 sub-tickets). `pendiente`: T-0011, T-0012,
T-0013, T-0014 — cadena estricta secuencial. T-0011 (gate de aceptación de
round-trip) es el único candidato para sprint 6.
