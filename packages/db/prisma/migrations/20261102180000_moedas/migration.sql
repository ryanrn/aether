-- Moedas da loja (Estagio 1): saldo + extrato.
--
-- So ADICIONA. Todo mundo comeca com saldo zero e extrato vazio.

-- CreateEnum
CREATE TYPE "MotivoDeMoedas" AS ENUM ('COMPRA', 'CONCESSAO_EQUIPE', 'MISSAO');

-- AlterTable. DEFAULT constante: so metadado, nao reescreve a tabela de usuarios.
ALTER TABLE "User" ADD COLUMN "saldoMoedas" INTEGER NOT NULL DEFAULT 0;

-- O saldo NUNCA fica negativo, e quem garante e o banco. A compra debita com
-- `UPDATE ... WHERE saldoMoedas >= preco`; se um caminho novo esquecer essa
-- condicao, a escrita estoura aqui em vez de deixar a pessoa devendo.
ALTER TABLE "User" ADD CONSTRAINT "User_saldo_nao_negativo"
  CHECK ("saldoMoedas" >= 0);

-- CreateTable
CREATE TABLE "MovimentoDeMoedas" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "valor" INTEGER NOT NULL,
    "saldoDepois" INTEGER NOT NULL,
    "motivo" "MotivoDeMoedas" NOT NULL,
    "referencia" TEXT,
    "atorId" TEXT,
    "nota" TEXT,
    "chave" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentoDeMoedas_pkey" PRIMARY KEY ("id")
);

-- Movimento de zero nao existe; o saldo registrado nunca e negativo.
ALTER TABLE "MovimentoDeMoedas" ADD CONSTRAINT "MovimentoDeMoedas_valor_nao_zero"
  CHECK ("valor" <> 0);
ALTER TABLE "MovimentoDeMoedas" ADD CONSTRAINT "MovimentoDeMoedas_saldo_nao_negativo"
  CHECK ("saldoDepois" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "MovimentoDeMoedas_chave_key" ON "MovimentoDeMoedas"("chave");

-- CreateIndex
CREATE INDEX "MovimentoDeMoedas_userId_createdAt_idx" ON "MovimentoDeMoedas"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MovimentoDeMoedas" ADD CONSTRAINT "MovimentoDeMoedas_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimentoDeMoedas" ADD CONSTRAINT "MovimentoDeMoedas_atorId_fkey" FOREIGN KEY ("atorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Mesma postura de toda tabela desde `20260823000000_rls_e_revoke`.
ALTER TABLE "MovimentoDeMoedas" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MovimentoDeMoedas" FROM anon, authenticated;
