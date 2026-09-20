#!/usr/bin/env node

/**
 * Multi-database setup script
 *
 * Usage: node scripts/setup-multi-db.js
 *
 * This script sets up the analytics database example by:
 * 1. Copying template files to their target locations
 * 2. Patching dbContext.ts to add analytics path methods
 * 3. Patching facade.js to export analytics client
 * 4. Patching types.d.ts to export analytics types
 * 5. Updating package.json scripts
 * 6. Patching apps/desktop main index, preload, and renderer
 *
 * The templates are committed to the repo, so this script is idempotent
 * and can be run multiple times safely.
 */

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join(ROOT, 'templates', 'analytics')
const SRC_DIR = path.join(ROOT, 'src')

// Color output helpers
const colors = {
  green: (str) => `\x1b[32m${str}\x1b[0m`,
  yellow: (str) => `\x1b[33m${str}\x1b[0m`,
  cyan: (str) => `\x1b[36m${str}\x1b[0m`,
  red: (str) => `\x1b[31m${str}\x1b[0m`,
}

function log(msg, color = 'cyan') {
  console.log(colors[color](`[setup-multi-db] ${msg}`))
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    log(`Created directory: ${path.relative(ROOT, dir)}`, 'green')
  }
}

function copyTemplate(templateName, targetPath) {
  const templatePath = path.join(TEMPLATES_DIR, templateName)

  if (!fs.existsSync(templatePath)) {
    log(`Template not found: ${templateName}`, 'red')
    process.exit(1)
  }

  if (fs.existsSync(targetPath)) {
    log(`Skipped (exists): ${path.relative(ROOT, targetPath)}`, 'yellow')
    return false
  }

  ensureDir(path.dirname(targetPath))
  fs.copyFileSync(templatePath, targetPath)
  log(`Created: ${path.relative(ROOT, targetPath)}`, 'green')
  return true
}

function patchFile(filePath, patchFn, description) {
  if (!fs.existsSync(filePath)) {
    log(`File not found: ${path.relative(ROOT, filePath)}`, 'red')
    process.exit(1)
  }

  let content = fs.readFileSync(filePath, 'utf8')
  const original = content

  content = patchFn(content)

  if (content === original) {
    log(`No patch needed: ${description}`, 'yellow')
    return false
  }

  fs.writeFileSync(filePath, content, 'utf8')
  log(`Patched: ${description}`, 'green')
  return true
}

function main() {
  log('Starting multi-database setup...', 'cyan')
  console.log()

  // Step 1: Copy contract
  log('Step 1: Copy analytics contract', 'cyan')
  copyTemplate(
    'contract.ts.template',
    path.join(SRC_DIR, 'prisma', 'analytics', 'contract.ts')
  )
  console.log()

  // Step 2: Copy CLI config
  log('Step 2: Copy Prisma CLI config', 'cyan')
  copyTemplate(
    'prisma.analytics.config.ts.template',
    path.join(ROOT, 'prisma.analytics.config.ts')
  )
  console.log()

  // Step 3: Copy runtime factory
  log('Step 3: Copy analytics runtime factory', 'cyan')
  copyTemplate(
    'analyticsRuntime.js.template',
    path.join(SRC_DIR, 'utils', 'prisma', 'analyticsRuntime.js')
  )
  console.log()

  // Step 4: Copy migration runner
  log('Step 4: Copy analytics migration runner', 'cyan')
  copyTemplate(
    'analyticsRunPrismaCommand.js.template',
    path.join(SRC_DIR, 'utils', 'prisma', 'analyticsRunPrismaCommand.js')
  )
  console.log()

  // Step 5: Copy model wrappers
  log('Step 5: Copy analytics model wrappers', 'cyan')
  copyTemplate(
    'AnalyticsEventModel.js.template',
    path.join(SRC_DIR, 'models', 'AnalyticsEventModel.js')
  )
  copyTemplate(
    'AnalyticsMetaModel.js.template',
    path.join(SRC_DIR, 'models', 'AnalyticsMetaModel.js')
  )
  copyTemplate(
    'analyticsIndex.js.template',
    path.join(SRC_DIR, 'models', 'analyticsIndex.js')
  )
  console.log()

  // Step 6: Copy Electron integration
  log('Step 6: Copy Electron integration', 'cyan')
  const desktopUtils = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'main', 'utils')
  copyTemplate(
    'analyticsDb.ts.template',
    path.join(desktopUtils, 'analyticsDb.ts')
  )
  console.log()

  // Step 6.5: Patch utils barrel export
  log('Step 6.5: Patch apps/desktop/src/main/utils/index.ts', 'cyan')
  const utilsIndexPath = path.join(desktopUtils, 'index.ts')
  patchFile(
    utilsIndexPath,
    (content) => {
      // Add analytics exports
      if (!content.includes('analyticsDb')) {
        content = content.replace(
          /(export \{ handlePersistenceAction, initDB \} from '\.\/db')/,
          `$1
export { handleAnalyticsAction, initAnalyticsDB } from './analyticsDb'`
        )
      }

      return content
    },
    'utils/index.ts (export analytics APIs)'
  )
  console.log()

  // Step 7: Patch dbContext
  log('Step 7: Patch dbContext.ts', 'cyan')
  const dbContextPath = path.join(desktopUtils, 'dbContext.ts')
  patchFile(
    dbContextPath,
    (content) => {
      // Import ANALYTICS_DB_FILE_NAME from facade
      if (!content.includes('ANALYTICS_DB_FILE_NAME')) {
        content = content.replace(
          /const \{ DB_FILE_NAME \} = commonFacade as IFacade/,
          `const { DB_FILE_NAME, ANALYTICS_DB_FILE_NAME } = commonFacade as IFacade`
        )
      }

      // Add getAnalyticsDBPath and getAnalyticsMigrationsDir methods.
      // Match the last property value (getMigrationsDir's return) and append a
      // comma + the new methods BEFORE the object's closing brace. The capture
      // deliberately stops at the ')' so the closing '}' is left untouched.
      if (!content.includes('getAnalyticsDBPath')) {
        content = content.replace(
          /(: path\.resolve\(app\.getAppPath\(\)\.replace\('app\.asar', ''\), 'prisma\/migrations'\))/,
          `$1,

  getAnalyticsDBPath: () =>
    isDev
      ? path.posix.resolve(\`../../packages/common/src/storage/\${ANALYTICS_DB_FILE_NAME}\`)
      : path.join(app.getPath('userData'), ANALYTICS_DB_FILE_NAME),

  getAnalyticsMigrationsDir: () =>
    isDev
      ? path.join(
          app.getAppPath().replace('app.asar', 'app.asar.unpacked'),
          '../../packages/common/src/prisma/analytics/migrations'
        )
      : path.resolve(app.getAppPath().replace('app.asar', ''), 'prisma/analytics/migrations')`
        )
      }

      return content
    },
    'dbContext.ts (add analytics paths)'
  )
  console.log()

  // Step 8: Patch facade.js
  log('Step 8: Patch facade.js', 'cyan')
  const facadePath = path.join(SRC_DIR, 'facade.js')
  patchFile(
    facadePath,
    (content) => {
      // Add analytics runtime + migration runner imports.
      // analyticsRuntime.js is ESM (like utils/prisma/index.js), so unwrap it the
      // same way; the migration runner is plain CJS.
      if (!content.includes('analyticsRuntime')) {
        content = content.replace(
          /(const DBModels = require\('\.\/models'\))/,
          `$1
const analyticsModule = require('./utils/prisma/analyticsRuntime')
const getAnalyticsPrisma =
  analyticsModule.getAnalyticsPrisma || analyticsModule.default || analyticsModule
const runAnalyticsPrismaCommand = require('./utils/prisma/analyticsRunPrismaCommand')`
        )
      }

      // Add analytics exports to the Facade object
      if (!content.includes('getAnalyticsPrisma:')) {
        content = content.replace(
          /(  DB_FILE_NAME: 'myDb\.db',)/,
          `$1
  getAnalyticsPrisma,
  runAnalyticsPrismaCommand,
  ANALYTICS_DB_FILE_NAME: 'analyticsDb.db',`
        )
      }

      return content
    },
    'facade.js (export analytics client)'
  )
  console.log()

  // Step 9: Patch types.d.ts
  log('Step 9: Patch types.d.ts', 'cyan')
  const typesPath = path.join(SRC_DIR, 'types.d.ts')
  patchFile(
    typesPath,
    (content) => {
      // Add analytics contract type imports
      if (!content.includes('analytics_db_client/contract')) {
        content = content.replace(
          /(import type \{ Models, Contract \} from '\.\/generated\/db_client\/contract')/,
          `$1
import type { Models as AnalyticsModels, Contract as AnalyticsContract } from './generated/analytics_db_client/contract'`
        )
      }

      // Export analytics types
      if (!content.includes('export type { AnalyticsModels')) {
        content = content.replace(
          /(export type ThreadMessage = Models\.ThreadMessage)/,
          `$1

// Analytics DB types
export type { AnalyticsModels, AnalyticsContract }
export type AnalyticsEvent = AnalyticsModels.AnalyticsEvent
export type AnalyticsMeta = AnalyticsModels.AnalyticsMeta`
        )
      }

      // Extend Prisma.ModelName to include analytics models
      if (!content.includes('AnalyticsEvent')) {
        content = content.replace(
          /(export type ModelName = 'Account' \| 'Thread' \| 'ThreadMessage')/,
          `export type ModelName = 'Account' | 'Thread' | 'ThreadMessage' | 'AnalyticsEvent' | 'AnalyticsMeta'`
        )
      }

      // Add getAnalyticsPrisma to IFacade
      if (!content.includes('getAnalyticsPrisma:')) {
        content = content.replace(
          /(  DB_FILE_NAME: string\n  runPrismaCommand: TypeRunPrismaCommand)/,
          `$1
  getAnalyticsPrisma: (ctx: IContextDB) => Promise<any>
  runAnalyticsPrismaCommand: (param: RunPrismaCmdParam) => Promise<number>
  ANALYTICS_DB_FILE_NAME: string`
        )
      }

      // Extend IContextDB with analytics paths
      if (!content.includes('getAnalyticsDBPath')) {
        content = content.replace(
          /(  getEnvPath\?: \(\) => string)/,
          `$1
  getAnalyticsDBPath?: () => string
  getAnalyticsMigrationsDir?: () => string`
        )
      }

      return content
    },
    'types.d.ts (export analytics types)'
  )
  console.log()

  // Step 10: Patch package.json
  log('Step 10: Patch package.json scripts', 'cyan')
  const packageJsonPath = path.join(ROOT, 'package.json')
  patchFile(
    packageJsonPath,
    (content) => {
      const pkg = JSON.parse(content)

      let modified = false

      // Add analytics scripts if missing
      const scriptsToAdd = {
        'db:generate:analytics': 'prisma contract emit --config ./prisma.analytics.config.ts',
        'db:migrate:analytics': 'prisma db update --config ./prisma.analytics.config.ts --confirm analyticsDb.db',
        'db:studio:analytics': 'prisma studio --config ./prisma.analytics.config.ts',
      }

      for (const [key, value] of Object.entries(scriptsToAdd)) {
        if (!pkg.scripts[key]) {
          pkg.scripts[key] = value
          modified = true
        }
      }

      // Update db:generate:all to include analytics (project uses db:generate, not db:generate:all)
      if (pkg.scripts['db:generate'] && !pkg.scripts['db:generate:all']) {
        // Create a new db:generate:all script
        pkg.scripts['db:generate:all'] = 'pnpm db:generate && pnpm db:generate:analytics'
        modified = true
      } else if (pkg.scripts['db:generate:all'] && !pkg.scripts['db:generate:all'].includes('analytics')) {
        pkg.scripts['db:generate:all'] += ' && pnpm db:generate:analytics'
        modified = true
      }

      return modified ? JSON.stringify(pkg, null, 2) + '\n' : content
    },
    'package.json (add analytics scripts)'
  )
  console.log()

  // Step 10.5: Patch build.mjs
  log('Step 10.5: Patch build.mjs', 'cyan')
  const buildPath = path.join(ROOT, 'build.mjs')
  patchFile(
    buildPath,
    (content) => {
      // Add analytics migrations copy
      if (!content.includes('prisma/analytics/migrations')) {
        content = content.replace(
          /(copyDir\(path\.join\(srcDir, 'prisma\/migrations'\), path\.join\(dist, 'prisma\/migrations'\)\))/,
          `$1
copyDir(
  path.join(srcDir, 'prisma/analytics/migrations'),
  path.join(dist, 'prisma/analytics/migrations')
)`
        )
      }

      // Add analytics generated client copy
      if (!content.includes('analytics_db_client')) {
        content = content.replace(
          /(copyDir\(\n  path\.join\(srcDir, 'generated\/db_client'\),\n  path\.join\(dist, 'generated\/db_client'\)\n\))/,
          `$1
copyDir(
  path.join(srcDir, 'generated/analytics_db_client'),
  path.join(dist, 'generated/analytics_db_client')
)`
        )
      }

      return content
    },
    'build.mjs (copy analytics assets)'
  )
  console.log()

  // Step 11: Patch Electron main index.ts
  log('Step 11: Patch Electron main index.ts', 'cyan')
  const mainIndexPath = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'main', 'index.ts')
  patchFile(
    mainIndexPath,
    (content) => {
      // Add analytics imports to the existing utils import
      if (!content.includes('initAnalyticsDB')) {
        content = content.replace(
          /(import \{ initDB, handlePersistenceAction \} from '\.\/utils')/,
          `import { initDB, handlePersistenceAction, initAnalyticsDB, handleAnalyticsAction } from './utils'`
        )
      }

      // Add IPC handler registration
      if (!content.includes('llm:analytics-action')) {
        content = content.replace(
          /(ipcMain\.handle\('llm:persistence-action', handlePersistenceAction\))/,
          `$1
  ipcMain.handle('llm:analytics-action', handleAnalyticsAction)`
        )
      }

      // Add init call (initDB() is at top level in whenReady, not awaited inline)
      if (!content.includes('initAnalyticsDB()')) {
        content = content.replace(
          /(initDB\(\)\.then\(\(\) => \{)/,
          `$1
    initAnalyticsDB().catch(err => console.error('Analytics DB init failed:', err))
  }).then(() => {`
        )
      }

      return content
    },
    'Electron main index.ts (wire analytics IPC)'
  )
  console.log()

  // Step 12: Patch preload index.ts
  log('Step 12: Patch preload index.ts', 'cyan')
  const preloadPath = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'preload', 'index.ts')
  patchFile(
    preloadPath,
    (content) => {
      // Add analyticsAction to api object (CRLF-tolerant: match with \r?\n, insert with \n)
      if (!content.includes('analyticsAction')) {
        content = content.replace(
          /(  persistenceAction: \(model: string, action: string, \.\.\.args\) =>\r?\n    ipcRenderer\.invoke\('llm:persistence-action', model, action, \.\.\.args\),)/,
          `$1\n  analyticsAction: (model: string, action: string, ...args) =>\n    ipcRenderer.invoke('llm:analytics-action', model, action, ...args),`
        )
      }

      return content
    },
    'preload index.ts (expose analytics API)'
  )
  console.log()

  // Step 13: Patch renderer App.vue (example usage)
  log('Step 13: Patch renderer App.vue (example usage)', 'cyan')
  const appVuePath = path.join(ROOT, '..', '..', 'apps', 'desktop', 'src', 'renderer', 'src', 'App.vue')
  patchFile(
    appVuePath,
    (content) => {
      // Add analytics example inside onMounted (after the existing setTimeout block)
      // Use \r?\n to tolerate both CRLF and LF files
      // Check for the actual analytics example code, not just the word "analyticsAction"
      if (!content.includes('Analytics example: log an app launch event')) {
        content = content.replace(
          /(    list\.value = threads;\r?\n  }, 1000\);)/,
          `$1\n\n  // Analytics example: log an app launch event\n  setTimeout(async () => {\n    try {\n      const event = await window.api.analyticsAction('AnalyticsEvent', 'create', {\n        type: 'app_launch',\n        timestamp: new Date(),\n        data: JSON.stringify({ version: '1.0.0' })\n      })\n      console.log('Analytics event created:', event)\n    } catch (err) {\n      console.error('Analytics failed:', err)\n    }\n  }, 2000);`
        )
      }

      return content
    },
    'App.vue (add analytics example)'
  )
  console.log()

  // Step 14: Generate analytics client (required before next build)
  log('Step 14: Generate analytics database client', 'cyan')
  const { execSync } = require('node:child_process')
  try {
    execSync('pnpm db:generate:analytics', { cwd: ROOT, stdio: 'inherit' })
    log('✓ Analytics client generated', 'green')
  } catch (error) {
    log('✗ Failed to generate analytics client', 'red')
    console.error(error.message)
    process.exit(1)
  }
  console.log()

  // Step 15: Create initial migration
  log('Step 15: Create analytics database migration', 'cyan')
  try {
    execSync('pnpm db:migrate:analytics', { cwd: ROOT, stdio: 'inherit' })
    log('✓ Analytics migration created', 'green')
  } catch (error) {
    log('✗ Failed to create analytics migration', 'red')
    console.error(error.message)
    process.exit(1)
  }
  console.log()

  // Final instructions
  console.log()
  log('✓ Multi-database setup complete!', 'green')
  console.log()
  log('Next steps:', 'cyan')
  console.log('  1. Run: pnpm common build')
  console.log('  2. Test with: pnpm desktop dev')
  console.log()
  log('The analytics database is now ready to use!', 'green')
  console.log()
  log('To remove the example:', 'yellow')
  console.log('  - Delete src/prisma/analytics/')
  console.log('  - Delete prisma.analytics.config.ts')
  console.log('  - Delete src/utils/prisma/analyticsRuntime.js')
  console.log('  - Delete src/utils/prisma/analyticsRunPrismaCommand.js')
  console.log('  - Delete src/models/Analytics*.js and analyticsIndex.js')
  console.log('  - Remove analytics scripts from package.json')
  console.log('  - Remove analytics exports from facade.js and types.d.ts')
  console.log('  - Delete apps/desktop/src/main/utils/analyticsDb.ts')
  console.log('  - Revert patches to main index.ts, preload, and App.vue')
  console.log()
}

main()
