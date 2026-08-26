# Sprint 7 — Planning

**Fecha**: 2026-08-26
**Participantes**: Lucía (PM), Nico (Scrum Master), Marga, Tomás, Efra.

## Contexto

T-0012 ("Implementar sincronización bidireccional") es el único ticket
disponible tras el cierre de sprint 6. La arquitectura elegida en
ADR-001 (archivos como única fuente de verdad, índice siempre
reconstruido desde cero) predice explícitamente que buena parte de la
sync ya queda cubierta por construcción por T-0017/T-0018. Antes de
implementar a ciegas, el sprint arranca con una auditoría honesta de qué
falta realmente, para no reimplementar ni inventar trabajo que ya existe.

## Objetivo del sprint

1. **Auditoría de alcance** (Marga): confirmar contra el código real qué
   de la sync bidireccional ya está cubierto y qué falta — incluyendo si
   el escenario "árbol tocado por git fuera del motor" está probado con
   git real, no solo con los tests unitarios de validación ya existentes.
2. **Implementación acotada a lo que la auditoría identifique** (Tomás),
   con el ciclo implementar → revisar → corregir → confirmación final ya
   ajustado en sprint 6.

## Riesgo conocido

Que el ticket resulte "no falta código de fondo, solo consolidación" es
un resultado válido y esperado, no una señal de que el sprint falló — la
propia ADR-001 lo anticipa. Forzar una implementación artificial para
"justificar" el ticket sería peor que aceptar que la arquitectura ya
resolvió el problema.
