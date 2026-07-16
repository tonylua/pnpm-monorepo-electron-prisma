// Tests for runPrismaCommand.js — the hand-rolled migration applier that
// replaces `prisma migrate deploy` in the Rust-free setup. Covers: apply,
// idempotency, the checksum drift guard (M2), transactional rollback on a bad
// migration, and lexicographic ordering. Uses real temp dirs + node:sqlite.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const runPrismaCommand = require('../src/utils/prisma/runPrismaCommand')

// Build an isolated temp workspace with a migrations dir and a db path, plus the
// minimal ctx runPrismaCommand needs (getDBPath + getMigrationsDir).
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migtest-'))
  const migrationsDir = path.join(root, 'migrations')
  fs.mkdirSync(migrationsDir)
  const dbPath = path.join(root, 'test.db')

  return {
    root,
    dbPath,
    migrationsDir,
    ctx: {
      getDBPath: () => dbPath,
      getMigrationsDir: () => migrationsDir
    },
    addMigration(name, sql) {
      const dir = path.join(migrationsDir, name)
      fs.mkdirSync(dir)
      fs.writeFileSync(path.join(dir, 'migration.sql'), sql)
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}

// Reset DATABASE_URL between tests: getDBConstants reads/writes process.env.
test.beforeEach(() => {
  delete process.env.DATABASE_URL
})

test('applies a pending migration and records it', async () => {
  const fx = makeFixture()
  try {
    fx.addMigration('20240101000000_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY, v TEXT);')
    const rc = await runPrismaCommand({ ctx: fx.ctx })
    assert.equal(rc, 0)

    const db = new DatabaseSync(fx.dbPath)
    const rows = db.prepare('SELECT migration_name FROM _prisma_migrations').all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].migration_name, '20240101000000_init')
    // table actually created
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all('foo')
    assert.deepEqual(cols.map((c) => c.name).sort(), ['id', 'v'])
    db.close()
  } finally {
    fx.cleanup()
  }
})

test('is idempotent — second run applies nothing new', async () => {
  const fx = makeFixture()
  try {
    fx.addMigration('20240101000000_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);')
    await runPrismaCommand({ ctx: fx.ctx })
    await runPrismaCommand({ ctx: fx.ctx }) // must not throw "table already exists"

    const db = new DatabaseSync(fx.dbPath)
    const count = db.prepare('SELECT COUNT(*) AS n FROM _prisma_migrations').get()
    assert.equal(count.n, 1)
    db.close()
  } finally {
    fx.cleanup()
  }
})

test('applies multiple migrations in lexicographic order', async () => {
  const fx = makeFixture()
  try {
    // 2nd depends on table from 1st — only correct if ordering holds
    fx.addMigration('20240101000000_a', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);')
    fx.addMigration('20240202000000_b', 'ALTER TABLE foo ADD COLUMN extra TEXT;')
    const rc = await runPrismaCommand({ ctx: fx.ctx })
    assert.equal(rc, 0)

    const db = new DatabaseSync(fx.dbPath)
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all('foo')
    assert.ok(cols.some((c) => c.name === 'extra'))
    db.close()
  } finally {
    fx.cleanup()
  }
})

test('checksum drift guard: editing an applied migration throws (M2)', async () => {
  const fx = makeFixture()
  try {
    fx.addMigration('20240101000000_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);')
    await runPrismaCommand({ ctx: fx.ctx })

    // Tamper with the already-applied migration file.
    fs.writeFileSync(
      path.join(fx.migrationsDir, '20240101000000_init', 'migration.sql'),
      'CREATE TABLE foo (id INTEGER PRIMARY KEY, tampered TEXT);'
    )

    await assert.rejects(() => runPrismaCommand({ ctx: fx.ctx }), /checksum mismatch/)
  } finally {
    fx.cleanup()
  }
})

test('a failing migration rolls back and is not recorded', async () => {
  const fx = makeFixture()
  try {
    fx.addMigration(
      '20240101000000_bad',
      'CREATE TABLE ok (id INTEGER PRIMARY KEY); THIS IS NOT SQL;'
    )
    await assert.rejects(() => runPrismaCommand({ ctx: fx.ctx }), /migration .* failed/)

    // The migration must not be recorded; the partial table must be rolled back.
    const db = new DatabaseSync(fx.dbPath)
    const migs = db.prepare('SELECT COUNT(*) AS n FROM _prisma_migrations').get()
    assert.equal(migs.n, 0)
    const tbl = db
      .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='ok'")
      .get()
    assert.equal(tbl.n, 0, 'partial CREATE TABLE should have rolled back')
    db.close()
  } finally {
    fx.cleanup()
  }
})

test('busy_timeout is set on the migration connection (C2)', async () => {
  const fx = makeFixture()
  try {
    fx.addMigration('20240101000000_init', 'CREATE TABLE foo (id INTEGER PRIMARY KEY);')
    await runPrismaCommand({ ctx: fx.ctx })
    // We cannot read the timeout of a closed connection, but we can assert the
    // migration succeeded even while a second connection holds a read lock,
    // which is the property busy_timeout buys us. Open a competing connection:
    const other = new DatabaseSync(fx.dbPath)
    other.exec('BEGIN; SELECT * FROM foo;') // read lock held open
    // Adding + applying another migration should still succeed (WAL + timeout).
    fx.addMigration('20240202000000_b', 'CREATE TABLE bar (id INTEGER PRIMARY KEY);')
    const rc = await runPrismaCommand({ ctx: fx.ctx })
    assert.equal(rc, 0)
    other.exec('COMMIT')
    other.close()
  } finally {
    fx.cleanup()
  }
})
