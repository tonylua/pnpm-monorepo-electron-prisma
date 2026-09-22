/**
 * Prisma v8 SqlMiddleware for SQLite column type normalization.
 *
 * Closes the gap between SQLite's loose type affinity and Prisma's strict
 * codec expectations. Three responsibilities, all at the SQL execution
 * pipeline level (below every caller: v7 shim, model factories, raw client):
 *
 *   1. Write-path coercion (beforeQuery / beforeExecute): v8's text/datetime/
 *      integer codecs are identity functions, so raw JS values flow straight
 *      to node:sqlite, whose strict typing rejects e.g. booleans bound to
 *      TEXT parameters ("Provided value cannot be bound to SQLite parameter
 *      N"). The plan's ParamRef slots carry their column's codecId, so the
 *      coercion here is driven purely by codec — no field-name mapping, no
 *      contract lookup. Runs BEFORE encodeParams, so mutated values are still
 *      rendered through the column codec afterwards (e.g. a Date we produce
 *      for sqlite/datetime@1 is encoded via Date.toISOString() by the codec).
 *
 *   2. Read-path boolean decode (onRow): v8 SQLite has no BOOLEAN column;
 *      the contracts map v7 `Boolean` fields onto textColumn, so booleans are
 *      stored as TEXT 'true'/'false' (v8 writes) or legacy '1'/'0' / 1 / 0
 *      (v7-era rows). Business code compares with `=== true`. The field list
 *      per model comes from bool_fields.json, emitted at build time by
 *      build.mjs from the contract source — adding a Boolean-mapped field
 *      to the contract is picked up automatically on rebuild; nothing here
 *      needs editing. Rows arrive flat, keyed by column name; the model is
 *      resolved from the plan's AST table (table name === model name).
 *
 *   3. Legacy timestamp normalization (onRow): epoch-millis values stored in
 *      TEXT datetime columns (the v5/v6/v7 era wrote
 *      `new Date().getTime().toString()` straight to a TEXT field) are
 *      returned to the codec as ISO-8601 strings. Covers the raw-string form
 *      ('1767225000000'), the REAL-binding artifact ('1767225000000.0' —
 *      node:sqlite binds JS numbers as doubles and TEXT affinity renders
 *      them with a trailing '.0'), and raw number wire values. Without this,
 *      the datetime codec's `new Date(value)` gets a non-ISO string and
 *      throws RUNTIME.DECODE_FAILED. Heuristic: column names matching
 *      /Time$|time$|At$|at$/.
 *
 * v7 did (1) inside PrismaClient and (3) inside the adapter's private
 * mapRow() callback; v8 moved the official driver to node:sqlite, which has
 * no mapRow hook, and exposes the public SqlMiddleware slots instead.
 *
 * Coercion is idempotent: the v7 shim's own payload coercion (to be removed)
 * produces values this middleware leaves untouched, so both layers can
 * coexist during the migration.
 *
 * @type {import('@prisma/orm-family-sql/runtime').SqlMiddleware}
 */

// Boolean-field registry, keyed by table (== model) name. build.mjs
// generates bool_fields.json from the contract source.
import boolFieldsRegistry from '../../generated/db_client/bool_fields.json' with { type: 'json' }
const BOOL_FIELDS_REGISTRY = boolFieldsRegistry

export const sqliteTypeMiddleware = {
  familyId: 'sql',

  /**
   * Coerce WHERE-clause params before encode (SELECT lane).
   * @param {import('@prisma/orm-family-sql/runtime').SqlExecutionPlan} _plan
   * @param {import('@prisma/orm-family-sql/runtime').SqlMiddlewareContext} _ctx
   * @param {import('@prisma/orm-family-sql/relational-core/middleware').SqlParamRefMutator} [params]
   */
  async beforeQuery(_plan, _ctx, params) {
    coerceParams(params)
  },

  /**
   * Coerce INSERT/UPDATE/DELETE params before encode (execute lane).
   * @param {import('@prisma/orm-family-sql/runtime').SqlExecutionPlan} _plan
   * @param {import('@prisma/orm-family-sql/runtime').SqlMiddlewareContext} _ctx
   * @param {import('@prisma/orm-family-sql/relational-core/middleware').SqlParamRefMutator} [params]
   */
  async beforeExecute(_plan, _ctx, params) {
    coerceParams(params)
  },

  /**
   * Decode stored representations back to JS values before codec decoding:
   * TEXT booleans → boolean, legacy millis strings → ISO for datetime codecs.
   * @param {Record<string, unknown>} row
   * @param {import('@prisma/orm-family-sql/runtime').SqlExecutionPlan} plan
   * @param {import('@prisma/orm-family-sql/runtime').SqlMiddlewareContext} _ctx
   */
  async onRow(row, plan, _ctx) {
    const boolFields = boolFieldsForPlan(plan)
    for (const [columnName, value] of Object.entries(row)) {
      let v = normalizeColumnValue(columnName, value)
      if (boolFields && boolFields.has(columnName)) v = toBool(v)
      row[columnName] = v
    }
  }
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

/**
 * @param {import('@prisma/orm-family-sql/relational-core/middleware').SqlParamRefMutator | undefined} params
 */
function coerceParams(params) {
  if (!params) return
  const updates = []
  for (const entry of params.entries()) {
    const coerced = coerceValueForCodec(entry.value, entry.codecId)
    if (coerced !== entry.value) updates.push({ ref: entry.ref, newValue: coerced })
  }
  if (updates.length > 0) params.replaceValues(updates)
}

/**
 * Port of the v7 shim's coerceValue, keyed by the codec id that travels with
 * each ParamRef. Must stay idempotent: values already coerced upstream (shim,
 * schema defaults) pass through unchanged.
 * @param {unknown} value
 * @param {string | undefined} codecId
 */
function coerceValueForCodec(value, codecId) {
  if (value === null || value === undefined) return value
  switch (codecId) {
    case 'sqlite/text@1':
      // SqliteTextCodec.encode is identity; node:sqlite's strict typing
      // rejects booleans/numbers/Dates for TEXT parameters. Stringify them.
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (value instanceof Date) return value.toISOString()
      if (typeof value === 'bigint') return value.toString()
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : value
      return value
    case 'sqlite/datetime@1':
      // SqliteDatetimeCodec.encode calls `value.toISOString()` on the bound
      // value, so it MUST receive a Date instance. Don't pre-stringify.
      // Numbers and legacy millis-as-string only work on the decode path, so
      // coerce them to Date here for the encode path.
      if (value instanceof Date) return value
      if (typeof value === 'number') return new Date(value)
      if (typeof value === 'string' && /^-?\d{10,}$/.test(value)) return new Date(Number(value))
      return value
    case 'sqlite/integer@1':
    case 'sqlite/real@1':
      // Identity codecs. Strict binds expect numbers; coerce strings/booleans.
      if (typeof value === 'boolean') return value ? 1 : 0
      if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
      return value
    case 'sqlite/bigint@1':
    case 'sqlite/bigintnumber@1':
      if (typeof value === 'number') return BigInt(value).toString()
      return value
    default:
      return value
  }
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/**
 * Boolean TEXT fields of the model whose table produced this plan's rows, or
 * undefined when the table can't be resolved / has no boolean columns.
 * @param {import('@prisma/orm-family-sql/runtime').SqlExecutionPlan} plan
 * @returns {Set<string> | undefined}
 */
function boolFieldsForPlan(plan) {
  const tableName = tableNameFromAst(plan && plan.ast)
  if (!tableName) return undefined
  const fields = BOOL_FIELDS_REGISTRY[tableName]
  if (!fields || fields.length === 0) return undefined
  return new Set(fields)
}

/**
 * Table name === model name in both contracts (verified against the emitted
 * contract.json storage entries). SELECT carries its primary source in
 * `from`; INSERT/UPDATE/DELETE in `table`. Raw queries / derived tables /
 * function sources resolve to undefined → no boolean decode.
 * @param {any} ast
 * @returns {string | undefined}
 */
function tableNameFromAst(ast) {
  if (!ast || typeof ast !== 'object') return undefined
  switch (ast.kind) {
    case 'select': {
      const from = ast.from
      return from && from.kind === 'table-source' ? from.name : undefined
    }
    case 'insert':
    case 'update':
    case 'delete':
      return ast.table && ast.table.kind === 'table-source' ? ast.table.name : undefined
    default:
      return undefined
  }
}

/**
 * Value-guarded boolean decode. Handles v8 TEXT ('true'/'false'), v7-era
 * TEXT ('1'/'0'), v7-era INTEGER storage (1/0) — SQLite is dynamically typed
 * per value, so legacy rows in a TEXT column can still read back as numbers —
 * and the REAL-binding artifact ('1.0'/'0.0': this Electron's node:sqlite
 * binds every JS number as a double, and TEXT affinity renders doubles with
 * a trailing '.0'). Anything else (null, arbitrary strings) passes through.
 * @param {unknown} value
 */
function toBool(value) {
  if (value === true || value === 1 || value === 'true' || value === '1' || value === '1.0') return true
  if (value === false || value === 0 || value === 'false' || value === '0' || value === '0.0') {
    return false
  }
  return value
}

function normalizeColumnValue(columnName, value) {
  if (value === null || value === undefined) return value
  if (isTimestampColumn(columnName) && isNumericTimestamp(value)) {
    return new Date(Number(value)).toISOString()
  }
  return value
}

function isTimestampColumn(name) {
  return /Time$|time$|At$|at$/.test(name)
}

/**
 * 13-digit epoch millis as a string (v5–v7 era wrote `getTime().toString()`),
 * the same with the REAL-binding artifact ('1767225000000.0'), or a raw
 * number wire value. Scope stays at 13 digits / ≥1e12 so shorter numeric
 * strings keep their old behavior.
 */
function isNumericTimestamp(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) >= 1e12
  return typeof value === 'string' && /^\d{13}(\.\d+)?$/.test(value)
}
