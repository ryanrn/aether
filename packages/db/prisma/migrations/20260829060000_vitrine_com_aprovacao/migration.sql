-- A vitrine passa a exigir aprovacao.
--
-- A primeira versao deixava o dono se listar sozinho, e como qualquer pessoa
-- cria conta e servidor, isso abria a vitrine para spam e para alguem se
-- passar por um servidor oficial.
CREATE TYPE "VitrineStatus" AS ENUM ('PRIVADO', 'PENDENTE', 'APROVADO', 'RECUSADO');

ALTER TABLE "Server" ADD COLUMN "vitrine" "VitrineStatus" NOT NULL DEFAULT 'PRIVADO';
ALTER TABLE "Server" ADD COLUMN "vitrineRevisadaPor" TEXT;
ALTER TABLE "Server" ADD COLUMN "vitrineRevisadaEm" TIMESTAMP(3);

-- Quem JA estava listado continua listado: tirar da vitrine um servidor que o
-- dono ja publicou seria puni-lo por uma mudanca nossa. Sao poucos e todos
-- foram ligados a mao enquanto a vitrine nem existia para o publico.
UPDATE "Server" SET "vitrine" = 'APROVADO' WHERE "publico" = true;

DROP INDEX IF EXISTS "Server_publico_oficial_idx";
ALTER TABLE "Server" DROP COLUMN "publico";
CREATE INDEX "Server_vitrine_oficial_idx" ON "Server"("vitrine", "oficial");
