-- Nao lidas persistidas (P1-3): ate onde cada pessoa leu cada conversa.
--
-- So ADICIONA: tabela nova, sem tocar em coluna ou linha existente.

-- CreateTable
CREATE TABLE "ReadState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "dmChannelId" TEXT,
    "lastReadAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReadState_channelId_idx" ON "ReadState"("channelId");

-- CreateIndex
CREATE INDEX "ReadState_dmChannelId_idx" ON "ReadState"("dmChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadState_userId_channelId_key" ON "ReadState"("userId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ReadState_userId_dmChannelId_key" ON "ReadState"("userId", "dmChannelId");

-- AddForeignKey
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_dmChannelId_fkey" FOREIGN KEY ("dmChannelId") REFERENCES "DmChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma conversa so: canal OU DM, nunca os dois, nunca nenhum. Mesmo CHECK da
-- `Message` (`Message_um_pai_so`). Sem ele, uma linha com as duas colunas
-- nulas escaparia dos dois uniques e contaria como leitura de lugar nenhum.
ALTER TABLE "ReadState" ADD CONSTRAINT "ReadState_uma_conversa_so"
  CHECK (("channelId" IS NULL) <> ("dmChannelId" IS NULL));

-- Mesma postura de toda tabela desde `20260823000000_rls_e_revoke`: o app fala
-- por Prisma como dono das tabelas; a API REST publica do Supabase nao entra.
ALTER TABLE "ReadState" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ReadState" FROM anon, authenticated;

-- PREENCHIMENTO INICIAL. Sem ele, quem ja tinha acesso nao teria linha, a
-- contagem comecaria da entrada no servidor, e o primeiro acesso depois do
-- deploy acenderia o historico inteiro como nao lido. Com `lastReadAt` =
-- agora, todo mundo comeca com zero.
--
-- So pessoas (`kind = 'HUMAN'`): bot e webhook nao leem. So canais de TEXTO:
-- canal de voz nao aceita mensagem. A permissao de ver o canal NAO entra
-- aqui: linha de canal que a pessoa nao enxerga e inofensiva, porque o
-- gateway so conta o que `VIEW_CHANNEL` libera.
--
-- `ON CONFLICT DO NOTHING`: rodar de novo nao duplica nem quebra.
INSERT INTO "ReadState" ("id", "userId", "channelId", "lastReadAt", "updatedAt")
SELECT gen_random_uuid()::text, sm."userId", c."id", NOW(), NOW()
FROM "ServerMember" sm
JOIN "User" u ON u."id" = sm."userId" AND u."kind" = 'HUMAN'
JOIN "Channel" c ON c."serverId" = sm."serverId" AND c."type" = 'TEXT'
ON CONFLICT DO NOTHING;

INSERT INTO "ReadState" ("id", "userId", "dmChannelId", "lastReadAt", "updatedAt")
SELECT gen_random_uuid()::text, lado."userId", lado."dmId", NOW(), NOW()
FROM (
  SELECT "id" AS "dmId", "userAId" AS "userId" FROM "DmChannel"
  UNION ALL
  SELECT "id" AS "dmId", "userBId" AS "userId" FROM "DmChannel"
) lado
ON CONFLICT DO NOTHING;
