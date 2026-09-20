#!/usr/bin/env node

/**
 * Multi-database teardown script
 *
 * Usage: node scripts/teardown-multi-db.js
 *
 * This script removes the analytics database setup by:
 * 1. Deleting generated analytics files
 * 2. Reverting patches to facade.js, types.d.ts, build.mjs
 * 3. Reverting Electron integration patches (main, preload, App.vue)
 * 4. Removing analytics scripts from package.json
 *
 * This is the reverse of setup-multi-db.js
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')

// Color output helpers
const colors = {
  green: (str) => `\x1b[32m${str}\x1b[0m`,
  yellow: (str) => `\x1b[33m${str}\x1b[0m`,
  cyan: (str) => `\x1b[36m${str}\x1b[0m`,
  red: (str) => `\x1b[31m${str}\x1b[0m`,
}

function log(msg, color = 'cyan') {
  console.log(colors[color](`[teardown-multi-db] ${msg}`))
}

function deleteFile(filePath) {
  const relativePath = path.relative(ROOT, filePath)
  if (!fs.existsSync(filePath)) {
    log(`Not found (skipped): ${relativePath}`, 'yellow')
    return
  }
  fs.unlinkSync(filePath)
  log(`Deleted: ${relativePath}`, 'green')
}

function deleteDir(dirPath) {
  const relativePath = path.relative(ROOT, dirPath)
  if (!fs.existsSync(dirPath)) {
    log(`Not found (skipped): ${relativePath}`, 'yellow')
    return
  }
  fs.rmSync(dirPath, { recursive: true, force: true })
  log(`Deleted: ${relativePath}`, 'green')
}

function revertPatch(filePath, revertFn, description) {
  const relativePath = path.relative(ROOT, filePath)
  if (!fs.existsSync(filePath)) {
    log(`File not found: ${relativePath}`, 'red')
    return false
  }

  let content = fs.readFileSync(filePath, 'utf8')
  const original = content

  content = revertFn(content)

  if (content === original) {
    log(`No revert needed: ${description}`, 'yellow')
    return false
  }

  fs.writeFileSync(filePath, content, 'utf8')
  log(`Reverted: ${description}`, 'green')
  return true
}

function main() {
  log('Starting multi-database teardown...', 'cyan')
  console.log()

  // Step 1: Delete generated files
  log('Step 1: Delete generated analytics files', 'cyan')
  const srcDir = path.join(ROOT, 'src')
  deleteDir(path.join(srcDir, 'prisma', 'analytics'))
  deleteDir(path.join(srcDir, 'generated', 'analytics_db_client'))
  deleteFile(path.join(ROOT, 'prisma.analytics.config.ts'))
  deleteFile(path.join(srcDir, 'utils', 'prisma', 'analyticsRuntime.js'))
  deleteFile(path.join(srcDir, 'utils', 'prisma', 'analyticsRunPrismaCommand.js'))
  deleteFile(path.join(srcDir, 'models', 'AnalyticsEventModel.js'))
  deleteFile(path.join(srcDir, 'models', 'AnalyticsMetaModel.js'))
  deleteFile(path.join(srcDir, 'models', 'analyticsIndex.js'))
  deleteFile(path.join(srcDir, 'storage', 'analyticsDb.db'))
  console.log()

  // Step 2: Delete Electron integration
  log('Step 2: Delete Electron integration', 'cyan')
  const desktopUtils = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'main', 'utils')
  deleteFile(path.join(desktopUtils, 'analyticsDb.ts'))
  console.log()

  // Step 3: Revert utils barrel exports
  log('Step 3: Revert utils/index.ts', 'cyan')
  const utilsIndexPath = path.join(desktopUtils, 'index.ts')
  revertPatch(
    utilsIndexPath,
    (content) => {
      // Remove analytics export line (\r?\n tolerates CRLF and LF)
      return content.replace(
        /\r?\nexport \{ handleAnalyticsAction, initAnalyticsDB \} from '\.\/analyticsDb'/,
        ''
      )
    },
    'utils/index.ts (remove analytics exports)'
  )
  console.log()

  // Step 4: Revert dbContext
  log('Step 4: Revert dbContext.ts', 'cyan')
  const dbContextPath = path.join(desktopUtils, 'dbContext.ts')
  revertPatch(
    dbContextPath,
    (content) => {
      // Remove ANALYTICS_DB_FILE_NAME from import
      content = content.replace(
        /const \{ DB_FILE_NAME, ANALYTICS_DB_FILE_NAME \} = commonFacade as IFacade/,
        `const { DB_FILE_NAME } = commonFacade as IFacade`
      )

      // Remove analytics path methods. Matches from the comma after
      // getMigrationsDir's return through the end of getAnalyticsMigrationsDir,
      // restoring the trailing ')' that closes getMigrationsDir. [\s\S] spans
      // lines regardless of CRLF/LF.
      content = content.replace(
        /(: path\.resolve\(app\.getAppPath\(\)\.replace\('app\.asar', ''\), 'prisma\/migrations'\)),[\s\S]*?'prisma\/analytics\/migrations'\)/,
        '$1'
      )

      return content
    },
    'dbContext.ts (remove analytics paths)'
  )
  console.log()

  // Step 5: Revert facade.js
  log('Step 5: Revert facade.js', 'cyan')
  const facadePath = path.join(ROOT, 'src', 'facade.js')
  revertPatch(
    facadePath,
    (content) => {
      // Remove analytics imports (anchored on the DBModels require line above)
      content = content.replace(
        /(const DBModels = require\('\.\/models'\))[\s\S]*?analyticsRunPrismaCommand'\)/,
        '$1'
      )

      // Remove analytics exports from Facade object
      content = content.replace(
        /\r?\n  getAnalyticsPrisma,\r?\n  runAnalyticsPrismaCommand,\r?\n  ANALYTICS_DB_FILE_NAME: 'analyticsDb\.db',/,
        ''
      )

      return content
    },
    'facade.js (remove analytics exports)'
  )
  console.log()

  // Step 6: Revert types.d.ts
  log('Step 6: Revert types.d.ts', 'cyan')
  const typesPath = path.join(ROOT, 'src', 'types.d.ts')
  revertPatch(
    typesPath,
    (content) => {
      // Remove analytics contract import
      content = content.replace(
        /\r?\nimport type \{ Models as AnalyticsModels, Contract as AnalyticsContract \} from '\.\/generated\/analytics_db_client\/contract'/,
        ''
      )

      // Remove analytics type exports (use [\s\S] for multi-line match)
      content = content.replace(
        /[\r\n]+\/\/ Analytics DB types[\s\S]*?export type AnalyticsMeta = AnalyticsModels\.AnalyticsMeta/,
        ''
      )

      // Remove analytics from Prisma.ModelName
      content = content.replace(
        / \| 'AnalyticsEvent' \| 'AnalyticsMeta'/,
        ''
      )

      // Remove analytics from IFacade (3 lines)
      content = content.replace(
        /\r?\n  getAnalyticsPrisma: \(ctx: IContextDB\) => Promise<any>\r?\n  runAnalyticsPrismaCommand: \(param: RunPrismaCmdParam\) => Promise<number>\r?\n  ANALYTICS_DB_FILE_NAME: string/,
        ''
      )

      // Remove analytics from IContextDB (2 lines)
      content = content.replace(
        /\r?\n  getAnalyticsDBPath\?: \(\) => string\r?\n  getAnalyticsMigrationsDir\?: \(\) => string/,
        ''
      )

      return content
    },
    'types.d.ts (remove analytics types)'
  )
  console.log()

  // Step 7: Revert package.json
  log('Step 7: Revert package.json', 'cyan')
  const packageJsonPath = path.join(ROOT, 'package.json')
  revertPatch(
    packageJsonPath,
    (content) => {
      const pkg = JSON.parse(content)
      let modified = false

      const scriptsToRemove = [
        'db:generate:analytics',
        'db:migrate:analytics',
        'db:studio:analytics',
        'db:generate:all',
      ]

      for (const key of scriptsToRemove) {
        if (pkg.scripts[key]) {
          delete pkg.scripts[key]
          modified = true
        }
      }

      return modified ? JSON.stringify(pkg, null, 2) + '\n' : content
    },
    'package.json (remove analytics scripts)'
  )
  console.log()

  // Step 8: Revert build.mjs
  log('Step 8: Revert build.mjs', 'cyan')
  const buildPath = path.join(ROOT, 'build.mjs')
  revertPatch(
    buildPath,
    (content) => {
      // Remove analytics migrations copy
      content = content.replace(
        /\r?\ncopyDir\(\r?\n  path\.join\(srcDir, 'prisma\/analytics\/migrations'\),\r?\n  path\.join\(dist, 'prisma\/analytics\/migrations'\)\r?\n\)/,
        ''
      )

      // Remove analytics generated client copy
      content = content.replace(
        /\r?\ncopyDir\(\r?\n  path\.join\(srcDir, 'generated\/analytics_db_client'\),\r?\n  path\.join\(dist, 'generated\/analytics_db_client'\)\r?\n\)/,
        ''
      )

      return content
    },
    'build.mjs (remove analytics asset copies)'
  )
  console.log()

  // Step 9: Revert Electron main index.ts
  log('Step 9: Revert Electron main index.ts', 'cyan')
  const mainIndexPath = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'main', 'index.ts')
  revertPatch(
    mainIndexPath,
    (content) => {
      // Remove analytics from import statement
      content = content.replace(
        /import \{ initDB, handlePersistenceAction, initAnalyticsDB, handleAnalyticsAction \} from '\.\/utils'/,
        `import { initDB, handlePersistenceAction } from './utils'`
      )

      // Remove analytics IPC handler
      content = content.replace(
        /\r?\n  ipcMain\.handle\('llm:analytics-action', handleAnalyticsAction\)/,
        ''
      )

      // Remove analytics init call
      content = content.replace(
        /\r?\n    initAnalyticsDB\(\)\.catch\(err => console\.error\('Analytics DB init failed:', err\)\)\r?\n  \}\)\.then\(\(\) => \{/,
        ''
      )

      return content
    },
    'Electron main index.ts (remove analytics IPC)'
  )
  console.log()

  // Step 10: Revert preload index.ts
  log('Step 10: Revert preload index.ts', 'cyan')
  const preloadPath = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'preload', 'index.ts')
  revertPatch(
    preloadPath,
    (content) => {
      // Remove analyticsAction from api object
      return content.replace(
        /\r?\n  analyticsAction: \(model: string, action: string, \.\.\.args\) =>\r?\n    ipcRenderer\.invoke\('llm:analytics-action', model, action, \.\.\.args\),/,
        ''
      )
    },
    'preload index.ts (remove analytics API)'
  )
  console.log()

  // Step 11: Revert App.vue
  log('Step 11: Revert renderer App.vue', 'cyan')
  const appVuePath = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'renderer', 'src', 'App.vue')
  revertPatch(
    appVuePath,
    (content) => {
      // Remove analytics example code (uses [\s\S] to match across lines)
      return content.replace(
        /[\r\n]+  \/\/ Analytics example: log an app launch event[\s\S]*?\}, 2000\);/,
        ''
      )
    },
    'App.vue (remove analytics example)'
  )
  console.log()

  // Final message
  console.log()
  log('✓ Multi-database teardown complete!', 'green')
  console.log()
  log('Next steps:', 'cyan')
  console.log('  1. Run: pnpm common build')
  console.log('  2. Test with: pnpm desktop dev')
  console.log()
  log('The scaffold is now back to single-database mode.', 'green')
  console.log()
}

main()
