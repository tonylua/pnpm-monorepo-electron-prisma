-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "globalSetting" TEXT
);

-- CreateTable
CREATE TABLE "Thread" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "setting" TEXT,
    "chatProvider" TEXT,
    "chatModel" TEXT,
    "vectorTag" TEXT,
    "vectorSearchMode" TEXT DEFAULT 'default',
    "updateTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Thread_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ThreadMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "chatProvider" TEXT NOT NULL DEFAULT '',
    "chatModel" TEXT NOT NULL DEFAULT '',
    "prompt" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "updateTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ThreadMessage_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Account_email_key" ON "Account"("email");

-- CreateIndex
CREATE INDEX "Thread_accountId_idx" ON "Thread"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ThreadMessage_promptId_key" ON "ThreadMessage"("promptId");

-- CreateIndex
CREATE INDEX "ThreadMessage_accountId_idx" ON "ThreadMessage"("accountId");
