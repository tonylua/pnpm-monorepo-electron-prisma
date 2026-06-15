import { Prisma } from 'db_client'
import { type IFacade } from '@app/common'

export function getDBModelProxy<T extends Prisma.ModelName>(modelName: Prisma.ModelName) {
  return new Proxy(
    {},
    {
      get(_, action: string) {
        return async function (...args) {
          return await window.api.persistenceAction(modelName, action, ...args)
        }
      }
    }
  ) as ReturnType<IFacade['DBModels'][`get${T}Model`]>
}

export function omit(obj, keysToOmit) {
  const result = { ...obj }
  keysToOmit.forEach((key) => {
    if (key in result) {
      delete result[key]
    }
  })
  return result
}

export function throttle<T>(func: (arg: T) => void, delay = 500) {
  let lastCallTime = 0

  return function (arg: T) {
    const currentTime = Date.now()
    if (currentTime - lastCallTime >= delay) {
      func(arg)
      lastCallTime = currentTime
    }
  }
}

export function debounce<T extends (...args: any[]) => void>(func: T, wait: number): T {
  let timeout: NodeJS.Timeout | null = null

  const debounced: T = ((...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }) as T

  return debounced
}