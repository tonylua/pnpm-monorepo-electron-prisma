import fs from 'node:fs'

export function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true }) // 自动创建所有不存在的父级目录
      console.log(`目录已创建：${dirPath}`)
    } catch (err) {
      console.error(`目录创建失败：${err}`)
    }
  } else {
    console.log(`目录已存在：${dirPath}`)
  }
}
