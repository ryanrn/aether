-- Loja, Estagio 3b: colecoes de cosmeticos, com periodo opcional de venda.
--
-- Aditiva: tabela nova e uma coluna anulavel no Cosmetic. Nenhum item muda de
-- comportamento ate a equipe criar uma colecao e colocar itens nela.

CREATE TABLE "ColecaoDeCosmeticos" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "inicioEm" TIMESTAMP(3),
    "fimEm" TIMESTAMP(3),
    "destaque" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criadoPor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ColecaoDeCosmeticos_pkey" PRIMARY KEY ("id"),
    -- Periodo com os dois lados: o fim vem depois do inicio.
    CONSTRAINT "ColecaoDeCosmeticos_periodo_valido"
      CHECK ("inicioEm" IS NULL OR "fimEm" IS NULL OR "fimEm" > "inicioEm")
);

CREATE UNIQUE INDEX "ColecaoDeCosmeticos_slug_key" ON "ColecaoDeCosmeticos"("slug");
CREATE INDEX "ColecaoDeCosmeticos_ativa_ordem_idx" ON "ColecaoDeCosmeticos"("ativa", "ordem");

-- Apagar a colecao solta os itens; nao apaga item nem posse.
ALTER TABLE "Cosmetic" ADD COLUMN "colecaoId" TEXT;
CREATE INDEX "Cosmetic_colecaoId_idx" ON "Cosmetic"("colecaoId");
ALTER TABLE "Cosmetic" ADD CONSTRAINT "Cosmetic_colecaoId_fkey" FOREIGN KEY ("colecaoId") REFERENCES "ColecaoDeCosmeticos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mesmo criterio das outras tabelas: so o servidor (service role) le e grava.
ALTER TABLE "ColecaoDeCosmeticos" ENABLE ROW LEVEL SECURITY;
