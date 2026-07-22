import { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderDefault(value: unknown): string {
  if (value instanceof SQL) return dialect.sqlToQuery(value).sql;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  throw new Error(`schema-ddl: unsupported column default ${JSON.stringify(value)}`);
}

/**
 * Emit CREATE TABLE + index DDL for a drizzle `pgTable`, reading the same table
 * object the adapter queries so the pg-contract test's schema cannot drift from
 * `src/device-state/schema.ts`. Models only the column/index features that table
 * actually uses (text/jsonb/timestamptz/boolean, PRIMARY KEY, NOT NULL, literal
 * and `sql` defaults, unique/plain single-column indexes) and throws on anything
 * it doesn't understand, so a schema change the generator can't express fails
 * loudly instead of silently producing wrong DDL.
 */
export function ddlForTable(table: PgTable, schemaName: string): string {
  const cfg = getTableConfig(table);
  const qualified = `${quoteIdent(schemaName)}.${quoteIdent(cfg.name)}`;

  const columns = cfg.columns.map((c) => {
    const parts = [quoteIdent(c.name), c.getSQLType()];
    if (c.primary) parts.push("PRIMARY KEY");
    else if (c.notNull) parts.push("NOT NULL");
    if (c.hasDefault && c.default !== undefined) parts.push(`DEFAULT ${renderDefault(c.default)}`);
    return `  ${parts.join(" ")}`;
  });

  const statements = [`CREATE TABLE ${qualified} (\n${columns.join(",\n")}\n);`];

  for (const idx of cfg.indexes) {
    const { name, unique, columns: idxColumns } = idx.config;
    if (!name) throw new Error("schema-ddl: unnamed indexes are not supported");
    const cols = idxColumns
      .map((col) => {
        const columnName = (col as { name?: unknown }).name;
        if (typeof columnName !== "string") {
          throw new Error(`schema-ddl: expression index columns are not supported (${name})`);
        }
        return quoteIdent(columnName);
      })
      .join(", ");
    statements.push(
      `CREATE ${unique ? "UNIQUE " : ""}INDEX ${quoteIdent(name)} ON ${qualified} (${cols});`,
    );
  }

  return statements.join("\n");
}
