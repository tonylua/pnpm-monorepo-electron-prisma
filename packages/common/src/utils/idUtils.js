const { randomUUID } = require('node:crypto')

/**
 * Fill in a UUID primary key when the caller did not supply one.
 *
 * v8 contracts have no @default directives — `id` is declared as
 * `field.column(textColumn).id().default('uuid()')`, and 'uuid()' is just a
 * string literal, so the application must generate the real key.
 *
 * This is a pure DATA transformer (in → out object), deliberately NOT a
 * higher-order function wrapping `client.<Model>.create`: unwrapping the method
 * loses its `this` binding and the v8 model accessor then fails with
 * "Cannot read properties of undefined (reading 'contract')".
 *
 * @param {object} data - payload to create
 * @returns {object} payload with `id` filled in when absent
 */
function withGeneratedId(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  if (data.id !== undefined && data.id !== null && data.id !== '') return data
  return { ...data, id: randomUUID() }
}

module.exports = {
  randomUUID,
  withGeneratedId,
}
