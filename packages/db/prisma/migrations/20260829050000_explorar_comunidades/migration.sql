-- Explorar comunidades. Tudo aditivo e com padrao seguro: nenhum servidor
-- existente passa a aparecer na vitrine por causa desta migracao.
ALTER TABLE "Server" ADD COLUMN "publico" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Server" ADD COLUMN "descricao" TEXT;
ALTER TABLE "Server" ADD COLUMN "categoria" TEXT;
ALTER TABLE "Server" ADD COLUMN "oficial" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Server_publico_oficial_idx" ON "Server"("publico", "oficial");
