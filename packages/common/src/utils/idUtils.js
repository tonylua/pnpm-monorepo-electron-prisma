import { randomUUID as _randomUUID } from 'node:crypto'

export { _randomUUID as randomUUID }

/**
 * Higher-order function that adds generated UUID to data before calling a
 * create function. Centralizes crypto.randomUUID() calls so ID generation
 * logic lives in one place.
 *
 * @template T
 * @param {(data: T) => Promise<any>} createFn - The underlying create function
 * @returns {(data: Omit<T, 'id'>) => Promise<any>} Wrapped function that adds id
 */
export function withGeneratedId(createFn) {
  return function (data) {
    return createFn({ id: _randomUUID(), ...data })
  }
}
