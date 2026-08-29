-- Administracao GLOBAL do produto. Nula em todo mundo por padrao: ninguem vira
-- equipe por acidente de migracao.
ALTER TABLE "User" ADD COLUMN "equipe" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "StatusDeJogo" AS ENUM ('PENDENTE', 'APROVADO', 'RECUSADO');

-- Um jogo que a comunidade ensinou ao app. Guarda o EXECUTAVEL, nunca o
-- caminho: caminho carrega o nome de usuario do Windows e nao serve em outra
-- maquina.
CREATE TABLE "JogoDaComunidade" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "executavel" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" "StatusDeJogo" NOT NULL DEFAULT 'PENDENTE',
    "revisadoPor" TEXT,
    "revisadoEm" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JogoDaComunidade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JogoDaComunidade_chave_key" ON "JogoDaComunidade"("chave");
CREATE INDEX "JogoDaComunidade_status_idx" ON "JogoDaComunidade"("status");

-- Quem sugeriu o que. Par unico: sem ele, uma pessoa clicando dez vezes faria
-- "dez pessoas pediram" parecer sinal forte quando nao e.
CREATE TABLE "SugestaoDeJogo" (
    "id" TEXT NOT NULL,
    "jogoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SugestaoDeJogo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SugestaoDeJogo_jogoId_userId_key" ON "SugestaoDeJogo"("jogoId", "userId");
CREATE INDEX "SugestaoDeJogo_userId_idx" ON "SugestaoDeJogo"("userId");

ALTER TABLE "SugestaoDeJogo" ADD CONSTRAINT "SugestaoDeJogo_jogoId_fkey"
    FOREIGN KEY ("jogoId") REFERENCES "JogoDaComunidade"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SugestaoDeJogo" ADD CONSTRAINT "SugestaoDeJogo_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
