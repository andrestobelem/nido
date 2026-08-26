# Sprint 4 — Retro

**Fecha**: 2026-08-26
**Participantes**: Lucía, Nico, Marga, Tomás, Efra.

## Qué funcionó

- La regla adoptada en la retro de sprint 1 (revisión adversarial antes de
  que otro ticket dependa del código, no en paralelo) se probó por primera
  vez con código real y encontró cuatro hallazgos genuinos antes de que
  T-0010 empezara a construir sobre tipos con bugs. Exactamente el
  escenario que la regla existe para prevenir.
- La segunda revisión no confió en el reporte de la corrección: volvió a
  leer el código y correr los comandos de verificación por su cuenta. Es
  lo que le dio peso real al veredicto final ("listo para hecho"), no una
  formalidad.
- Acotar la profundidad del árbol de filtros de View a nivel de **tipos**
  (no de validación en runtime) es una técnica que vale la pena repetir
  cuando el ADR correspondiente fija un límite estructural — el compilador
  hace de test permanente.

## Qué no funcionó / qué mejorar

- El workflow de este sprint implementó el ciclo implementar→revisar→corregir
  pero no incluyó el paso final de cerrar el ticket con la CLI — a
  diferencia de los workflows de sprint 1 y 2, que sí lo hacían. Hubo que
  cerrarlo a mano después de leer el resultado. Es un error de quien
  diseñó el workflow (Claude, orquestando), no del equipo: la disciplina
  de "todo ticket se cierra explícitamente con la CLI, nunca se asume"
  aplica también a quien escribe los workflows, no solo a los agentes que
  los ejecutan.

## Retro de la metodología misma

- **Qué ritual sobra**: ninguno.
- **Qué falta**: nada nuevo.
- **Qué cambiar para el próximo sprint**: cualquier workflow que cierre un
  ciclo implementar→revisar→corregir tiene que incluir explícitamente el
  paso de mover el ticket a `hecho` (o dejarlo abierto con una razón) como
  parte del propio script, no como un paso manual posterior.

## Estado del backlog al cierre

`hecho`: T-0001 a T-0009 (9). `pendiente`: T-0010 a T-0014 (5), en cadena
estricta (cada uno depende del anterior). T-0010 es el único candidato
para sprint 5.
