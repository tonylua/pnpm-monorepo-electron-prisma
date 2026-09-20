# Pnpm Monorepo Electron Prisma (Prisma v8)

A production-ready Electron + Prisma v8 scaffold with zero native dependencies.

## Quick Start

```bash
pnpm install
pnpm dev          # Desktop app (Electron)
pnpm dev:web      # Web app
```

## Multiple Databases (Optional)

**Single database by default.** To add a second database (e.g., analytics, cache, logs):

```bash
pnpm common setup:multi-db
```

This scaffolds a working analytics database example demonstrating Prisma v8 multi-database patterns. After setup:

```bash
pnpm common build
pnpm dev
```

See generated files in `packages/common/src/prisma/analytics/` for the pattern. Each database has its own contract, config, runtime, and migrations. To remove the example, delete those files and revert the patches (instructions in console output).

## Database Management

### Main Database

Update schema in `packages/common/src/prisma/contract.ts`, then:

```bash
pnpm common db:generate    # Generate client
pnpm common db:migrate     # Apply migrations
```

### Analytics Database (if enabled)

```bash
pnpm common db:generate:analytics
pnpm common db:migrate:analytics
pnpm common db:studio:analytics   # Open Prisma Studio
```

## Build

```bash
pnpm build:win     # Windows desktop app
pnpm build:web     # Web app
```

## Architecture

- **Zero native dependencies**: Uses `@prisma/orm-sqlite` with `node:sqlite` adapter (no better-sqlite3, no Rust engines)
- **Programmatic migrations**: v8 ControlClient applies migrations at runtime (dev + production)
- **Context-driven paths**: `dbContext.getDBPath()` switches between dev/packaged environments
- **IPC abstraction**: Generic `handlePersistenceAction(model, action, ...args)` dispatcher
- **Model wrappers**: Factory pattern for business logic (`createModels(client, db)`)

## Project Structure

```
apps/
  desktop/        # Electron app
  web/            # Vite web app
packages/
  common/         # Shared Prisma + business logic
    src/
      prisma/
        contract.ts              # Main DB schema (v8)
        migrations/              # Main DB migrations
        analytics/               # Optional: second DB
      generated/
        db_client/               # Generated main client
        analytics_db_client/     # Generated analytics client (if enabled)
      utils/prisma/
        index.js                 # Main DB runtime factory
        analyticsRuntime.js      # Analytics DB runtime (if enabled)
      models/                    # Model wrappers
```

## Key Patterns

**Single database** (default):
- One contract: `src/prisma/contract.ts`
- One config: `prisma.config.ts`
- One runtime: `src/utils/prisma/index.js`
- One generated client: `src/generated/db_client/`

**Multiple databases** (opt-in via `setup:multi-db`):
- Each DB: own contract, config, runtime, generated client, migrations
- Completely isolated: separate schemas, separate files
- Parallel infrastructure: both DBs initialize at app startup
- Demonstrated in production (see magi2-dev project)
