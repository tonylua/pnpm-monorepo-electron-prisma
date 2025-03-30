import 'dotenv/config'
import path from 'node:path'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
// import compression from "compression";
import morgan from 'morgan'
import { errorHandler } from './middleware/errorHandler'
import { apiRoutes } from './routes'
import { ensureDir } from './utils'
import { initDB } from './db'

// 确保模型目录存在
const modelsPath = path.resolve(__dirname, '../dist/models')
ensureDir(modelsPath)
// 确保存储目录存在
const storagePath = path.resolve(__dirname, '../storage/models')
ensureDir(storagePath)

initDB()

const app: express.Application = express()
const port = process.env.PORT || 3000

// 添加路由日志
app.use((req, res, next) => {
  console.log(`访问路径: ${req.method} ${req.path}`)
  next()
})

// 中间件
app.use(cors())
app.use(
  helmet({
    contentSecurityPolicy: false,
    hsts: false
  })
)
app.use(morgan('dev'))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// TODO 该中间件会影响SSE流式对话，暂时注释掉
// app.use(compression());

// 路由
app.use('/v1', apiRoutes)
// 静态资源
const isDev = process.env.NODE_ENV === 'development'
const feDir = isDev
  ? path.join(__dirname, '../../desktop/dist/web')
  : path.resolve(__dirname, './web')
ensureDir(feDir)
app.use(
  express.static(feDir, {
    maxAge: isDev ? 0 : '1d',
    index: false
  })
)
app.get('*', (req, res) => {
  res.sendFile('index.html', {
    root: feDir,
    headers: { 'Cache-Control': 'no-cache' }
  })
})

// 错误处理
app.use(errorHandler)

app.listen(port as number, '0.0.0.0', () => {
  console.log(`\n\n===🌏===\n\nServer is running on port ${port}`)
})

export default app
