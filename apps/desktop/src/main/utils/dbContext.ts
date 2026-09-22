import path from "node:path";
import { app } from "electron";
import type { IFacade } from "@app/common";
import * as commonFacade from "@app/common";
import { isDev } from "./isDev";

const { DB_FILE_NAME, ANALYTICS_DB_FILE_NAME } = commonFacade as IFacade;

// Prisma 7 is Rust-free: no query-engine .dll.node, no schema-engine .exe, and no
// Prisma CLI to fork. The runtime talks to SQLite through the node:sqlite driver
// adapter, and migrations are applied by executing the shipped migration.sql files
// directly. So this context only needs the db path and the migrations directory.
export const dbContext = {
  getDBPath: () =>
    isDev
      ? path.posix.resolve(`../../packages/common/src/storage/${DB_FILE_NAME}`)
      : path.join(app.getPath("userData"), DB_FILE_NAME),

  getMigrationsDir: () =>
    isDev
      ? path.join(
          app.getAppPath().replace("app.asar", "app.asar.unpacked"),
          "../../packages/common/src/prisma/migrations",
        )
      : path.resolve(
          app.getAppPath().replace("app.asar", ""),
          "prisma/migrations",
        ),

  getAnalyticsDBPath: () =>
    isDev
      ? path.posix.resolve(
          `../../packages/common/src/storage/${ANALYTICS_DB_FILE_NAME}`,
        )
      : path.join(app.getPath("userData"), ANALYTICS_DB_FILE_NAME),

  getAnalyticsMigrationsDir: () =>
    isDev
      ? path.join(
          app.getAppPath().replace("app.asar", "app.asar.unpacked"),
          "../../packages/common/src/prisma/analytics/migrations",
        )
      : path.resolve(
          app.getAppPath().replace("app.asar", ""),
          "prisma/analytics/migrations",
        ),
};

console.log(
  [
    "%c 💻 desktop db context ⌨",
    isDev,
    dbContext.getMigrationsDir?.(),
    dbContext.getDBPath(),
  ].join("\n"),
  "color: red;",
);
