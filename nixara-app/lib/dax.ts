/**
 * DAX identifier quoting.
 *
 * Kept out of the route file so it is unit-testable (Next.js App Router route
 * modules may only export HTTP handlers and route config).
 */

/**
 * Escapes a table name for use as a DAX quoted identifier.
 *
 * In DAX a table name is wrapped in single quotes and a literal single quote
 * inside it is escaped by doubling. This is defence in depth: callers must
 * still match the name against the dataset's real table list first (see
 * /api/connect/powerbi), because quoting alone cannot tell an allowed table
 * from one the user was never offered.
 *
 * It also fixes a plain bug — before this, `EVALUATE ${tableName}` was emitted
 * unquoted, so any table whose name contained a space failed to load at all.
 */
export function toDaxIdentifier(tableName: string): string {
  return `'${tableName.replace(/'/g, "''")}'`;
}
