#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

// 配置路径
const migrationsDir = path.join(__dirname, '../packages/common/src/prisma/migrations')

function getLatestMigration() {
  try {
    const items = fs.readdirSync(migrationsDir, { withFileTypes: true })
    const migrationDirs = items
      .filter((item) => {
        if (!item.isDirectory() || !/^\d+_/.test(item.name)) return false
        // 避免误把空目录/中断目录识别为"最新迁移"
        return fs.existsSync(path.join(migrationsDir, item.name, 'migration.sql'))
      })
      .map((dir) => dir.name)

    if (migrationDirs.length === 0) {
      console.error('❌ 未找到任何迁移目录')
      process.exit(1)
    }

    // 可靠的时间戳排序：按字符串比较，最新的在前
    const sortedMigrations = migrationDirs.sort((a, b) => {
      const timestampA = a.split('_')[0]
      const timestampB = b.split('_')[0]
      return timestampB.localeCompare(timestampA)
    })

    return sortedMigrations[0]
  } catch (error) {
    console.error('❌ 读取迁移目录失败:', error.message)
    process.exit(1)
  }
}

function main() {
  console.log('🔍 检查Prisma迁移目录...\n')

  const latestMigration = getLatestMigration()
  console.log(`📁 最新迁移: ${latestMigration}`)
  console.log('\n✅ 迁移检查完成（initDB 自动从磁盘读取最新迁移，无需手动同步常量）')
  process.exit(0)
}

// 如果是直接执行此脚本
if (require.main === module) {
  main()
}

module.exports = { getLatestMigration }
