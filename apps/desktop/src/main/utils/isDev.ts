import electron from 'electron'

const { env } = process
const isEnvSet = 'ELECTRON_IS_DEV' in env
const getFromEnv = Number.parseInt(env.ELECTRON_IS_DEV as string, 10) === 1

// export const isDev = process.env.NODE_ENV === 'development'
export const isDev = isEnvSet ? getFromEnv : !electron.app.isPackaged
