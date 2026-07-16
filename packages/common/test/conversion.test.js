// Unit tests for the value-conversion logic in nodeSqliteAdapter.js.
//
// These mirror the branches of the official @prisma/adapter-better-sqlite3
// conversion.ts (7.8.0), which our adapter ports verbatim. See
// docs/prisma7-adapter-ref/conversion.ts for the reference. If a Prisma upgrade
// changes conversion.ts, these tests pin what our port currently guarantees.

const test = require('node:test')
const assert = require('node:assert/strict')
const fc = require('fast-check')

const {
  mapArg,
  mapRow,
  getColumnTypes,
  ColumnTypeEnum
} = require('../src/utils/prisma/nodeSqliteAdapter')

const argType = (scalarType) => ({ scalarType, arity: 'scalar' })

test('mapArg: null passes through', () => {
  assert.equal(mapArg(null, argType('int')), null)
})

test('mapArg: numeric strings are parsed per scalarType', () => {
  assert.equal(mapArg('42', argType('int')), 42)
  assert.equal(mapArg('3.5', argType('float')), 3.5)
  assert.equal(mapArg('3.5', argType('decimal')), 3.5)
  assert.equal(mapArg('9007199254740993', argType('bigint')), 9007199254740993n)
})

test('mapArg: booleans become 1/0 (SQLite has no native bool)', () => {
  assert.equal(mapArg(true, argType('boolean')), 1)
  assert.equal(mapArg(false, argType('boolean')), 0)
})

test('mapArg: datetime string -> iso8601 with +00:00 offset', () => {
  const out = mapArg('2025-03-30T04:57:45.000Z', argType('datetime'))
  assert.equal(out, '2025-03-30T04:57:45.000+00:00')
})

test('mapArg: Date -> iso8601 by default, unixepoch-ms when configured', () => {
  const d = new Date('2025-03-30T04:57:45.000Z')
  assert.equal(mapArg(d, argType('datetime')), '2025-03-30T04:57:45.000+00:00')
  assert.equal(mapArg(d, argType('datetime'), { timestampFormat: 'unixepoch-ms' }), d.getTime())
})

test('mapArg: unknown timestampFormat throws', () => {
  assert.throws(
    () => mapArg(new Date(), argType('datetime'), { timestampFormat: 'nope' }),
    /Unknown timestamp format/
  )
})

test('mapArg: bytes base64 string -> Buffer that node:sqlite accepts', () => {
  // Regression pin for H1: we deliberately keep Buffer.from here (not
  // Uint8Array/ArrayBuffer). Buffer IS a Uint8Array subclass and binds fine;
  // ArrayBuffer throws when bound. See H1 note in PRISMA7-MIGRATION.md.
  const out = mapArg(Buffer.from([1, 2, 3, 255]).toString('base64'), argType('bytes'))
  assert.ok(out instanceof Uint8Array, 'bytes arg must be a Uint8Array (Buffer)')
  assert.deepEqual([...out], [1, 2, 3, 255])
})

test('mapRow: fractional value coerced to integer for Int columns', () => {
  const row = [3.9]
  assert.deepEqual(mapRow(row, [ColumnTypeEnum.Int32]), [3])
})

test('mapRow: numeric/bigint DateTime decoded to ISO string', () => {
  const ms = Date.UTC(2025, 2, 30, 4, 57, 45)
  assert.deepEqual(mapRow([ms], [ColumnTypeEnum.DateTime]), [new Date(ms).toISOString()])
  assert.deepEqual(mapRow([BigInt(ms)], [ColumnTypeEnum.DateTime]), [new Date(ms).toISOString()])
})

test('mapRow: bigint stays number when safe, becomes string when not', () => {
  const safe = mapRow([123n], [ColumnTypeEnum.Int64])
  assert.equal(safe[0], 123)
  const huge = 9007199254740993n // > Number.MAX_SAFE_INTEGER
  const out = mapRow([huge], [ColumnTypeEnum.Int64])
  assert.equal(out[0], huge.toString())
})

test('mapRow: BLOB (Uint8Array) passes through unchanged', () => {
  const blob = new Uint8Array([9, 8, 7])
  const out = mapRow([blob], [ColumnTypeEnum.Bytes])
  assert.ok(out[0] instanceof Uint8Array)
  assert.deepEqual([...out[0]], [9, 8, 7])
})

test('getColumnTypes: declared types map directly', () => {
  const types = getColumnTypes(['TEXT', 'INTEGER', 'DATETIME'], [])
  assert.deepEqual(types, [ColumnTypeEnum.Text, ColumnTypeEnum.Int32, ColumnTypeEnum.DateTime])
})

test('getColumnTypes: undeclared column inferred from first non-null row', () => {
  // Empty decltype ('') forces inference from row values.
  const types = getColumnTypes([''], [[null], ['hello']])
  assert.equal(types[0], ColumnTypeEnum.Text)
})

test('getColumnTypes: all-null undeclared column falls back to Int32', () => {
  const types = getColumnTypes([''], [[null], [null]])
  assert.equal(types[0], ColumnTypeEnum.Int32)
})

// Property: bytes round-trips through base64 encode -> mapArg -> bytes,
// for arbitrary byte arrays. This is the H1 concern, checked exhaustively.
test('property: bytes survive base64 -> mapArg round-trip', () => {
  fc.assert(
    fc.property(fc.uint8Array(), (bytes) => {
      const b64 = Buffer.from(bytes).toString('base64')
      const out = mapArg(b64, argType('bytes'))
      assert.ok(out instanceof Uint8Array)
      assert.deepEqual([...out], [...bytes])
    })
  )
})
