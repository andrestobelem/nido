# ADR-000: Formato mínimo de ADR

- **Estado**: aceptado
- **Fecha**: 2026-08-26

## Contexto

La misión pide que toda decisión de arquitectura quede en `docs/adr/`,
incluso las que después se revierten. Hacía falta un formato mínimo antes
de escribir el primer ADR de fondo (persistencia).

## Decisión

Cada ADR es un archivo `docs/adr/NNN-titulo-corto.md`, numerado
secuencialmente, con estas secciones:

- **Estado**: `propuesto`, `aceptado`, `revertido` o `reemplazado por
  ADR-NNN`.
- **Fecha**
- **Contexto**: qué problema fuerza la decisión, en un párrafo.
- **Decisión**: qué se decide, en voz activa, sin rodeos.
- **Alternativas consideradas**: lista breve, con la razón concreta de por
  qué se descartó cada una (no basta "no la elegimos").
- **Consecuencias**: qué queda más fácil y qué queda más difícil por esta
  decisión. Incluye riesgos aceptados explícitamente.

Un ADR se aprueba escribiéndolo con estado `aceptado`. No requiere una
aprobación separada de otro agente: la revisión adversarial (ver
`docs/sprints/00-revision-plan.md` para un ejemplo del mecanismo) es la
instancia de control de calidad antes de aceptar una decisión de peso
mayor. Un ADR de decisión menor (la clase que sale de "un workflow chico
con juez") no necesita esa revisión adicional: alcanza con el ADR mismo.

## Alternativas consideradas

- **Sin plantilla, texto libre**: se descartó porque dificulta comparar
  ADRs entre sí y encontrar la sección de "qué se descartó" rápido.
- **Requerir aprobación explícita de otro agente antes de `aceptado`**: se
  descartó para no bloquear decisiones menores con un paso ceremonial.
  Decisiones de peso mayor ya pasan por revisión adversarial antes de
  llegar al ADR.

## Consecuencias

Escribir un ADR es rápido (una plantilla corta, sin aprobación externa
obligatoria). El costo es que la calidad de una decisión de peso mayor
depende de que efectivamente se use la revisión adversarial antes de
aceptarla, no de un gate impuesto por el formato del ADR.
