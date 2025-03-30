import { Router } from 'express'
import { dbRoutes } from './db.routes'

export const apiRoutes: Router = Router()

apiRoutes.use('/db', dbRoutes)
