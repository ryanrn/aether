-- Cosmeticos de perfil cadastrados pela equipe: decoracao em volta do avatar
-- e banner do perfil.
--
-- Tudo aqui e ADITIVO: tabela e tipo novos, nenhuma linha existente muda, e o
-- app anterior a este deploy ignora o que nao conhece. Nada de seed — cosmetico
-- e conteudo que a equipe cria pelo painel, nao dado de migracao.
--
-- O binario da imagem NAO entra no banco: `assetKey`/`assetUrl` referenciam o
-- objeto no Cloudflare R2. Mesmo desenho de `Attachment`.

CREATE TYPE "CosmeticType" AS ENUM ('DECORATION', 'BANNER');

CREATE TABLE "Cosmetic" (
    "id"          TEXT NOT NULL,
    "slug"        TEXT NOT NULL,
    "nome"        TEXT NOT NULL,
    "descricao"   TEXT,
    "tipo"        "CosmeticType" NOT NULL,
    "raridade"    TEXT NOT NULL,
    "precoMoedas" INTEGER,
    "tierMinimo"  "PlanTier" NOT NULL DEFAULT 'FREE',
    "ativo"       BOOLEAN NOT NULL DEFAULT false,
    "ordem"       INTEGER NOT NULL DEFAULT 0,
    "assetKey"    TEXT NOT NULL,
    "assetUrl"    TEXT NOT NULL,
    "assetMime"   TEXT NOT NULL,
    "largura"     INTEGER,
    "altura"      INTEGER,
    "thumbKey"    TEXT,
    "thumbUrl"    TEXT,
    "criadoPor"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cosmetic_pkey" PRIMARY KEY ("id")
);

-- O slug e o identificador estavel que o app referencia — unico de verdade.
CREATE UNIQUE INDEX "Cosmetic_slug_key" ON "Cosmetic"("slug");

-- A loja e o painel filtram sempre por (tipo, ativo) e ordenam por `ordem`.
CREATE INDEX "Cosmetic_tipo_ativo_ordem_idx" ON "Cosmetic"("tipo", "ativo", "ordem");

-- Mesma postura de toda tabela do projeto: nada de acesso direto pelas roles
-- publicas do Supabase. Quem le e escreve e a aplicacao.
ALTER TABLE "Cosmetic" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Cosmetic" FROM anon, authenticated;
