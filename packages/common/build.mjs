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

// Generate the boolean-field registry BEFORE bundling so esbuild can inline it
// (sqliteTypeMiddleware.js imports it).
//
// v8 SQLite has no BOOLEAN column type: contracts map boolean fields onto
// textColumn holding 'true'/'false'. The emitted contract.json keeps each
// column's `default` ({ kind: 'literal', value: 'true' }), so it — not the
// contract source — is the registry's data source. Reading the emitted JSON
// avoids regex-matching the TS source, which silently produced `{}` whenever
// the model block ended with a trailing comma.
//
// Consequence to keep in mind when extending the contract: only boolean fields
// declared with a literal string default are detectable. A boolean column with
// no default cannot be distinguished from a plain string column by any emitted
// artifact, so it must be given `.default('false')` to be decoded.
function generateBoolFieldsRegistry(contractJsonRel, outRel) {
  const jsonPath = path.join(__dirname, contractJsonRel)
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`generateBoolFieldsRegistry: ${contractJsonRel} not found. Run "pnpm db:generate" first.`)
  }
  const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const registry = {}
  for (const ns of Object.values(json?.storage?.namespaces ?? {})) {
    for (const [model, table] of Object.entries(ns?.entries?.table ?? {})) {
      const fields = Object.entries(table.columns ?? {})
        .filter(([, col]) => (
          col.codecId === 'sqlite/text@1' &&
          col.default?.kind === 'literal' &&
          (col.default.value === 'true' || col.default.value === 'false')
        ))
        .map(([name]) => name)
      if (fields.length) registry[model] = fields
    }
  }
  const outPath = path.join(__dirname, outRel)
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(registry, null, 2) + '\n')
  return registry
}

generateBoolFieldsRegistry('src/generated/db_client/contract.json', 'src/generated/db_client/bool_fields.json')

await build({
  entryPoints: [path.join(__dirname, 'src/facade.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(dist, 'index.js'),
  // Keep the Prisma v8 runtime external; everything else
  // (generated contract, models) is inlined.
  external: ['@prisma/orm-sqlite', '@prisma/orm-sqlite/*'],
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
