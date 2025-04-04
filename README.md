- pnpm dev
- pnpm dev:web
- pnpm build:win
- pnpm build:web

## Update Database

- Update `packages\common\src\prisma\schema.prisma` file
- Run `pnpm init:db` command
- Update the new migration name (e.g. `20250312084952_init`) from the command output to `packages\common\src\utils\prisma\dbConstants.js`
