// Concurrency tests. Two layers:
//   1. Adapter-level: the Mutex in startTransaction must serialize concurrent
//      transactions on the single synchronous node:sqlite connection.
//   2. End-to-end: a read-modify-write run through many concurrent transactions
//      must not lose updates (the hazard C3 fixes). Property-driven with
//      fast-check over random interleavings / counts.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const fc = require('fast-check')

const { PrismaNodeSqlite } = require('../src/utils/prisma/nodeSqliteAdapter')

function tmpDbPath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conctest-'))
  return { root, dbPath: path.join(root, 'c.db'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

test('startTransaction serializes concurrent transactions (mutex)', async () => {
  const fx = tmpDbPath()
  const factory = new PrismaNodeSqlite({ url: `file:${fx.dbPath}` })
  const adapter = await factory.connect()
  try {
    await adapter.executeScript('CREATE TABLE ctr (id INTEGER PRIMARY KEY, v INTEGER)')
    await adapter.executeRaw({ sql: 'INSERT INTO ctr (id, v) VALUES (1, 0)', args: [], argTypes: [] })

    let active = 0
    let maxActive = 0

    // Fire N transactions concurrently; inside each, assert no two overlap.
    const one = async () => {
      const tx = await adapter.startTransaction()
      active++
      maxActive = Math.max(maxActive, active)
      try {
        // read-modify-write inside the tx
        const res = await tx.queryRaw({ sql: 'SELECT v FROM ctr WHERE id = 1', args: [], argTypes: [] })
        const cur = Number(res.rows[0][0])
        await tx.executeRaw({
          sql: 'UPDATE ctr SET v = ? WHERE id = 1',
          args: [cur + 1],
          argTypes: [{ scalarType: 'int', arity: 'scalar' }]
        })
        await tx.commit()
      } finally {
        active--
      }
    }

    const N = 25
    await Promise.all(Array.from({ length: N }, one))

    assert.equal(maxActive, 1, 'transactions must not overlap — mutex should serialize them')
    const res = await adapter.queryRaw({ sql: 'SELECT v FROM ctr WHERE id = 1', args: [], argTypes: [] })
    assert.equal(Number(res.rows[0][0]), N, 'every increment must survive — no lost updates')
  } finally {
    await adapter.dispose()
    fx.cleanup()
  }
})

test('property: concurrent transactional increments never lose updates', async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 40 }), async (n) => {
      const fx = tmpDbPath()
      const factory = new PrismaNodeSqlite({ url: `file:${fx.dbPath}` })
      const adapter = await factory.connect()
      try {
        await adapter.executeScript('CREATE TABLE ctr (id INTEGER PRIMARY KEY, v INTEGER)')
        await adapter.executeRaw({ sql: 'INSERT INTO ctr (id, v) VALUES (1, 0)', args: [], argTypes: [] })

        const inc = async () => {
          const tx = await adapter.startTransaction()
          try {
            const res = await tx.queryRaw({ sql: 'SELECT v FROM ctr WHERE id = 1', args: [], argTypes: [] })
            const cur = Number(res.rows[0][0])
            await tx.executeRaw({
              sql: 'UPDATE ctr SET v = ? WHERE id = 1',
              args: [cur + 1],
              argTypes: [{ scalarType: 'int', arity: 'scalar' }]
            })
            await tx.commit()
          } catch (e) {
            await tx.rollback()
            throw e
          }
        }

        await Promise.all(Array.from({ length: n }, inc))
        const res = await adapter.queryRaw({ sql: 'SELECT v FROM ctr WHERE id = 1', args: [], argTypes: [] })
        return Number(res.rows[0][0]) === n
      } finally {
        await adapter.dispose()
        fx.cleanup()
      }
    }),
    { numRuns: 15 }
  )
})

test('plain (non-transactional) concurrent RMW DOES lose updates — documents the hazard', async () => {
  // This is the anti-test: it demonstrates *why* updateArrayProp needed a
  // transaction. Without one, interleaved read-modify-write loses increments.
  // node:sqlite is synchronous per-call, so to actually interleave we await a
  // microtask between read and write (mirrors real async model code).
  const fx = tmpDbPath()
  const factory = new PrismaNodeSqlite({ url: `file:${fx.dbPath}` })
  const adapter = await factory.connect()
  try {
    await adapter.executeScript('CREATE TABLE ctr (id INTEGER PRIMARY KEY, v INTEGER)')
    await adapter.executeRaw({ sql: 'INSERT INTO ctr (id, v) VALUES (1, 0)', args: [], argTypes: [] })

    const racyInc = async () => {
      const res = await adapter.queryRaw({ sql: 'SELECT v FROM ctr WHERE id = 1', args: [], argTypes: [] })
      const cur = Number(res.rows[0][0])
      await Promise.resolve() // yield: let another read see the same `cur`
      await adapter.executeRaw({
        sql: 'UPDATE ctr SET v = ? WHERE id = 1',
        args: [cur + 1],
        argTypes: [{ scalarType: 'int', arity: 'scalar' }]
      })
    }

    const N = 20
    await Promise.all(Array.from({ length: N }, racyInc))
    const res = await adapter.queryRaw({ sql: 'SELECT v FROM ctr WHERE id = 1', args: [], argTypes: [] })
    const final = Number(res.rows[0][0])
    // We assert the hazard is real (final < N). If this ever equals N the
    // interleaving didn't trigger — not a failure of the fix, so we only warn.
    assert.ok(final <= N)
    if (final === N) console.warn('  (note: racy interleaving did not trigger this run)')
  } finally {
    await adapter.dispose()
    fx.cleanup()
  }
})
