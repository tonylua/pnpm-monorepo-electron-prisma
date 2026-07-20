// node:sqlite driver adapter for Prisma 7 (Rust-free client).
//
// Ports the driver-agnostic conversion/error logic from the official
// @prisma/adapter-better-sqlite3 (v7.8.0) verbatim, and reimplements only the
// thin IO layer on top of Node's built-in node:sqlite (DatabaseSync).
//
// Why node:sqlite: it ships inside Node 22.5+ / Electron 43 (Node 24), so the
// packaged app has ZERO native dependencies to rebuild or locate — no engine
// binary, no better-sqlite3 .node, no asarUnpack path juggling.
//
// Interface implemented: SqlDriverAdapterFactory / SqlDriverAdapter / Transaction
// from @prisma/driver-adapter-utils. See that package's index.d.ts.

const { DatabaseSync } = require('node:sqlite')
const { ColumnTypeEnum, DriverAdapterError } = require('@prisma/driver-adapter-utils')

const debug = (...args) => {
  if (process.env.PRISMA_ADAPTER_DEBUG) console.log('[node-sqlite-adapter]', ...args)
}

// We report the better-sqlite3 adapter name so the Prisma query compiler applies
// the exact same SQLite dialect behavior our ported conversion logic mirrors.
const ADAPTER_NAME = '@prisma/adapter-better-sqlite3'

// ------------------------------------------------
// conversion.ts (ported from @prisma/adapter-better-sqlite3)
// ------------------------------------------------

function mapDeclType(declType) {
  if (declType === null) return null
  switch (declType.toUpperCase()) {
    case '':
      return null
    case 'DECIMAL':
      return ColumnTypeEnum.Numeric
    case 'FLOAT':
      return ColumnTypeEnum.Float
    case 'DOUBLE':
    case 'DOUBLE PRECISION':
    case 'NUMERIC':
    case 'REAL':
      return ColumnTypeEnum.Double
    case 'TINYINT':
    case 'SMALLINT':
    case 'MEDIUMINT':
    case 'INT':
    case 'INTEGER':
    case 'SERIAL':
    case 'INT2':
      return ColumnTypeEnum.Int32
    case 'BIGINT':
    case 'UNSIGNED BIG INT':
    case 'INT8':
      return ColumnTypeEnum.Int64
    case 'DATETIME':
    case 'TIMESTAMP':
      return ColumnTypeEnum.DateTime
    case 'TIME':
      return ColumnTypeEnum.Time
    case 'DATE':
      return ColumnTypeEnum.Date
    case 'TEXT':
    case 'CLOB':
    case 'CHARACTER':
    case 'VARCHAR':
    case 'VARYING CHARACTER':
    case 'NCHAR':
    case 'NATIVE CHARACTER':
    case 'NVARCHAR':
      return ColumnTypeEnum.Text
    case 'BLOB':
      return ColumnTypeEnum.Bytes
    case 'BOOLEAN':
      return ColumnTypeEnum.Boolean
    case 'JSONB':
      return ColumnTypeEnum.Json
    default:
      debug('unknown decltype:', declType)
      return null
  }
}

function mapDeclaredColumnTypes(columnTypes) {
  const emptyIndices = new Set()
  const result = columnTypes.map((typeName, index) => {
    const mappedType = mapDeclType(typeName)
    if (mappedType === null) {
      emptyIndices.add(index)
    }
    return mappedType
  })
  return [result, emptyIndices]
}

function getColumnTypes(declaredTypes, rows) {
  const [columnTypes, emptyIndices] = mapDeclaredColumnTypes(declaredTypes)
  if (emptyIndices.size === 0) {
    return columnTypes
  }
  columnLoop: for (const columnIndex of emptyIndices) {
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const candidateValue = rows[rowIndex][columnIndex]
      if (candidateValue !== null) {
        columnTypes[columnIndex] = inferColumnType(candidateValue)
        continue columnLoop
      }
    }
    columnTypes[columnIndex] = ColumnTypeEnum.Int32
  }
  return columnTypes
}

function inferColumnType(value) {
  switch (typeof value) {
    case 'string':
      return ColumnTypeEnum.Text
    case 'bigint':
      return ColumnTypeEnum.Int64
    case 'boolean':
      return ColumnTypeEnum.Boolean
    case 'number':
      return ColumnTypeEnum.UnknownNumber
    case 'object':
      return inferObjectType(value)
    default:
      throw new UnexpectedTypeError(value)
  }
}

function inferObjectType(value) {
  if (value instanceof ArrayBuffer) {
    return ColumnTypeEnum.Bytes
  }
  // node:sqlite returns BLOBs as Uint8Array (not ArrayBuffer)
  if (value instanceof Uint8Array) {
    return ColumnTypeEnum.Bytes
  }
  throw new UnexpectedTypeError(value)
}

class UnexpectedTypeError extends Error {
  name = 'UnexpectedTypeError'
  constructor(value) {
    const type = typeof value
    const repr = type === 'object' ? JSON.stringify(value) : String(value)
    super(`unexpected value of type ${type}: ${repr}`)
  }
}

function mapRow(row, columnTypes) {
  const result = []
  for (let i = 0; i < row.length; i++) {
    const value = row[i]
    if (
      typeof value === 'number' &&
      (columnTypes[i] === ColumnTypeEnum.Int32 || columnTypes[i] === ColumnTypeEnum.Int64) &&
      !Number.isInteger(value)
    ) {
      result[i] = Math.trunc(value)
      continue
    }
    if (['number', 'bigint'].includes(typeof value) && columnTypes[i] === ColumnTypeEnum.DateTime) {
      result[i] = new Date(Number(value)).toISOString()
      continue
    }
    if (typeof value === 'bigint') {
      const asNumber = Number(value)
      result[i] = Number.isSafeInteger(asNumber) ? asNumber : value.toString()
      continue
    }
    // node:sqlite returns BLOBs as Uint8Array; pass through as-is
    result[i] = value
  }
  return result
}

function mapArg(arg, argType, options) {
  if (arg === null) {
    return null
  }
  if (typeof arg === 'string' && argType.scalarType === 'int') {
    return Number.parseInt(arg)
  }
  if (typeof arg === 'string' && argType.scalarType === 'float') {
    return Number.parseFloat(arg)
  }
  if (typeof arg === 'string' && argType.scalarType === 'decimal') {
    return Number.parseFloat(arg)
  }
  if (typeof arg === 'string' && argType.scalarType === 'bigint') {
    return BigInt(arg)
  }
  if (typeof arg === 'boolean') {
    return arg ? 1 : 0
  }
  if (typeof arg === 'string' && argType.scalarType === 'datetime') {
    arg = new Date(arg)
  }
  if (arg instanceof Date) {
    const format = options?.timestampFormat ?? 'iso8601'
    switch (format) {
      case 'unixepoch-ms':
        return arg.getTime()
      case 'iso8601':
        return arg.toISOString().replace('Z', '+00:00')
      default:
        throw new Error(`Unknown timestamp format: ${format}`)
    }
  }
  if (typeof arg === 'string' && argType.scalarType === 'bytes') {
    return Buffer.from(arg, 'base64')
  }
  return arg
}

// ------------------------------------------------
// errors.ts (ported from @prisma/adapter-better-sqlite3)
// ------------------------------------------------

function convertDriverError(error) {
  if (isDriverError(error)) {
    return {
      originalCode: error.code,
      originalMessage: error.message,
      ...mapDriverError(error)
    }
  }
  throw error
}

// SQLite extended result codes (https://www.sqlite.org/rescode.html).
// node:sqlite reports these as the integer `error.errcode`, unlike
// better-sqlite3 which uses string codes like "SQLITE_CONSTRAINT_UNIQUE".
const SQLITE_BUSY = 5
const SQLITE_BUSY_SNAPSHOT = 517
const SQLITE_CONSTRAINT_UNIQUE = 2067
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555
const SQLITE_CONSTRAINT_NOTNULL = 1299
const SQLITE_CONSTRAINT_FOREIGNKEY = 787
const SQLITE_CONSTRAINT_TRIGGER = 1811

function parseConstraintFields(message) {
  return message
    .split('constraint failed: ')
    .at(1)
    ?.split(', ')
    .map((field) => field.split('.').pop())
}

function mapDriverError(error) {
  // node:sqlite: error.code === 'ERR_SQLITE_ERROR', extended code on error.errcode.
  // better-sqlite3: error.code === 'SQLITE_CONSTRAINT_UNIQUE' etc. Support both by
  // preferring the numeric errcode and falling back to the string code.
  const extended = typeof error.errcode === 'number' ? error.errcode : undefined
  const strCode = typeof error.code === 'string' ? error.code : ''

  if (extended === SQLITE_BUSY || extended === SQLITE_BUSY_SNAPSHOT || strCode === 'SQLITE_BUSY') {
    return { kind: 'SocketTimeout' }
  }
  if (
    extended === SQLITE_CONSTRAINT_UNIQUE ||
    extended === SQLITE_CONSTRAINT_PRIMARYKEY ||
    strCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
    strCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
  ) {
    const fields = parseConstraintFields(error.message)
    return {
      kind: 'UniqueConstraintViolation',
      constraint: fields !== undefined ? { fields } : undefined
    }
  }
  if (extended === SQLITE_CONSTRAINT_NOTNULL || strCode === 'SQLITE_CONSTRAINT_NOTNULL') {
    const fields = parseConstraintFields(error.message)
    return {
      kind: 'NullConstraintViolation',
      constraint: fields !== undefined ? { fields } : undefined
    }
  }
  if (
    extended === SQLITE_CONSTRAINT_FOREIGNKEY ||
    extended === SQLITE_CONSTRAINT_TRIGGER ||
    strCode === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
    strCode === 'SQLITE_CONSTRAINT_TRIGGER'
  ) {
    return {
      kind: 'ForeignKeyConstraintViolation',
      constraint: { foreignKey: {} }
    }
  }
  if (error.message.startsWith('no such table')) {
    return { kind: 'TableDoesNotExist', table: error.message.split(': ').at(1) }
  } else if (error.message.startsWith('no such column')) {
    return { kind: 'ColumnNotFound', column: error.message.split(': ').at(1) }
  } else if (error.message.includes('has no column named ')) {
    return {
      kind: 'ColumnNotFound',
      column: error.message.split('has no column named ').at(1)
    }
  }
  throw error
}

function isDriverError(error) {
  return typeof error.code === 'string' && typeof error.message === 'string'
}

// ------------------------------------------------
// Minimal promise mutex (replaces async-mutex used by the official adapter).
// node:sqlite is fully synchronous, but Prisma's transaction API is async and a
// running transaction must serialize all queries until commit/rollback.
// ------------------------------------------------

class Mutex {
  #locked = false
  #queue = []

  acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.#locked) {
          this.#locked = true
          resolve(() => this.#release())
        } else {
          this.#queue.push(tryAcquire)
        }
      }
      tryAcquire()
    })
  }

  #release() {
    this.#locked = false
    const next = this.#queue.shift()
    if (next) next()
  }
}

// ------------------------------------------------
// IO layer (node:sqlite reimplementation of better-sqlite3.ts)
// ------------------------------------------------

class NodeSqliteQueryable {
  provider = 'sqlite'
  adapterName = ADAPTER_NAME

  constructor(db, adapterOptions) {
    this.db = db
    this.adapterOptions = adapterOptions
  }

  async queryRaw(query) {
    debug('queryRaw', query.sql)
    const { columnNames, declaredTypes, values } = this.performIO(query)
    const rows = values
    const columnTypes = getColumnTypes(declaredTypes, rows)
    return {
      columnNames,
      columnTypes,
      rows: rows.map((row) => mapRow(row, columnTypes))
    }
  }

  async executeRaw(query) {
    debug('executeRaw', query.sql)
    return this.executeIO(query).changes
  }

  executeIO(query) {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions))
      const stmt = this.db.prepare(query.sql)
      const result = stmt.run(...args)
      return { changes: Number(result.changes) }
    } catch (e) {
      this.onError(e)
    }
  }

  performIO(query) {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i], this.adapterOptions))
      const stmt = this.db.prepare(query.sql)
      stmt.setReadBigInts(true)

      // Probe columns() to decide whether this statement returns rows.
      // For non-SELECT statements node:sqlite returns [] (or throws) here.
      let columns
      try {
        columns = stmt.columns()
      } catch {
        columns = []
      }

      if (columns.length === 0) {
        stmt.run(...args)
        return { columnNames: [], declaredTypes: [], values: [] }
      }

      stmt.setReturnArrays(true)
      const values = stmt.all(...args)
      return {
        declaredTypes: columns.map((c) => c.type),
        columnNames: columns.map((c) => c.name),
        values
      }
    } catch (e) {
      this.onError(e)
    }
  }

  onError(error) {
    debug('error', error)
    throw new DriverAdapterError(convertDriverError(error))
  }
}

class NodeSqliteTransaction extends NodeSqliteQueryable {
  constructor(db, options, adapterOptions, unlock) {
    super(db, adapterOptions)
    this.options = options
    this.#unlock = unlock
  }

  #unlock

  commit() {
    debug('commit')
    try {
      this.db.prepare('COMMIT').run()
    } finally {
      this.#unlock()
    }
    return Promise.resolve()
  }

  rollback() {
    debug('rollback')
    try {
      this.db.prepare('ROLLBACK').run()
    } finally {
      this.#unlock()
    }
    return Promise.resolve()
  }

  async createSavepoint(name) {
    await this.executeRaw({ sql: `SAVEPOINT ${name}`, args: [], argTypes: [] })
  }

  async rollbackToSavepoint(name) {
    await this.executeRaw({ sql: `ROLLBACK TO ${name}`, args: [], argTypes: [] })
  }

  async releaseSavepoint(name) {
    await this.executeRaw({ sql: `RELEASE SAVEPOINT ${name}`, args: [], argTypes: [] })
  }
}

class PrismaNodeSqliteAdapter extends NodeSqliteQueryable {
  #mutex = new Mutex()

  executeScript(script) {
    try {
      this.db.exec(script)
    } catch (e) {
      this.onError(e)
    }
    return Promise.resolve()
  }

  async startTransaction(isolationLevel) {
    if (isolationLevel && isolationLevel !== 'SERIALIZABLE') {
      throw new DriverAdapterError({ kind: 'InvalidIsolationLevel', level: isolationLevel })
    }
    const options = { usePhantomQuery: false }
    const unlock = await this.#mutex.acquire()
    try {
      this.db.prepare('BEGIN').run()
      return new NodeSqliteTransaction(this.db, options, this.adapterOptions, unlock)
    } catch (e) {
      unlock()
      this.onError(e)
    }
  }

  dispose() {
    this.db.close()
    return Promise.resolve()
  }
}

// ------------------------------------------------
// Factory (SqlMigrationAwareDriverAdapterFactory)
// ------------------------------------------------

function createDatabase(input) {
  const { url } = input
  const dbPath = url.replace(/^file:/, '')
  const db = new DatabaseSync(dbPath)
  // DELETE mode uses rollback journal for transactions (original SQLite default).
  // busy_timeout makes a contended lock wait-and-retry instead of failing fast
  // with SQLITE_BUSY. Both matter because the migration runner briefly opens a
  // second connection to the same file during startup (see runPrismaCommand.js).
  // :memory: databases don't support journal mode changes, so guard on that.
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = DELETE')
  }
  db.exec('PRAGMA busy_timeout = 5000')
  // Match Prisma's expectations: enforce foreign keys like the Rust engine did.
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

class PrismaNodeSqlite {
  provider = 'sqlite'
  adapterName = ADAPTER_NAME

  constructor(config, options) {
    this.config = config
    this.options = options
  }

  connect() {
    return Promise.resolve(new PrismaNodeSqliteAdapter(createDatabase(this.config), this.options))
  }

  connectToShadowDb() {
    const url = this.options?.shadowDatabaseUrl ?? ':memory:'
    return Promise.resolve(
      new PrismaNodeSqliteAdapter(createDatabase({ ...this.config, url }), this.options)
    )
  }
}

module.exports = { PrismaNodeSqlite }

// Internal conversion/error helpers exposed for unit tests only. Not part of the
// public adapter surface — consumers should use PrismaNodeSqlite via getPrisma.
// Re-exported from @prisma/driver-adapter-utils so tests can assert on the same
// enum the adapter maps to.
module.exports.ColumnTypeEnum = ColumnTypeEnum
module.exports.mapArg = mapArg
module.exports.mapRow = mapRow
module.exports.mapDeclType = mapDeclType
module.exports.getColumnTypes = getColumnTypes
module.exports.inferColumnType = inferColumnType
module.exports.convertDriverError = convertDriverError
module.exports.mapDriverError = mapDriverError
module.exports.parseConstraintFields = parseConstraintFields
