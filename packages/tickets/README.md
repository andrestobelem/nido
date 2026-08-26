# @nido/tickets

Herramienta de tickets para coordinar al equipo de agentes de nido. Es
infraestructura de proceso, no del producto nido: su modelo de storage es
independiente del que se elija para nido en el ADR de persistencia (ver
`docs/adr/` en la raíz del repo). Migrar el backlog al propio nido, una vez
que exista, es trabajo futuro declarado como tal.

## Almacenamiento

Cada ticket es un archivo JSON en `docs/tickets/T-NNNN.json` (cuatro dígitos
como mínimo, no como máximo: pasado el ticket 9999 el id crece a más
dígitos), en el directorio que indique la variable de entorno
`NIDO_TICKETS_DIR` o `docs/tickets` por defecto.

Toda escritura (`create`, `assign`, `move`, `comment`, `link`) se serializa
con un lock exclusivo (`docs/tickets/.lock`) y se guarda con escritura
atómica (archivo temporal + rename). Dos o más agentes pueden ejecutar
estos comandos en paralelo sobre el mismo ticket sin perder escrituras ni
crear un ciclo de dependencias a pesar de la validación — es la garantía
mínima que este tipo de herramienta necesita para que un equipo de agentes
confíe en ella. No hay locking distribuido entre máquinas: el lock es un
archivo local, pensado para procesos concurrentes en el mismo filesystem.

## Comandos

Salida humana por defecto; agregar `--json` a cualquier comando para salida
legible por máquina.

```bash
tickets create --titulo "Título" [--descripcion "..."] [--depende-de T-0001,T-0002]
tickets assign <id> <agente>
tickets move <id> <pendiente|en_progreso|bloqueado|en_revision|hecho>
tickets comment <id> --autor <agente> --texto "..."
tickets link <id> --depende-de <otroId>
tickets show <id>
tickets list [--estado <estado>] [--asignado-a <agente>]
```

`move` rechaza pasar a cualquier estado que no sea `pendiente` o
`bloqueado` si el ticket todavía depende de otro que no está `hecho`.
`link` rechaza dependencias circulares y auto-dependencias.

## Desarrollo

```bash
bun install
bun test
```
