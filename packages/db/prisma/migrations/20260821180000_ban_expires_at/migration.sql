-- Banimento temporario: NULL continua significando permanente, entao os
-- banimentos que ja existem seguem valendo sem qualquer conversao.
-- AlterTable
ALTER TABLE "Ban" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- Listar banimentos ativos de um servidor filtra por servidor e vencimento.
-- CreateIndex
CREATE INDEX "Ban_serverId_expiresAt_idx" ON "Ban"("serverId", "expiresAt");
