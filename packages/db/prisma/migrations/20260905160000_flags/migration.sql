-- Feature flags / kill switches.
--
-- UMA LINHA POR CHAVE, e so das chaves que a equipe mexeu — a ausencia de
-- linha significa "use o padrao do codigo" (`@aether/shared/flags`). Nao ha
-- semente aqui de proposito: seed criaria linha para chave nenhuma foi
-- tocada, e ai o padrao versionado no codigo deixaria de valer.
--
-- Nao e config de produto: e o freio de emergencia. Durante um incidente a
-- equipe vira `registro_aberto` para `false` sem deploy.

CREATE TABLE "Flag" (
    "chave"         TEXT NOT NULL,
    "ligado"        BOOLEAN NOT NULL DEFAULT true,
    "atualizadoPor" TEXT,
    "atualizadoEm"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("chave")
);

-- Mesma postura de toda tabela do projeto: nada de acesso direto pelas roles
-- publicas do Supabase. Quem le e escreve e a aplicacao.
ALTER TABLE "Flag" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Flag" FROM anon, authenticated;
