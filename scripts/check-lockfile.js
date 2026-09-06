#!/usr/bin/env node
const { execSync } = require('child_process')

try {
  const changedFiles = execSync('git diff --name-only HEAD@{1} HEAD').toString()
  if (changedFiles.includes('pnpm-lock.yaml')) {
    console.log('⚠ 检测到 pnpm-lock.yaml 变更，可能需要重新 pnpm install')
    process.exit(1)
  } else {
    console.log('✅ 无 pnpm-lock.yaml 变更')
  }
} catch (error) {
  console.error('❌ 钩子执行失败:', error.message)
  process.exit(1)
}
