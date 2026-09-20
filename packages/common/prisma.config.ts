import path from 'node:path';
import { defineConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-sqlite/config';

export default defineConfig({
  orm: ormConfig({
    contract: path.join(__dirname, 'src', 'prisma', 'contract.ts'),
    output: path.join(__dirname, 'src', 'generated', 'db_client'),
    db: {
      connection: process.env.DATABASE_URL || 'file:./src/storage/myDb.db',
    },
    migrations: {
      dir: path.join(__dirname, 'src', 'prisma', 'migrations'),
    },
  }),
});
