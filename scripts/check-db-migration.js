#!/usr/bin/env node
/**
 * Prisma 8 Contract Checker
 * 检查 Prisma 8 contract 状态:
 * - contract.ts 文件状态
 * - app/refs/db.json 是否存在且合法
 * - 当前 hash 是否已有对应的 snapshot
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ============ Prisma 8 Contract 配置 ============
const PRISMA_ROOT = path.join(__dirname, '../packages/common/src/prisma')
const CONTRACTS = [
  {
    label: '主库',
    contractSrc: path.join(PRISMA_ROOT, 'contract.ts'),
    migrationsDir: path.join(PRISMA_ROOT, 'migrations'),
  },
  // 如果通过 `pnpm common setup:multi-db` 添加了第二个演示库（analytics），在此追加
  // {
  //   label: 'Analytics',
  //   contractSrc: path.join(PRISMA_ROOT, 'analytics', 'contract.ts'),
  //   migrationsDir: path.join(PRISMA_ROOT, 'analytics', 'migrations'),
  // },
]

// ============ 辅助函数 ============

/**
 * 读取 migrations/app/refs/db.json
 */
function readDbJson(migrationsDir) {
  const dbJsonPath = path.join(migrationsDir, 'app', 'refs', 'db.json')
  if (!fs.existsSync(dbJsonPath)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'))
  } catch (error) {
    return { __invalid: true }
  }
}

/**
 * 检查 snapshot 是否存在
 */
function hasSnapshot(migrationsDir, hash) {
  if (!hash) return false
  const snapshotPath = path.join(migrationsDir, 'snapshots', hash, 'contract.json')
  return fs.existsSync(snapshotPath)
}

/**
 * 获取 git 变更的文件列表（可选，用于检测 contract 文件是否刚被合并）
 */
function getRecentlyChangedFiles() {
  try {
    // 检查最近一次 commit 的变更（适用于 post-merge hook）
    const output = execSync('git diff --name-only HEAD@{1} HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split('\n').filter(Boolean)
  } catch (error) {
    // 如果不在 git 仓库或无历史记录，返回空数组
    return []
  }
}

/**
 * 检查 Prisma 8 Contract
 */
function checkPrismaContract() {
  console.log('🔍 检查 Prisma 8 Contract...\n')

  const changedFiles = getRecentlyChangedFiles()
  let exitCode = 0

  for (const config of CONTRACTS) {
    const { label, contractSrc, migrationsDir } = config

    // 检查 contract 文件是否存在
    if (!fs.existsSync(contractSrc)) {
      console.log(`📦 ${label}`)
      console.log(`   ❌ Contract 文件不存在: ${path.relative(process.cwd(), contractSrc)}`)
      exitCode = 1
      console.log('')
      continue
    }

    // 检查 contract 文件是否刚被修改
    const contractChanged = changedFiles.some((file) => {
      const normalized = file.replace(/\\/g, '/')
      const contractRelative = path.relative(process.cwd(), contractSrc).replace(/\\/g, '/')
      return normalized === contractRelative
    })

    // 读取 db.json
    const dbJson = readDbJson(migrationsDir)
    const hash = dbJson && !dbJson.__invalid ? dbJson.hash : null
    const snapshotExists = hasSnapshot(migrationsDir, hash)

    console.log(`📦 ${label} (${path.relative(process.cwd(), migrationsDir)})`)

    if (!dbJson) {
      console.log('   ❌ 未找到 app/refs/db.json')
      console.log('   💡 首次运行需执行: pnpm prisma contract emit && pnpm dbUpdate')
      exitCode = 1
    } else if (dbJson.__invalid) {
      console.log('   ❌ app/refs/db.json 格式非法')
      exitCode = 1
    } else {
      console.log(`   🔑 hash: ${hash}`)
      console.log(`   📸 snapshot: ${snapshotExists ? '✅ 已存在' : '❌ 缺失'}`)
      if (!snapshotExists) {
        console.log('   💡 请运行: pnpm prisma contract emit')
        exitCode = 1
      }
    }

    if (contractChanged) {
      console.log('   ⚠️  contract 源文件刚被合并，请运行: pnpm prisma contract emit')
      exitCode = 1
    }

    console.log('')
  }

  if (exitCode === 0) {
    console.log('✅ Prisma 8 Contract 检查通过')
  } else {
    console.log('⚠️  Prisma 8 Contract 需要处理，请按上方提示操作')
  }

  return exitCode
}

// ============ Main ============
function main() {
  const exitCode = checkPrismaContract()
  process.exit(exitCode)
}

// 如果是直接执行此脚本
if (require.main === module) {
  main()
}

module.exports = { checkPrismaContract }
