const { fork } = require("child_process");
const path = require("path");
const getDBConstants = require("./dbConstants");

/**
 * @type {import('../../types').TypeRunPrismaCommand}
 */
async function runPrismaCommand(param) {

  const { command, ctx } = param
  const { mePath, qePath, dbUrl, prismaPath: ctxPrismaPath } = getDBConstants(ctx);
  console.log("Migration engine path", mePath);
  console.log("Query engine path", qePath);

  // Currently we don't have any direct method to invoke prisma migration programatically.
  // As a workaround, we spawn migration script as a child process and wait for its completion.
  // Please also refer to the following GitHub issue: https://github.com/prisma/prisma/issues/4703
  try {
    const exitCode = await new Promise((resolve, _) => {
      const prismaPath = param.prismaPath || ctxPrismaPath || path.resolve(__dirname, "..", "node_modules/prisma/build/index.js");
      console.log("※Prisma path", prismaPath, mePath, qePath, dbUrl, ctxPrismaPath, '===');

      const child = fork(
        prismaPath,
        command,
        {
          env: {
            ...process.env,
            DATABASE_URL: dbUrl,
            PRISMA_SCHEMA_ENGINE_BINARY: mePath,
            PRISMA_QUERY_ENGINE_LIBRARY: qePath,
            PRISMA_FMT_BINARY: qePath,
            PRISMA_INTROSPECTION_ENGINE_BINARY: qePath
          },
          stdio: "pipe"
        }
      );

      child.on("message", msg => {
        console.log(msg);
      })

      child.on("error", err => {
        console.error("Child process got error:", err);
      });

      child.on("close", (code, signal) => {
        resolve(code);
      })

      child.stdout?.on('data',function(data){
        console.log("prisma: ", data.toString());
      });

      child.stderr?.on('data',function(data){
        console.error("prisma: ", data.toString());
      });
    });

    if (exitCode !== 0) throw Error(`command ${command} failed with exit code ${exitCode}`);

    return exitCode;
  } catch (e) {
    console.error(e);
    throw e;
  }
}

module.exports = runPrismaCommand;