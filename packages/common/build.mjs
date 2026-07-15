// Build @app/common into a single CJS bundle.
//
// Prisma 7's generated client is ESM/TypeScript, so we use esbuild (not the old
// plain-rollup pipeline, which cannot parse TS) to inline it into dist/index.js.
// The @prisma/client runtime and driver-adapter-utils stay external — they are
// plain CJS in node_modules and ship with the app; node:sqlite is a builtin.

import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dist = path.join(__dirname, 'dist')

// clean
fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [path.join(__dirname, 'src/facade.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(dist, 'index.js'),
  // Keep the Prisma runtime and node builtins external; everything else
  // (generated client TS, adapter, models) is inlined.
  external: ['@prisma/client', '@prisma/client/*', '@prisma/driver-adapter-utils'],
  logLevel: 'info'
})

// Copy runtime assets that the facade/migrations expect on disk.
// (esbuild bundles code, not data files.)
function copyDir(src, destDir) {
  if (!fs.existsSync(src)) return
  fs.cpSync(src, destDir, { recursive: true })
}
function copyFile(src, destDir) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(destDir, { recursive: true })
  fs.copyFileSync(src, path.join(destDir, path.basename(src)))
}

const srcDir = path.join(__dirname, 'src')
copyFile(path.join(srcDir, 'prisma/.env.dev'), dist)
copyFile(path.join(srcDir, 'prisma/.env'), dist)
copyDir(path.join(srcDir, 'prisma/migrations'), path.join(dist, 'prisma/migrations'))
copyDir(path.join(srcDir, 'storage/models'), path.join(dist, 'storage/models'))

// Copy type declarations (hand-written .d.ts) for downstream typing.
copyFile(path.join(srcDir, 'types.d.ts'), dist)

// Copy the generated client so dist/types.d.ts's relative import
// (./generated/db_client/client) resolves for downstream TS consumers.
// Only the .ts/.d.ts are needed for typing; the runtime code is already
// inlined into index.js, so this is types-only.
copyDir(
  path.join(srcDir, 'generated/db_client'),
  path.join(dist, 'generated/db_client')
)

console.log('✓ @app/common built to dist/index.js')
