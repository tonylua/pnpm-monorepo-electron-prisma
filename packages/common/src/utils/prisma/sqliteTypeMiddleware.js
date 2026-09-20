/**
 * Prisma v8 SqlMiddleware for SQLite column type normalization.
 *
 * Handles discrepancies between SQLite's loose type affinity and Prisma's strict codec expectations:
 * - Datetime: Converts legacy numeric millisecond strings to ISO-8601 format
 * - Future: Boolean normalization (1/0 → true/false), JSON string parsing, etc.
 *
 * Architecture:
 * - onRow: Normalizes raw driver output before codec decoding (read path)
 * - beforeQuery/beforeExecute: Could normalize user inputs before codec encoding (write path, if needed)
 *
 * Lifecycle: driver query → onRow (HERE) → codec decode → user receives typed values
 *
 * @type {import('@prisma/orm-family-sql/runtime').SqlMiddleware}
 */
export const sqliteTypeMiddleware = {
  familyId: 'sql',

  /**
   * Normalize row values before codec decoding.
   * @param {Record<string, unknown>} row - Raw SQLite driver output
   * @param {import('@prisma/orm-family-sql/runtime').SqlExecutionPlan} plan
   * @param {import('@prisma/orm-family-sql/runtime').SqlMiddlewareContext} ctx
   */
  async onRow(row, plan, ctx) {
    for (const [columnName, value] of Object.entries(row)) {
      row[columnName] = normalizeColumnValue(columnName, value);
    }
  }
};

/**
 * Normalize a single column value based on heuristics.
 * Extend this switch as new type mismatches are discovered.
 */
function normalizeColumnValue(columnName, value) {
  if (value === null || value === undefined) {
    return value;
  }

  // Datetime normalization: numeric millisecond strings → ISO-8601
  if (isTimestampColumn(columnName) && isNumericTimestamp(value)) {
    return new Date(Number(value)).toISOString();
  }

  // Future: Boolean normalization
  // if (isBooleanColumn(columnName) && typeof value === 'number') {
  //   return value !== 0;
  // }

  // Future: JSON normalization
  // if (isJsonColumn(columnName) && typeof value === 'string') {
  //   try { return JSON.parse(value); } catch {}
  // }

  return value;
}

/**
 * Heuristic: column names ending with Time/time/At/at are likely datetime fields
 */
function isTimestampColumn(name) {
  return /Time$|time$|At$|at$/.test(name);
}

/**
 * Check if value is a 13-digit numeric string (millisecond timestamp)
 */
function isNumericTimestamp(value) {
  return typeof value === 'string' && /^\d{13}$/.test(value);
}

