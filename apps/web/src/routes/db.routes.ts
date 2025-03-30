import { DbController } from '@/controllers/db.controller'
import { Router } from 'express'
export const dbRoutes: Router = Router()
const controller = new DbController()

dbRoutes.post('/', controller.db.bind(controller))
