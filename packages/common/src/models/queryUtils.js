/**
 * Query utility functions shared across models.
 * v8 Prisma 适配层的通用查询辅助函数。
 */

/**
 * Convert orderBy clause to v8 chain API format.
 * @param {Object|Array<Object>|undefined} orderBy - v7-style orderBy object or array
 * @returns {Function|Array<Function>|undefined} - v8 chain callback(s)
 * @example
 *   buildOrderBy({ createdAt: 'desc' }) → (t) => t.createdAt.desc()
 *   buildOrderBy([{ name: 'asc' }, { id: 'desc' }]) → [(t) => t.name.asc(), (t) => t.id.desc()]
 */
function buildOrderBy(orderBy) {
  if (!orderBy) return undefined
  if (Array.isArray(orderBy)) {
    return orderBy.map((entry) => {
      const [field, direction] = Object.entries(entry)[0]
      return (t) => t[field][direction]()
    })
  }
  const [field, direction] = Object.entries(orderBy)[0]
  return (t) => t[field][direction]()
}

module.exports = { buildOrderBy }
