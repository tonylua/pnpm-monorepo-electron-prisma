const { DatabaseSync } = require('node:sqlite')

const db = new DatabaseSync(':memory:')
const version = db.prepare('SELECT sqlite_version() AS version').get().version
const compileOptions = db.prepare('PRAGMA compile_options').all().map((row) => Object.values(row)[0])
const interesting = compileOptions.filter((option) =>
  /TEMP_STORE|THREADSAFE|OMIT_LOAD_EXTENSION|ENABLE_LOAD_EXTENSION/.test(option)
)
const cipher = db.prepare('PRAGMA cipher_version').all()
db.close()

process.stdout.write(
  `${JSON.stringify(
    {
      electron: process.versions.electron || null,
      node: process.versions.node,
      arch: process.arch,
      sqlite: version,
      loadExtension: true,
      cipher,
      compileOptions: interesting
    },
    null,
    2
  )}\n`
)
