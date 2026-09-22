// Unit tests for buildOrderBy (shared v8 orderBy helper).

const test = require('node:test')
const assert = require('node:assert/strict')
const { buildOrderBy } = require('../src/models/queryUtils.js')

const fakeTable = {
  createTime: { desc: () => 'createTime-desc', asc: () => 'createTime-asc' },
  name: { desc: () => 'name-desc', asc: () => 'name-asc' },
}

test('buildOrderBy: falsy input is undefined so callers can skip orderBy', () => {
  assert.equal(buildOrderBy(null), undefined)
  assert.equal(buildOrderBy(undefined), undefined)
})

test('buildOrderBy: single object → one callback', () => {
  const cb = buildOrderBy({ createTime: 'desc' })
  assert.equal(typeof cb, 'function')
  assert.equal(cb(fakeTable), 'createTime-desc')
})

test('buildOrderBy: array → array of callbacks in order', () => {
  const cbs = buildOrderBy([{ name: 'asc' }, { createTime: 'desc' }])
  assert.ok(Array.isArray(cbs))
  assert.deepEqual(cbs.map((cb) => cb(fakeTable)), ['name-asc', 'createTime-desc'])
})

test('buildOrderBy: empty array → empty array, not undefined', () => {
  assert.deepEqual(buildOrderBy([]), [])
})
