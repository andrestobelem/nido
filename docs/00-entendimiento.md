# Entendimiento de la misión

> Este documento resume, en mis propias palabras, qué es nido y qué implica
> construirlo. Es el punto de partida. Se actualiza cuando aprendemos algo que
> lo contradice.

## Qué es nido

Nido es un clon de Notion. La diferencia central es el consumidor: no es una
persona con mouse y teclado, es un agente que ejecuta comandos.

Notion combina tres ideas en un solo producto:

1. **Páginas**: nodos de contenido, organizados en árbol.
2. **Bases de datos**: colecciones de filas. Cada fila es, en el fondo, una
   página con un conjunto fijo de propiedades tipadas.
3. **Vistas**: consultas guardadas sobre una base (filtro, orden, columnas
   visibles).

Nido reconstruye estas tres ideas, pero cambia la interfaz de arriba a abajo.
En vez de una UI visual, la interfaz primaria es una CLI (`nido page create`,
`nido db query`). Cuando la CLI esté estable, se agrega un servidor MCP que
expone las mismas operaciones sin estado, sobre el mismo núcleo de lógica.
CLI y MCP son dos superficies del mismo core: ninguna reimplementa la lógica
de la otra.

## Por qué "para agentes" cambia el diseño

Diseñar para un agente en vez de una persona relaja algunos requisitos y
endurece otros:

- **Se relaja**: no hace falta interfaz gráfica, ni edición colaborativa en
  tiempo real, ni autenticación, ni soporte multiusuario humano. Estos son
  no-objetivos explícitos.
- **Se endurece**: la salida tiene que ser legible por máquina (JSON) además
  de legible por humano. Los comandos tienen que ser deterministas y
  scriptables. Y aunque no hay "usuarios humanos concurrentes", sí puede haber
  **varios agentes operando en paralelo** sobre el mismo contenido. Eso es un
  tipo de concurrencia distinto al que Notion resuelve (cursores en tiempo
  real), pero no es trivial: hace falta decidir qué garantías de atomicidad
  existen cuando dos agentes escriben a la vez.

## El requisito no negociable: sync bidireccional con el repo

La misión pide algo específico y fuerte: todo lo que vive en la base se puede
materializar como archivos en el repo, y toda edición de esos archivos se
puede reflejar de vuelta en la base. No es "exportar a Markdown de vez en
cuando". Es una propiedad estructural del sistema.

Esto condiciona la decisión de persistencia más que cualquier otro
requisito. Una base construida "database-first" (por ejemplo SQLite puro)
necesita un exportador e importador explícitos, con su propio manejo de
conflictos. Una base construida "git-first" (cada cambio es un commit, el
contenido vive como archivos) tiene la sincronización casi gratis, pero puede
complicar la parte de consulta estructurada (filtros, joins de propiedades)
que SQLite resuelve de forma nativa. Esta tensión es exactamente lo que el
ADR de persistencia tiene que resolver.

## Por qué la herramienta de tickets va primero

Antes de tocar el dominio de nido, hay que construir una herramienta de
tickets. La razón no es "vamos a paso a paso", es de dependencia real: la
misión pide un equipo de agentes trabajando con metodología Scrum, y ese
equipo necesita un lugar donde trackear asignaciones, estados, comentarios y
dependencias entre tareas. Si esa herramienta no existe, no hay backlog, no
hay sprint, no hay forma de que un workflow consulte el estado del trabajo.
Es infraestructura del propio proceso, no del producto final.

## Cómo leo la regla de prioridad

"Ante cualquier conflicto, gana lo que acerque a nido a estar usable." La leo
como una regla anti-perfeccionismo: si en algún momento el ritual, la
metodología o una idea interesante compiten con avanzar el producto, el
producto gana. La metodología (Scrum, personas, rituales) es una herramienta
para llegar ahí más rápido y con menos deriva, no un fin en sí misma.

## Criterio de éxito, en concreto

La misión da un criterio verificable: un agente, usando solo la CLI `nido`,
puede crear páginas, crear bases con propiedades tipadas, agregar filas y
consultar vistas filtradas y ordenadas. El contenido sobrevive un ciclo
completo repo → base → repo sin pérdida. La salida es JSON además de texto
legible. Estos cuatro puntos son la definición operativa de "nido usable" y
el punto de referencia para decidir qué es MVP y qué es "después".
