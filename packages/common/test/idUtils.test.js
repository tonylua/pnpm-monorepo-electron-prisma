// Unit tests for idUtils.withGeneratedId.
//
// Regression guard: withGeneratedId must stay a pure DATA transformer. It was
// once backported as a higher-order function wrapping `client.<Model>.create`,
// which detached the method from its model accessor and made every create fail
// with "Cannot read properties of undefined (reading 'contract')".

const test = require('node:test')
const assert = require('node:assert/strict')
const { withGeneratedId } = require('../src/utils/idUtils.js')

test('withGeneratedId: data transformer returns a plain object, not a function', () => {
  const out = withGeneratedId({ username: 'alice' })
  assert.equal(typeof out, 'object')
  assert.notEqual(typeof out, 'function')
  assert.match(out.id, /^[0-9a-f-]{36}$/)
})

test('withGeneratedId: fills in id when absent', () => {
  const out = withGeneratedId({ username: 'alice' })
  assert.equal(out.username, 'alice')
  assert.notEqual(out.id, 'uuid()')
})

test('withGeneratedId: preserves a caller-provided id', () => {
  const out = withGeneratedId({ id: 'caller-id', username: 'alice' })
  assert.equal(out.id, 'caller-id')
})

test('withGeneratedId: treats empty-string id as absent', () => {
  assert.match(withGeneratedId({ id: '' }).id, /^[0-9a-f-]{36}$/)
})

test('withGeneratedId: does not mutate the input', () => {
  const input = { username: 'alice' }
  withGeneratedId(input)
  assert.equal(input.id, undefined)
})

test('withGeneratedId: non-objects pass through unchanged', () => {
  assert.equal(withGeneratedId(undefined), undefined)
  assert.equal(withGeneratedId(null), null)
  assert.deepEqual(withGeneratedId([{ a: 1 }]), [{ a: 1 }])
})
