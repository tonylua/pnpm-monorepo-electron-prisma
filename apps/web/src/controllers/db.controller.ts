import { Request, Response, NextFunction } from 'express'
import { AppError } from '../middleware/errorHandler'
import { handlePersistenceAction } from '@/db'

export class DbController {
  constructor() {}

  async db(req: Request, res: Response, next: NextFunction) {
    try {
      const { model, action, args } = req.body
      const result = await handlePersistenceAction.apply(null, [model, action, ...args])

      console.log('[web db action]', model, action) //req.body, result)
      // if (model === 'ThreadMessage' && action === 'new') {
      //   console.log(req.body, result)
      // }

      res.json(result)
    } catch (error) {
      console.log(error)
      next(new AppError(String(error), 404))
    }
  }
}
