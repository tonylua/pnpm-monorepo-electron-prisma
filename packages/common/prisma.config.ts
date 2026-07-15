import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 moved connection configuration out of schema.prisma into this file.
// This config is used by the Prisma CLI (generate / migrate dev) during development.
// The runtime (packaged Electron app) connects through the node:sqlite driver adapter
// and does NOT rely on this file — see src/utils/prisma/index.js.

// Load DATABASE_URL from the dev env file when running CLI commands locally.
const envUrl = process.env.DATABASE_URL
const defaultDevUrl = 'file:' + path.join(__dirname, 'src', 'storage', 'myDb.db')

export default defineConfig({
  schema: path.join(__dirname, 'src', 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(__dirname, 'src', 'prisma', 'migrations')
  },
  datasource: {
    url: envUrl ?? defaultDevUrl
  }
})
