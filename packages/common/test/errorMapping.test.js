// Tests for driver-error mapping in nodeSqliteAdapter.js.
//
// This is the biggest divergence from the official better-sqlite3 adapter:
// node:sqlite reports the extended result code as the integer `error.errcode`
// (error.code is always 'ERR_SQLITE_ERROR'), whereas better-sqlite3 uses string
// codes like 'SQLITE_CONSTRAINT_UNIQUE'. We drive REAL node:sqlite here so the
// error objects are exactly what production sees — no hand-built fakes.

const test = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')

const { convertDriverError } = require('../src/utils/prisma/nodeSqliteAdapter')

// Capture the real error node:sqlite throws for a given setup+offending action.
function catchSqliteError(setupSql, offending) {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec(setupSql)
    offending(db)
    throw new Error('expected the offending statement to throw')
  } catch (e) {
    if (e.code === undefined && e.errcode === undefined) throw e
    return e
  } finally {
    db.close()
  }
}

test('UNIQUE violation -> UniqueConstraintViolation with field', () => {
  const err = catchSqliteError(
    'CREATE TABLE t (id INTEGER PRIMARY KEY, email TEXT UNIQUE); INSERT INTO t VALUES (1, \'a@b.c\');',
    (db) => db.prepare('INSERT INTO t VALUES (2, ?)').run('a@b.c')
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'UniqueConstraintViolation')
  assert.deepEqual(mapped.constraint, { fields: ['email'] })
})

test('PRIMARY KEY violation -> UniqueConstraintViolation', () => {
  const err = catchSqliteError(
    'CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);',
    (db) => db.prepare('INSERT INTO t VALUES (?)').run(1)
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'UniqueConstraintViolation')
})

test('NOT NULL violation -> NullConstraintViolation with field', () => {
  const err = catchSqliteError(
    'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL);',
    (db) => db.prepare('INSERT INTO t (id, name) VALUES (1, ?)').run(null)
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'NullConstraintViolation')
  assert.deepEqual(mapped.constraint, { fields: ['name'] })
})

test('FOREIGN KEY violation -> ForeignKeyConstraintViolation', () => {
  const err = catchSqliteError(
    'CREATE TABLE parent (id INTEGER PRIMARY KEY);' +
      'CREATE TABLE child (id INTEGER PRIMARY KEY, pid INTEGER REFERENCES parent(id));',
    (db) => db.prepare('INSERT INTO child VALUES (1, ?)').run(999)
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'ForeignKeyConstraintViolation')
  assert.deepEqual(mapped.constraint, { foreignKey: {} })
})

test('no such table -> TableDoesNotExist', () => {
  const err = catchSqliteError('CREATE TABLE t (id INTEGER);', (db) =>
    db.prepare('SELECT * FROM nonexistent').all()
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'TableDoesNotExist')
  assert.equal(mapped.table, 'nonexistent')
})

test('no such column -> ColumnNotFound', () => {
  const err = catchSqliteError('CREATE TABLE t (id INTEGER);', (db) =>
    db.prepare('SELECT nope FROM t').all()
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'ColumnNotFound')
})

test('has no column named -> ColumnNotFound', () => {
  const err = catchSqliteError('CREATE TABLE t (id INTEGER);', (db) =>
    db.prepare('INSERT INTO t (nope) VALUES (1)').run()
  )
  const mapped = convertDriverError(err)
  assert.equal(mapped.kind, 'ColumnNotFound')
  assert.equal(mapped.column, 'nope')
})

test('convertDriverError rethrows non-driver errors untouched', () => {
  const plain = new Error('not a driver error')
  assert.throws(() => convertDriverError(plain), /not a driver error/)
})

test('convertDriverError preserves originalCode/originalMessage', () => {
  const err = catchSqliteError(
    'CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);',
    (db) => db.prepare('INSERT INTO t VALUES (?)').run(1)
  )
  const mapped = convertDriverError(err)
  assert.equal(typeof mapped.originalMessage, 'string')
  assert.ok(mapped.originalMessage.length > 0)
})
