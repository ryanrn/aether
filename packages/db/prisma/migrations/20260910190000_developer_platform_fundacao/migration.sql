-- AETHER Developer Platform — Etapa 3: fundacao do modelo de bots.
--
-- SO O MODELO. Nenhum codigo usa estas tabelas ainda. As etapas seguintes
-- ligam a resolucao de token, a REST v1, a instalacao, o portal, o Gateway de
-- bot e o webhook. O schema entra sozinho para a migracao ser revisada e
-- aplicada sem nenhum comportamento novo dependendo dela.
--
-- TUDO ADITIVO. Nenhuma tabela recriada, nenhuma coluna apagada, nenhum dado
-- tocado:
--   - `User.kind` nasce NOT NULL DEFAULT 'HUMAN' -> toda linha existente vira
--     'HUMAN' sem reescrita (Postgres 11+ nao reescreve a tabela para default
--     constante);
--   - `User.email` / `User.passwordHash` so PERDEM o NOT NULL. O `@unique` de
--     `email` continua — varios NULL nao colidem no Postgres. Nenhuma linha
--     humana fica sem e-mail/senha; a coluna passa a ACEITAR nulo para as
--     identidades de bot/webhook das proximas etapas.
--   - 4 tabelas novas, todas as FK para tabelas que ja existem.
--
-- A permissao MENTION_EVERYONE (bit 21) e codigo em `@aether/shared`, nao
-- schema — nao aparece aqui.
--
-- Gerado por `prisma migrate diff` (schema->schema, offline, sem tocar banco).
-- `prisma migrate dev` NAO foi usado: ele conecta no banco e bateria no drift
-- conhecido do enum `CosmeticType` em producao, pedindo reset.

-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('HUMAN', 'BOT', 'WEBHOOK');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kind" "UserKind" NOT NULL DEFAULT 'HUMAN',
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "descricao" TEXT,
    "avatarUrl" TEXT,
    "botUserId" TEXT,
    "blockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotToken" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "lastIpHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BotToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "installedBy" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY['messages']::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "webhookUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "tokenHash" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_botUserId_key" ON "Application"("botUserId");

-- CreateIndex
CREATE INDEX "Application_ownerId_idx" ON "Application"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BotToken_tokenHash_key" ON "BotToken"("tokenHash");

-- CreateIndex
CREATE INDEX "BotToken_applicationId_idx" ON "BotToken"("applicationId");

-- CreateIndex
CREATE INDEX "Installation_serverId_idx" ON "Installation"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_applicationId_serverId_key" ON "Installation"("applicationId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "Webhook_webhookUserId_key" ON "Webhook"("webhookUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Webhook_tokenHash_key" ON "Webhook"("tokenHash");

-- CreateIndex
CREATE INDEX "Webhook_channelId_idx" ON "Webhook"("channelId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_botUserId_fkey" FOREIGN KEY ("botUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotToken" ADD CONSTRAINT "BotToken_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_webhookUserId_fkey" FOREIGN KEY ("webhookUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
