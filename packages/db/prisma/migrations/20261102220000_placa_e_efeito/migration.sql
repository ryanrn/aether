-- Loja, Estagio 3a: dois tipos novos de cosmetico.
--
-- NAMEPLATE (placa de nome): fundo atras da linha da pessoa na lista de
-- membros. PROFILE_EFFECT (efeito de perfil): camada transparente por cima do
-- cartao de perfil.
--
-- `IF NOT EXISTS` porque o enum de producao ja teve drift (ver
-- 20260910180000_cosmetic_type_banner). `ADD VALUE` e aditivo e nao reescreve
-- linha. Nenhuma linha usa os valores novos dentro desta migracao, entao ela
-- roda numa transacao so (Postgres 12+).

ALTER TYPE "CosmeticType" ADD VALUE IF NOT EXISTS 'NAMEPLATE';
ALTER TYPE "CosmeticType" ADD VALUE IF NOT EXISTS 'PROFILE_EFFECT';

-- Itens equipados. Item apagado desequipa (SET NULL), como decoracao e banner.
ALTER TABLE "User" ADD COLUMN "placaId" TEXT,
ADD COLUMN "efeitoId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_placaId_fkey" FOREIGN KEY ("placaId") REFERENCES "Cosmetic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_efeitoId_fkey" FOREIGN KEY ("efeitoId") REFERENCES "Cosmetic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
