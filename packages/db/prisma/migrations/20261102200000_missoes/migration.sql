-- Missoes (Estagio 2 da economia): o jeito de GANHAR moedas.
--
-- So ADICIONA. Ja cria as cinco primeiras missoes, ativas; a equipe ajusta
-- valores ou desliga pelo painel.

-- CreateEnum
CREATE TYPE "MetricaDeMissao" AS ENUM ('MINUTOS_EM_VOZ', 'MINUTOS_JOGANDO', 'DIAS_ATIVOS');

-- CreateEnum
CREATE TYPE "PeriodoDeMissao" AS ENUM ('DIARIA', 'SEMANAL');

-- CreateTable
CREATE TABLE "Missao" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "metrica" "MetricaDeMissao" NOT NULL,
    "meta" INTEGER NOT NULL,
    "recompensa" INTEGER NOT NULL,
    "periodo" "PeriodoDeMissao" NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Missao_pkey" PRIMARY KEY ("id")
);

-- Missao sem meta ou sem recompensa nao faz sentido, e recompensa zero
-- geraria um movimento de valor zero, que o extrato recusa.
ALTER TABLE "Missao" ADD CONSTRAINT "Missao_meta_positiva" CHECK ("meta" > 0);
ALTER TABLE "Missao" ADD CONSTRAINT "Missao_recompensa_positiva" CHECK ("recompensa" > 0);

-- CreateTable
CREATE TABLE "ProgressoDeMissao" (
    "userId" TEXT NOT NULL,
    "missaoId" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "valor" INTEGER NOT NULL DEFAULT 0,
    "resgatadaEm" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgressoDeMissao_pkey" PRIMARY KEY ("userId","missaoId","periodo")
);

ALTER TABLE "ProgressoDeMissao" ADD CONSTRAINT "ProgressoDeMissao_valor_nao_negativo"
  CHECK ("valor" >= 0);

-- CreateIndex
CREATE UNIQUE INDEX "Missao_slug_key" ON "Missao"("slug");

-- CreateIndex
CREATE INDEX "Missao_ativa_metrica_idx" ON "Missao"("ativa", "metrica");

-- CreateIndex
CREATE INDEX "ProgressoDeMissao_userId_periodo_idx" ON "ProgressoDeMissao"("userId", "periodo");

-- AddForeignKey
ALTER TABLE "ProgressoDeMissao" ADD CONSTRAINT "ProgressoDeMissao_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressoDeMissao" ADD CONSTRAINT "ProgressoDeMissao_missaoId_fkey" FOREIGN KEY ("missaoId") REFERENCES "Missao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Missao" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Missao" FROM anon, authenticated;
ALTER TABLE "ProgressoDeMissao" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "ProgressoDeMissao" FROM anon, authenticated;

-- As cinco primeiras. `ON CONFLICT DO NOTHING`: rodar de novo nao duplica nem
-- sobrescreve o que a equipe ja ajustou.
INSERT INTO "Missao" ("id", "slug", "titulo", "descricao", "metrica", "meta", "recompensa", "periodo", "ordem", "updatedAt") VALUES
  ('missao_dia_voz',      'dia-voz-30',     'Bate-papo do dia',  'Fique 30 minutos em um canal de voz com mais alguém.', 'MINUTOS_EM_VOZ',  30, 50,  'DIARIA',  10, NOW()),
  ('missao_dia_jogo',     'dia-jogo-60',    'Partida do dia',    'Jogue por 1 hora com o app de desktop aberto.',        'MINUTOS_JOGANDO', 60, 50,  'DIARIA',  20, NOW()),
  ('missao_dia_presenca', 'dia-presenca',   'Passou por aqui',   'Abra o AETHER hoje.',                                   'DIAS_ATIVOS',      1, 10,  'DIARIA',  30, NOW()),
  ('missao_sem_voz',      'semana-voz-300', 'Semana conversada', 'Fique 5 horas em canais de voz com mais gente nesta semana.', 'MINUTOS_EM_VOZ', 300, 300, 'SEMANAL', 40, NOW()),
  ('missao_sem_presenca', 'semana-7-dias',  'Todo dia, toda semana', 'Abra o AETHER nos 7 dias desta semana.',             'DIAS_ATIVOS',      7, 200, 'SEMANAL', 50, NOW())
ON CONFLICT DO NOTHING;
