/**
 * Esquema y población del índice derivado en `bun:sqlite` (T-0018, punto 3
 * del alcance; ADR-001 "índice derivado en bun:sqlite... se reconstruye
 * determinísticamente a partir de los archivos, nunca contiene información
 * que no esté ya en ellos"; forma ilustrativa de ADR-004 sección 2, sección
 * "Dónde sí está el costo real").
 *
 * ## Esquema elegido
 *
 * Tres tablas, forma EAV (entity-attribute-value) con columnas tipadas por
 * clase de almacenamiento — la misma forma que propone ADR-004 (a nivel
 * ilustrativo, con nombres libres), elegida en vez de una tabla ancha por
 * Database con una columna SQL real por Property, por la razón que da ese
 * ADR: una tabla ancha necesita `ALTER TABLE` cada vez que cambia el
 * esquema de una Database, acoplando el índice a cómo se resuelva I9
 * (migración de esquema, todavía abierta). Con la forma EAV, agregar o
 * quitar una Property nunca requiere DDL, solo insertar o borrar filas.
 *
 * - **`nodos`**: un registro por cada Page, Database o Row indexado (los
 *   tres tipos, no solo Row — ver nota más abajo). `tipo` es un valor de
 *   *este índice*, no el `tipo` que declara el archivo en disco: en el
 *   archivo, tanto Page como Database escriben literalmente `"pagina"`
 *   (`docs/01-modelo-dominio.md`: "Database es una Page especial"); acá se
 *   distinguen como `'pagina'` / `'database'` / `'fila'` porque la
 *   resolución de `parent_id` de una Row (checklist ADR-002 sección 5 punto
 *   6) necesita saber cuáles de los nodos "tipo Page" son específicamente
 *   una Database — el resto de este módulo no le interesa la distinción,
 *   pero acá sí importa.
 *
 *   Por qué Page y Database viven en `nodos` aunque `../vistas.ts` nunca
 *   los consulte (una View siempre filtra `tipo = 'fila'`): el punto 3 del
 *   alcance de T-0018 pide "tablas que representen los nodos" (plural, los
 *   tres tipos) y no solo las Rows — este índice es la representación
 *   consultable de *todo* el árbol, del cual resolver Views es un consumidor
 *   entre otros posibles (por ejemplo, un futuro "listar hijos de X" no
 *   necesitaría releer el filesystem). No cuesta nada extra: no hay
 *   `PropertyValue` que indexar para Page/Database, así que insertarlos es
 *   una sola fila por nodo en esta tabla y nada más.
 *
 * - **`valores_escalares`** (`row_id, property_id` como clave): un registro
 *   por cada `PropertyValue` de tipo escalar de una Row (`texto`, `agente`,
 *   `select` guardando el id de la opción, `fecha` guardando el string
 *   `YYYY-MM-DD` tal cual sin parsear — ADR-002 ya lo deja opaco — y
 *   `numero`), con una columna por clase de almacenamiento real
 *   (`valor_texto`/`valor_numero`/`valor_bool`) en vez de una columna
 *   `valor` polimórfica: así el traductor de `../vistas.ts` puede comparar
 *   (`>`, `<`, etc.) con el operador nativo de SQLite sobre el tipo
 *   correcto, sin coacciones de tipo implícitas de SQLite entre columnas.
 *
 * - **`valores_multi`** (`row_id, property_id, opcion_id` como clave): un
 *   registro por cada elemento de un `PropertyValue` de tipo `multi_select`
 *   — la forma "un elemento, una fila" es la que permite que `contiene`/
 *   `contiene_alguno_de`/`contiene_todos_de` se traduzcan como
 *   `EXISTS`/`NOT EXISTS` (ver `../vistas.ts`) sin tener que decodificar un
 *   array serializado dentro de SQL.
 *
 * Los `PropertyValue` huérfanos (ADR-006: `property_id` que ya no existe en
 * el esquema actual de la Database) nunca llegan a este módulo: ya se
 * filtraron en `./construccion.ts` (que los reporta como advertencia, sin
 * rechazar la Row) antes de llamar a `poblarBaseIndice` — este módulo no
 * los vuelve a chequear.
 */

import { Database as BaseSqlite } from "bun:sqlite";
import type { Database, Page, Row } from "../types.ts";
import type { NodoIndexado } from "./tipos.ts";

export function crearBaseIndice(): BaseSqlite {
  const db = new BaseSqlite(":memory:");
  db.exec(`
    CREATE TABLE nodos (
      id TEXT PRIMARY KEY,
      tipo TEXT NOT NULL,
      parent_id TEXT,
      titulo TEXT NOT NULL,
      creado_en TEXT NOT NULL,
      actualizado_en TEXT NOT NULL,
      path TEXT NOT NULL
    );
    CREATE INDEX idx_nodos_parent_id ON nodos(parent_id);
    CREATE INDEX idx_nodos_tipo_parent_id ON nodos(tipo, parent_id);

    CREATE TABLE valores_escalares (
      row_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      valor_texto TEXT,
      valor_numero REAL,
      valor_bool INTEGER,
      PRIMARY KEY (row_id, property_id)
    );
    CREATE INDEX idx_valesc_prop_texto ON valores_escalares(property_id, valor_texto);
    CREATE INDEX idx_valesc_prop_numero ON valores_escalares(property_id, valor_numero);

    CREATE TABLE valores_multi (
      row_id TEXT NOT NULL,
      property_id TEXT NOT NULL,
      opcion_id TEXT NOT NULL,
      PRIMARY KEY (row_id, property_id, opcion_id)
    );
    CREATE INDEX idx_valmulti_prop_opcion ON valores_multi(property_id, opcion_id);
  `);
  return db;
}

export interface DatosParaPoblar {
  paginas: Map<string, NodoIndexado<Page>>;
  databases: Map<string, NodoIndexado<Database>>;
  filas: Map<string, NodoIndexado<Row>>;
}

/**
 * Inserta todos los nodos ya validados de `datos` en `db` (creada por
 * `crearBaseIndice`), dentro de una única transacción. Asume que `datos` ya
 * pasó el checklist completo de ADR-002 sección 5 (esto lo garantiza
 * `./construccion.ts`, que es el único llamador real): en particular, cada
 * Row de `datos.filas` tiene un `parentId` que resuelve a una entrada de
 * `datos.databases`, y cada `PropertyValue` no huérfano de esa Row
 * referencia una Property real del esquema de esa Database.
 */
export function poblarBaseIndice(db: BaseSqlite, datos: DatosParaPoblar): void {
  const insertarNodo = db.prepare(
    "INSERT INTO nodos (id, tipo, parent_id, titulo, creado_en, actualizado_en, path) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const insertarEscalar = db.prepare(
    "INSERT INTO valores_escalares (row_id, property_id, valor_texto, valor_numero, valor_bool) VALUES (?, ?, ?, ?, ?)",
  );
  const insertarMulti = db.prepare("INSERT INTO valores_multi (row_id, property_id, opcion_id) VALUES (?, ?, ?)");

  const poblar = db.transaction(() => {
    for (const { valor, path } of datos.paginas.values()) {
      insertarNodo.run(valor.id, "pagina", valor.parentId, valor.titulo, valor.creadoEn, valor.actualizadoEn, path);
    }

    for (const { valor, path } of datos.databases.values()) {
      insertarNodo.run(valor.id, "database", valor.parentId, valor.titulo, valor.creadoEn, valor.actualizadoEn, path);
    }

    for (const { valor: fila, path } of datos.filas.values()) {
      insertarNodo.run(fila.id, "fila", fila.parentId, fila.titulo, fila.creadoEn, fila.actualizadoEn, path);

      const database = datos.databases.get(fila.parentId);
      if (!database) continue; // defensivo: no debería pasar, ver el comentario de la función
      const propiedadesPorId = new Map(database.valor.propiedades.map((propiedad) => [propiedad.id, propiedad]));

      for (const propertyValue of fila.valores) {
        const propiedad = propiedadesPorId.get(propertyValue.propertyId);
        if (!propiedad) continue; // PropertyValue huérfano (ADR-006) — ya reportado como advertencia en construccion.ts, no se indexa

        if (propiedad.tipo === "multi_select") {
          for (const opcionId of propertyValue.valor as string[]) {
            insertarMulti.run(fila.id, propertyValue.propertyId, opcionId);
          }
          continue;
        }

        const valorTexto =
          propiedad.tipo === "texto" || propiedad.tipo === "agente" || propiedad.tipo === "select" || propiedad.tipo === "fecha"
            ? (propertyValue.valor as string)
            : null;
        const valorNumero = propiedad.tipo === "numero" ? (propertyValue.valor as number) : null;
        const valorBool = propiedad.tipo === "checkbox" ? ((propertyValue.valor as boolean) ? 1 : 0) : null;

        insertarEscalar.run(fila.id, propertyValue.propertyId, valorTexto, valorNumero, valorBool);
      }
    }
  });

  poblar();
}
