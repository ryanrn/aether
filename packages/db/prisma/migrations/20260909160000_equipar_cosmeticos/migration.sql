-- Equipar cosmeticos: a decoracao e o banner ESCOLHIDOS pela pessoa, e a
-- tabela de posse.
--
-- Tudo aditivo e nulavel. A decoracao/banner seguem a logica da moldura: a
-- escolha fica guardada, a leitura decide se aparece (contra plano e `ativo`).
-- `ON DELETE SET NULL` nas FKs de User: tirar a peca do catalogo desequipa
-- quem a usava.

ALTER TABLE "User" ADD COLUMN "decoracaoId" TEXT;
ALTER TABLE "User" ADD COLUMN "bannerId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_decoracaoId_fkey"
    FOREIGN KEY ("decoracaoId") REFERENCES "Cosmetic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_bannerId_fkey"
    FOREIGN KEY ("bannerId") REFERENCES "Cosmetic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "User_decoracaoId_idx" ON "User"("decoracaoId");
CREATE INDEX "User_bannerId_idx" ON "User"("bannerId");

-- Quem possui qual cosmetico. Pecas gratis sao equipaveis sem linha aqui;
-- esta tabela e para o que for pago ou concedido.
CREATE TABLE "UserCosmetic" (
    "userId"      TEXT NOT NULL,
    "cosmeticId"  TEXT NOT NULL,
    "origem"      TEXT NOT NULL,
    "adquiridoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCosmetic_pkey" PRIMARY KEY ("userId", "cosmeticId")
);

CREATE INDEX "UserCosmetic_cosmeticId_idx" ON "UserCosmetic"("cosmeticId");

ALTER TABLE "UserCosmetic" ADD CONSTRAINT "UserCosmetic_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCosmetic" ADD CONSTRAINT "UserCosmetic_cosmeticId_fkey"
    FOREIGN KEY ("cosmeticId") REFERENCES "Cosmetic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mesma postura de toda tabela do projeto.
ALTER TABLE "UserCosmetic" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "UserCosmetic" FROM anon, authenticated;
