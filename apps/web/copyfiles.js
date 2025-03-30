const fs = require('node:fs')
const path = require('node:path')
const rimraf = require('rimraf')
const copyfiles = require('copyfiles')

const isDev = process.argv.includes('--dev')

const files = [
  {
    from: 'node_modules/prisma/**/*',
    to: 'dist',
    option: { up: 1, all: true }
  },
  {
    from: '../../packages/common/node_modules/@prisma/engines/**/*.{node,exe}',
    to: 'dist',
    option: { up: 7 }
  },
  {
    from: '../../packages/common/src/prisma/**/*',
    to: 'dist',
    option: {
      up: 6,
      all: true,
      exclude: '*.db*'
    },
    callback: () => {
      rimraf.sync('dist/.env')
      rimraf.sync('dist/.env.dev')
    }
  },
  {
    from: '../desktop/dist/web/**/*',
    to: 'dist/web',
    option: { up: 4 },
    buildOnly: true
  },
  {
    from: 'prod.package.json',
    to: 'dist',
    option: {
      up: 0
    },
    callback: () => fs.renameSync('./dist/prod.package.json', './dist/package.json'),
    buildOnly: true
  },
  {
    from: '../../.npmrc',
    to: 'dist',
    option: { up: 0, verbose: true },
    buildOnly: true
  }
].filter((item) => (isDev ? !item.buildOnly : true))

async function copyFiles() {
  try {
    rimraf.sync('dist')
    await Promise.all(
      files.map(
        (item) =>
          new Promise((resolve, reject) => {
            copyfiles([item.from, item.to], item.option, (err) => {
              if (err) reject(err)
              else {
                item.callback?.()
                resolve()
              }
            })
          })
      )
    )
    console.log('所有文件复制完成！')
  } catch (err) {
    console.error('复制过程中发生错误:', err)
    process.exit(1)
  }
}

copyFiles()
